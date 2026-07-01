-- ============================================================================
-- FIX open_tournament_table — release any stale dealer BEFORE reactivating a
-- pooled/previously-used game_tables row.
-- SOURCE-ONLY: NOT applied here. Apply is a SEPARATE owner-gated controlled op
-- (Management API: preflight present-by-signature -> dry-run reproduce+fix
-- (BEGIN..ROLLBACK) -> CREATE OR REPLACE -> verify grants/secdef/search_path).
-- NO `supabase db push`, NO `deploy_db`, NO `schema_migrations` write here.
-- ============================================================================
-- P2 hardening gap (full-system audit, 2026-07-02): every branch that flips an
-- EXISTING game_tables row to status='active' (reusing a pooled table, or
-- reopening a table that already belonged to this tournament_table row) did so
-- WITHOUT first releasing any dealer_assignment that might still be sitting on
-- it (released_at IS NULL). In practice today's live data shows 0 such
-- orphans — the cron self-heal (process-swing #566) and the close-table edge
-- fn's release-before-deactivate already keep this clean — but this function
-- is a SECOND, independent reactivation path that did not carry the same
-- proactive guard, so a stale assignment could persist on a "freshly reopened"
-- table until the next cron tick catches it (a messier failure than doing it
-- up front).
--
-- FIX: call the existing, idempotent `release_dealer_from_table(p_table_id)`
-- immediately before EACH `UPDATE game_tables SET status = 'active'` that
-- reactivates an EXISTING row (never before a fresh INSERT — a brand-new row
-- cannot have any prior assignment, so there's nothing to release there).
-- `release_dealer_from_table` is a no-op (released_count: 0) when there is
-- nothing to release, so this preserves idempotency exactly.
--
-- WHAT CHANGED vs 20261004000000 (the prior body): 3 new
-- `PERFORM public.release_dealer_from_table(v_game_id);` lines, one before
-- each pre-existing `UPDATE public.game_tables SET status = 'active' WHERE
-- id = v_game_id;` reactivation. Signature, security, grants, authorization
-- logic, and every other branch are BYTE-IDENTICAL to 20261004000000.
--
-- ROLLBACK: re-apply the 20261004000000 body (this file only adds 3 PERFORM
-- lines; removing them restores it exactly).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.open_tournament_table(
  p_tournament_id  UUID,
  p_table_number   INTEGER DEFAULT NULL,   -- NULL → next available number
  p_max_seats      INTEGER DEFAULT NULL    -- NULL → mode of existing tables, else 9
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_authorized BOOLEAN;
  v_tour       RECORD;
  v_existing   RECORD;
  v_number     INTEGER;
  v_seats      INTEGER;
  v_game_id    UUID;
  v_tt_id      UUID;
  v_reopened   BOOLEAN := false;
BEGIN
  -- 0. Actor from auth.uid() ONLY.
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 1. Lock tournament; must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 2. Authorization: owner or club_cashier of the tournament's club.
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor
    WHERE t.id = p_tournament_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 3. Validate / resolve max_seats: explicit → mode of existing tables → 9.
  IF p_max_seats IS NOT NULL AND (p_max_seats < 2 OR p_max_seats > 10) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_max_seats');
  END IF;
  IF p_table_number IS NOT NULL AND p_table_number < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_table_number');
  END IF;
  v_seats := COALESCE(
    p_max_seats,
    (SELECT mode() WITHIN GROUP (ORDER BY max_seats)
       FROM public.tournament_tables
       WHERE tournament_id = p_tournament_id AND max_seats IS NOT NULL),
    9
  );

  -- 4. REOPEN path: an existing CLOSED table with the requested number.
  IF p_table_number IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.tournament_tables
    WHERE tournament_id = p_tournament_id AND table_number = p_table_number
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing.status = 'active' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'table_number_taken', 'table_number', p_table_number);
      END IF;
      v_game_id := v_existing.table_id;
      IF v_game_id IS NULL THEN
        -- Reuse the club's pooled game_tables row, else create one.
        SELECT id INTO v_game_id FROM public.game_tables
          WHERE club_id = v_tour.club_id AND table_name = 'Bàn ' || p_table_number::text
            AND shift_id IS NULL
          LIMIT 1 FOR UPDATE;
        IF v_game_id IS NULL THEN
          INSERT INTO public.game_tables (club_id, table_name, table_type, status, current_blind_level)
          VALUES (v_tour.club_id, 'Bàn ' || p_table_number::text, 'tournament', 'active',
                  COALESCE(v_tour.current_level, 1))
          RETURNING id INTO v_game_id;
        ELSE
          -- P2 fix: reusing an EXISTING pooled row — release any stale dealer first
          -- (no-op if none; release_dealer_from_table is idempotent).
          PERFORM public.release_dealer_from_table(v_game_id);
          UPDATE public.game_tables SET status = 'active' WHERE id = v_game_id;
        END IF;
      ELSE
        -- P2 fix: reactivating a table that already belonged to this tournament_table
        -- row (a genuine reopen) — same proactive release before flipping it active.
        PERFORM public.release_dealer_from_table(v_game_id);
        UPDATE public.game_tables SET status = 'active' WHERE id = v_game_id;
      END IF;
      UPDATE public.tournament_tables
        SET status = 'active', table_id = v_game_id
        WHERE id = v_existing.id;
      v_tt_id    := v_existing.id;
      v_number   := p_table_number;
      v_seats    := v_existing.max_seats;
      v_reopened := true;
    END IF;
  END IF;

  -- 5. CREATE path (no reopen happened).
  IF v_tt_id IS NULL THEN
    v_number := COALESCE(
      p_table_number,
      (SELECT COALESCE(MAX(table_number), 0) + 1
         FROM public.tournament_tables WHERE tournament_id = p_tournament_id)
    );
    IF EXISTS (SELECT 1 FROM public.tournament_tables
               WHERE tournament_id = p_tournament_id AND table_number = v_number AND status = 'active') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'table_number_taken', 'table_number', v_number);
    END IF;
    -- Reuse the club's pooled game_tables row (status → active), else create one.
    SELECT id INTO v_game_id FROM public.game_tables
      WHERE club_id = v_tour.club_id AND table_name = 'Bàn ' || v_number::text
        AND shift_id IS NULL
      LIMIT 1 FOR UPDATE;
    IF v_game_id IS NULL THEN
      INSERT INTO public.game_tables (club_id, table_name, table_type, status, current_blind_level)
      VALUES (v_tour.club_id, 'Bàn ' || v_number::text, 'tournament', 'active',
              COALESCE(v_tour.current_level, 1))
      RETURNING id INTO v_game_id;
    ELSE
      -- P2 fix: reusing an EXISTING pooled row — release any stale dealer first
      -- (no-op if none; release_dealer_from_table is idempotent).
      PERFORM public.release_dealer_from_table(v_game_id);
      UPDATE public.game_tables SET status = 'active' WHERE id = v_game_id;
    END IF;
    -- table_name is UNIQUE per tournament (tournament_tables_unique_name); the create
    -- path always uses a fresh number, so 'Bàn N' is unique.
    INSERT INTO public.tournament_tables (tournament_id, table_id, table_number, max_seats, status, table_name)
    VALUES (p_tournament_id, v_game_id, v_number, v_seats, 'active', 'Bàn ' || v_number::text)
    RETURNING id INTO v_tt_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_table_id', v_tt_id,
    'table_id', v_game_id,
    'table_number', v_number,
    'max_seats', v_seats,
    'status', 'active',
    'reopened', v_reopened
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_tournament_table(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_tournament_table(UUID, INTEGER, INTEGER) TO authenticated;
