-- ============================================================================
-- TV DISPLAYS PAIRING (PR C1 — SOURCE-ONLY, DO NOT APPLY IN THIS SESSION)
-- ============================================================================
-- Multi-TV tournament clock: club TVs pair by short code (Chromecast-style),
-- then read one curated TV-safe state JSON by long-lived display token.
--
-- Design (approved multi-TV plan, 2026-06-13):
--   * One new table: public.tv_displays. NO changes to existing tables.
--   * NO anon policy on the table — anonymous TVs go ONLY through the
--     SECURITY DEFINER RPCs below (same pattern as get_invite_preview).
--   * tv_pair_begin()            anon: create unpaired row → {pair_code, display_token}
--   * tv_claim_display(...)      staff: claim by code, name the TV, scope to club
--   * get_tv_display_state(...)  anon: token → display config + TV-safe tournament
--                                state; doubles as heartbeat (stamps last_seen_at)
--   * tv_revoke_display(...)     staff: revoke (kills the token)
--   * NOT added to supabase_realtime — TVs poll this RPC (30s) and listen on a
--     Broadcast channel for instant-switch pings (no publication change).
--
-- Rollback: docs/emergency_rollbacks/PRE_APPLY_tv_displays_20260818000001.sql
-- ============================================================================

-- 1. TABLE ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tv_displays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NULL REFERENCES public.clubs(id) ON DELETE CASCADE, -- NULL until claimed
    display_number INTEGER NULL,            -- per-club sequence assigned at claim (cosmetic)
    name TEXT NULL,                         -- "TV 1 — Sảnh chính"
    zone TEXT NULL,
    pair_code TEXT NULL,                    -- 6-digit short code, cleared at claim
    pair_code_expires_at TIMESTAMPTZ NULL,
    display_token TEXT NOT NULL UNIQUE,     -- long-lived read token; rotated on revoke
    assigned_tournament_id UUID NULL REFERENCES public.tournaments(id) ON DELETE SET NULL,
    layout TEXT NOT NULL DEFAULT 'clock'
        CHECK (layout IN ('clock', 'break_screen', 'announcement', 'payouts', 'multi_board')),
    announcement TEXT NULL,
    theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
    status TEXT NOT NULL DEFAULT 'unpaired' CHECK (status IN ('unpaired', 'paired', 'revoked')),
    last_seen_at TIMESTAMPTZ NULL,          -- heartbeat: stamped by get_tv_display_state
    paired_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    claimed_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tv_displays_club ON public.tv_displays(club_id, status);
CREATE INDEX IF NOT EXISTS idx_tv_displays_pair_code
    ON public.tv_displays(pair_code) WHERE status = 'unpaired';

DROP TRIGGER IF EXISTS trg_tv_displays_updated_at ON public.tv_displays;
CREATE TRIGGER trg_tv_displays_updated_at
    BEFORE UPDATE ON public.tv_displays
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. RLS — staff-only, club-scoped; the table is INVISIBLE to anon ----------
-- Claim/revoke/read of unpaired rows happens only inside the definer RPCs.

ALTER TABLE public.tv_displays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tv_displays_staff_select ON public.tv_displays;
CREATE POLICY tv_displays_staff_select ON public.tv_displays
    FOR SELECT TO authenticated
    USING (
        public.has_role(auth.uid(), 'super_admin')
        OR club_id IN (SELECT public.dealer_control_club_ids(auth.uid()))
    );

DROP POLICY IF EXISTS tv_displays_staff_update ON public.tv_displays;
CREATE POLICY tv_displays_staff_update ON public.tv_displays
    FOR UPDATE TO authenticated
    USING (
        public.has_role(auth.uid(), 'super_admin')
        OR club_id IN (SELECT public.dealer_control_club_ids(auth.uid()))
    )
    WITH CHECK (
        public.has_role(auth.uid(), 'super_admin')
        OR club_id IN (SELECT public.dealer_control_club_ids(auth.uid()))
    );

DROP POLICY IF EXISTS tv_displays_staff_delete ON public.tv_displays;
CREATE POLICY tv_displays_staff_delete ON public.tv_displays
    FOR DELETE TO authenticated
    USING (
        public.has_role(auth.uid(), 'super_admin')
        OR club_id IN (SELECT public.dealer_control_club_ids(auth.uid()))
    );

-- No INSERT policy: rows are created only by tv_pair_begin (SECURITY DEFINER).

-- 3. RPC — tv_pair_begin (anon: TV opens /tv/pair) ---------------------------

CREATE OR REPLACE FUNCTION public.tv_pair_begin()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT;
    v_token TEXT;
    v_id UUID;
    v_tries INTEGER := 0;
BEGIN
    -- Self-cleaning: stale unpaired rows never accumulate (no cron needed).
    DELETE FROM public.tv_displays
    WHERE status = 'unpaired' AND created_at < now() - INTERVAL '1 hour';

    -- Abuse guard: cap concurrent pending pairings.
    IF (SELECT COUNT(*) FROM public.tv_displays WHERE status = 'unpaired') >= 200 THEN
        RETURN jsonb_build_object('error', 'too_many_pending');
    END IF;

    -- 6-digit code, collision-checked against active unpaired rows.
    LOOP
        v_code := LPAD(FLOOR(random() * 1000000)::TEXT, 6, '0');
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.tv_displays
            WHERE pair_code = v_code AND status = 'unpaired'
              AND pair_code_expires_at > now()
        );
        v_tries := v_tries + 1;
        IF v_tries > 20 THEN
            RETURN jsonb_build_object('error', 'code_generation_failed');
        END IF;
    END LOOP;

    -- 64 hex chars from two v4 UUIDs (no pgcrypto dependency).
    v_token := REPLACE(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '');

    INSERT INTO public.tv_displays (pair_code, pair_code_expires_at, display_token, status)
    VALUES (v_code, now() + INTERVAL '10 minutes', v_token, 'unpaired')
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'display_id', v_id,
        'pair_code', v_code,
        'display_token', v_token,
        'expires_at', now() + INTERVAL '10 minutes'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.tv_pair_begin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_pair_begin() TO anon, authenticated;

-- 4. RPC — tv_claim_display (staff: dashboard enters the code) ---------------

CREATE OR REPLACE FUNCTION public.tv_claim_display(
    p_pair_code TEXT,
    p_club_id UUID,
    p_name TEXT,
    p_zone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_display public.tv_displays%ROWTYPE;
    v_number INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'unauthorized');
    END IF;
    IF NOT (
        public.has_role(v_uid, 'super_admin')
        OR p_club_id IN (SELECT public.dealer_control_club_ids(v_uid))
    ) THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT * INTO v_display
    FROM public.tv_displays
    WHERE pair_code = p_pair_code
      AND status = 'unpaired'
      AND pair_code_expires_at > now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'code_not_found_or_expired');
    END IF;

    SELECT COALESCE(MAX(display_number), 0) + 1 INTO v_number
    FROM public.tv_displays
    WHERE club_id = p_club_id;

    UPDATE public.tv_displays
    SET club_id = p_club_id,
        display_number = v_number,
        name = NULLIF(TRIM(p_name), ''),
        zone = NULLIF(TRIM(p_zone), ''),
        status = 'paired',
        paired_at = now(),
        claimed_by = v_uid,
        pair_code = NULL,
        pair_code_expires_at = NULL
    WHERE id = v_display.id;

    RETURN jsonb_build_object(
        'display_id', v_display.id,
        'display_number', v_number,
        'name', NULLIF(TRIM(p_name), '')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.tv_claim_display(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_claim_display(TEXT, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.tv_claim_display(TEXT, UUID, TEXT, TEXT) TO authenticated;

-- 5. RPC — get_tv_display_state (anon: the TV's single read + heartbeat) -----
-- Returns ONLY TV-safe aggregates: no player names, no individual stacks,
-- no fee breakdown, no registration rows. Calling get_tournament_clock from
-- this DEFINER context bypasses the authenticated-only RLS on
-- tournament_levels, which is exactly why an anonymous TV needs this RPC.

CREATE OR REPLACE FUNCTION public.get_tv_display_state(p_display_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_display public.tv_displays%ROWTYPE;
    v_club_name TEXT;
    v_tournament RECORD;
    v_clock JSONB;
    v_levels JSONB;
    v_prizes JSONB;
    v_entries INTEGER;
    v_buy_ins BIGINT;
    v_re_entries INTEGER;
BEGIN
    IF p_display_token IS NULL OR LENGTH(p_display_token) < 32 THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT * INTO v_display
    FROM public.tv_displays
    WHERE display_token = p_display_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    IF v_display.status = 'revoked' THEN
        RETURN jsonb_build_object('status', 'revoked');
    END IF;

    IF v_display.status = 'unpaired' THEN
        IF v_display.pair_code_expires_at <= now() THEN
            RETURN jsonb_build_object('status', 'expired');
        END IF;
        RETURN jsonb_build_object('status', 'unpaired');
    END IF;

    -- Heartbeat: each poll stamps last_seen_at (dashboard online dot).
    UPDATE public.tv_displays SET last_seen_at = now() WHERE id = v_display.id;

    SELECT c.name INTO v_club_name FROM public.clubs c WHERE c.id = v_display.club_id;

    IF v_display.assigned_tournament_id IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'paired',
            'display', jsonb_build_object(
                'id', v_display.id,
                'name', v_display.name,
                'zone', v_display.zone,
                'display_number', v_display.display_number,
                'layout', v_display.layout,
                'theme', v_display.theme,
                'announcement', v_display.announcement,
                'club_name', v_club_name
            ),
            'tournament', NULL
        );
    END IF;

    SELECT t.id, t.name, t.status, t.players_remaining, t.average_stack, t.prize_pool
    INTO v_tournament
    FROM public.tournaments t
    WHERE t.id = v_display.assigned_tournament_id;

    v_clock := public.get_tournament_clock(v_display.assigned_tournament_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'level_number', l.level_number,
        'small_blind', l.small_blind,
        'big_blind', l.big_blind,
        'ante', l.ante,
        'duration_minutes', l.duration_minutes,
        'is_break', l.is_break
    ) ORDER BY l.level_number), '[]'::jsonb)
    INTO v_levels
    FROM public.tournament_levels l
    WHERE l.tournament_id = v_display.assigned_tournament_id;

    SELECT COUNT(*)::INTEGER, COALESCE(SUM(r.buy_in), 0)::BIGINT
    INTO v_entries, v_buy_ins
    FROM public.tournament_registrations r
    WHERE r.tournament_id = v_display.assigned_tournament_id
      AND r.status = 'confirmed';

    SELECT COUNT(*)::INTEGER
    INTO v_re_entries
    FROM public.tournament_seats s
    WHERE s.tournament_id = v_display.assigned_tournament_id
      AND s.entry_number > 1;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'position', p.position,
        'amount', p.amount
    ) ORDER BY p.position), '[]'::jsonb)
    INTO v_prizes
    FROM public.tournament_prizes p
    WHERE p.tournament_id = v_display.assigned_tournament_id;

    RETURN jsonb_build_object(
        'status', 'paired',
        'display', jsonb_build_object(
            'id', v_display.id,
            'name', v_display.name,
            'zone', v_display.zone,
            'display_number', v_display.display_number,
            'layout', v_display.layout,
            'theme', v_display.theme,
            'announcement', v_display.announcement,
            'club_name', v_club_name
        ),
        'tournament', CASE WHEN v_tournament.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', v_tournament.id,
            'name', v_tournament.name,
            'status', v_tournament.status,
            'players_remaining', v_tournament.players_remaining,
            'average_stack', v_tournament.average_stack,
            'prize_pool', v_tournament.prize_pool
        ) END,
        'clock', v_clock,
        'levels', v_levels,
        'entries', jsonb_build_object(
            'total_confirmed', v_entries,
            'total_buy_ins', v_buy_ins
        ),
        're_entries', v_re_entries,
        'prizes', v_prizes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tv_display_state(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tv_display_state(TEXT) TO anon, authenticated;

-- 6. RPC — tv_revoke_display (staff: kill a display) -------------------------
-- Rotates the token so a leaked /display/:token link dies immediately.

CREATE OR REPLACE FUNCTION public.tv_revoke_display(p_display_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_club_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'unauthorized');
    END IF;

    SELECT club_id INTO v_club_id FROM public.tv_displays WHERE id = p_display_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'not_found');
    END IF;
    IF NOT (
        public.has_role(v_uid, 'super_admin')
        OR v_club_id IN (SELECT public.dealer_control_club_ids(v_uid))
    ) THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    UPDATE public.tv_displays
    SET status = 'revoked',
        revoked_at = now(),
        display_token = REPLACE(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '')
    WHERE id = p_display_id;

    RETURN jsonb_build_object('display_id', p_display_id, 'status', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.tv_revoke_display(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_revoke_display(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.tv_revoke_display(UUID) TO authenticated;
