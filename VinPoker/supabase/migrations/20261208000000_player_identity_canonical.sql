-- Player History — Phase 1 / M1: identity foundation (source-only, additive, idempotent).
-- WHY: walk-in cash players today get a fresh random player_id per buy-in, so nothing can
-- accumulate against a person. This anchors every player to ONE per-club club_members row
-- (by canonical phone for walk-ins, by auth user for online) so history can build up.
-- No money-flow change here. Applied via owner-gated controlled step (Management API BEGIN..COMMIT);
-- never `supabase db push`. schema_migrations is NOT written by this file.
--
-- Depends on: nothing new (uses existing club_members, club_settings, role helpers).
-- Followed by: M2 (tournament_entries.member_id + linking) and M3 (bust_order + finalize).

-- 1) Canonical phone column — keep raw `phone` for display/audit, dedup on the canonical form. ---
ALTER TABLE public.club_members
  ADD COLUMN IF NOT EXISTS phone_canonical text;

-- 2) Per-club enablement flag — the TRUE server-side kill switch (default OFF). -------------------
ALTER TABLE public.club_settings
  ADD COLUMN IF NOT EXISTS player_history_enabled boolean NOT NULL DEFAULT false;

-- 3) Shared phone normalizer. IMMUTABLE. Mirrored byte-for-byte in src/lib/normalizePhone.ts. ----
--    All of "0912345678" / "+84 912 345 678" / "0912 345 678" / "912345678" -> "0912345678".
CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g');
  IF d = '' THEN
    RETURN NULL;
  END IF;
  IF left(d, 2) = '84' THEN
    d := '0' || substr(d, 3);
  ELSIF length(d) = 9 AND left(d, 1) <> '0' THEN
    d := '0' || d;
  END IF;
  RETURN d;
END;
$$;

-- 4) Backfill canonical for any existing rows. This is the HARD GATE: if two existing rows share
--    a canonical phone within a club, the unique index below fails and the apply aborts (no silent
--    auto-merge). Table is empty today (audited), so this is a no-op — but keep it for correctness.
UPDATE public.club_members
   SET phone_canonical = public.normalize_phone(phone)
 WHERE phone IS NOT NULL
   AND phone_canonical IS DISTINCT FROM public.normalize_phone(phone);

-- 5) Partial UNIQUE indexes — the identity anchors (P0-1 / P0-4). Postgres cannot express partial
--    uniqueness via ADD CONSTRAINT ... WHERE, so these are indexes. Unique on the CANONICAL phone,
--    never on the free-form raw `phone`.
CREATE UNIQUE INDEX IF NOT EXISTS uq_club_members_phone_canon
  ON public.club_members (club_id, phone_canonical)
  WHERE phone_canonical IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_club_members_user
  ON public.club_members (club_id, player_user_id)
  WHERE player_user_id IS NOT NULL;

-- 6) find_or_create_club_member — the race-safe anchor resolver. -----------------------------------
--    Returns { ok, member_id (nullable), match_confidence }. member_id is NULL when there is no
--    anchor (no phone AND no user) so it NEVER creates a junk row (P1-A).
CREATE OR REPLACE FUNCTION public.find_or_create_club_member(
  p_club_id uuid,
  p_phone text,
  p_full_name text,
  p_player_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_canon    text := public.normalize_phone(p_phone);
  v_name     text := NULLIF(TRIM(p_full_name), '');
  v_existing RECORD;
  v_id       uuid;
  v_card     text;
  v_conf     text;
  v_attempt  int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_club_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_club');
  END IF;
  -- Authz: caller must be staff of THIS club (never trust the parameter alone) — P1-F.
  IF NOT (public.is_club_cashier(v_caller, p_club_id)
       OR public.is_club_admin(v_caller, p_club_id)
       OR public.is_club_owner(v_caller, p_club_id)
       OR public.has_role(v_caller, 'super_admin'::app_role)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- No anchor -> do NOT create junk. Caller keeps member_id NULL (P1-A).
  IF p_player_user_id IS NULL AND v_canon IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'member_id', NULL, 'match_confidence', 'no_anchor');
  END IF;

  -- Path A: known auth user -> key on (club_id, player_user_id).
  IF p_player_user_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.club_members
      WHERE club_id = p_club_id AND player_user_id = p_player_user_id
      LIMIT 1;
    IF FOUND THEN
      -- COALESCE-only backfill: never overwrite an existing non-null value (P1-C).
      UPDATE public.club_members SET
        full_name       = COALESCE(full_name, v_name),
        phone           = COALESCE(phone, p_phone),
        phone_canonical = COALESCE(phone_canonical, v_canon),
        updated_at      = now()
      WHERE id = v_existing.id;
      RETURN jsonb_build_object('ok', true, 'member_id', v_existing.id, 'match_confidence', 'user_match');
    END IF;
    LOOP
      v_attempt := v_attempt + 1;
      v_card := 'W' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 11));
      BEGIN
        INSERT INTO public.club_members
          (club_id, member_card_id, full_name, phone, phone_canonical, player_user_id, source)
        VALUES
          (p_club_id, v_card, v_name, p_phone, v_canon, p_player_user_id, 'auto_online')
        ON CONFLICT (club_id, player_user_id) WHERE player_user_id IS NOT NULL
          DO UPDATE SET
            full_name       = COALESCE(club_members.full_name, EXCLUDED.full_name),
            phone_canonical = COALESCE(club_members.phone_canonical, EXCLUDED.phone_canonical),
            updated_at      = now()
        RETURNING id INTO v_id;
        RETURN jsonb_build_object('ok', true, 'member_id', v_id, 'match_confidence', 'user_created');
      EXCEPTION WHEN unique_violation THEN
        -- rare synthetic member_card_id collision -> retry a fresh card
        IF v_attempt >= 3 THEN RAISE; END IF;
      END;
    END LOOP;
  END IF;

  -- Path B: walk-in -> key on (club_id, phone_canonical). (v_canon is NOT NULL here.)
  SELECT * INTO v_existing FROM public.club_members
    WHERE club_id = p_club_id AND phone_canonical = v_canon
    LIMIT 1;
  IF FOUND THEN
    -- Same phone but a materially different name -> flag it, do NOT overwrite / merge (P1-H).
    IF v_existing.full_name IS NOT NULL AND v_name IS NOT NULL
       AND lower(trim(v_existing.full_name)) <> lower(trim(v_name)) THEN
      v_conf := 'phone_match_name_conflict';
    ELSE
      v_conf := 'phone_match';
    END IF;
    UPDATE public.club_members SET
      full_name  = COALESCE(full_name, v_name),   -- COALESCE-only (P1-C)
      updated_at = now()
    WHERE id = v_existing.id;
    RETURN jsonb_build_object('ok', true, 'member_id', v_existing.id, 'match_confidence', v_conf);
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_card := 'W' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 11));
    BEGIN
      INSERT INTO public.club_members
        (club_id, member_card_id, full_name, phone, phone_canonical, source)
      VALUES
        (p_club_id, v_card, v_name, p_phone, v_canon, 'auto_walkin')
      ON CONFLICT (club_id, phone_canonical) WHERE phone_canonical IS NOT NULL
        DO UPDATE SET
          full_name  = COALESCE(club_members.full_name, EXCLUDED.full_name),
          updated_at = now()
      RETURNING id INTO v_id;
      RETURN jsonb_build_object('ok', true, 'member_id', v_id, 'match_confidence', 'phone_created');
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 6 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;

-- 7) Grants: immutable helper is safe for authenticated; the resolver is authenticated-only
--    (anon revoked; authz enforced inside on auth.uid()).
REVOKE ALL ON FUNCTION public.normalize_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.find_or_create_club_member(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_or_create_club_member(uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_club_member(uuid, text, text, uuid) TO authenticated, service_role;
