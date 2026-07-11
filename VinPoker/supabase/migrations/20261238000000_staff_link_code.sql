-- ═══════════════════════════════════════════════════════════════════════════════
-- Staff self-link by INVITE CODE (Kế toán / danh bạ) — SOURCE-ONLY: NOT applied live.
--
-- Apply is a SEPARATE owner-gated controlled op (Management API -> verify grants/DEFINER/
-- search_path/RLS -> types regen). NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
-- WHY: today a staff member is linked ONLY when an owner/accountant runs staff_link_user
-- (picking the auth user). This adds a self-service path (the "mã mời" promised in
-- StaffNotLinkedScreen) so staff link THEMSELVES: owner/accountant generates a one-time code
-- for an unlinked staff row; the staff logs into the app and redeems it in the /staff portal.
-- NO Telegram, NO edge function (that is a LATER layer that can reuse this same code).
--
-- SECURITY: the redeem binds auth.uid() (the caller = the staff themselves), NOT a client id.
-- First-link-wins is unchanged and concurrency-safe (UPDATE … WHERE user_id IS NULL RETURNING —
-- exactly one racer wins; the loser gets ALREADY_LINKED). The code is one-time (cleared on
-- redeem), expires (14 days), unique, and 12 hex chars (48-bit; widened per review). Redeem also
-- guards the one-active-row-per-club invariant (uq_staff_user_per_club) with a clean error.
-- Auth link stays SEPARATE from any future
-- telegram link. Writes the existing staff_link_audit ledger (from 20261236000000).
--
-- WHAT (additive, idempotent):
--   1. staff.link_code + link_code_expires_at columns + partial unique index.
--   2. staff_generate_link_code(staff_id) — owner/accountant; unlinked staff only; returns code.
--   3. staff_redeem_link_code(code)      — the staff (auth.uid()) binds themselves; one-time.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS link_code text;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS link_code_expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_link_code ON public.staff (link_code) WHERE link_code IS NOT NULL;

-- ── 1. Generate / refresh an invite code (owner + accountant; unlinked staff only) ──
CREATE OR REPLACE FUNCTION public.staff_generate_link_code(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club_id uuid;
  v_user    uuid;
  v_code    text;
  v_exp     timestamptz := now() + interval '14 days';
  v_rows    int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT club_id, user_id INTO v_club_id, v_user
  FROM public.staff WHERE id = p_staff_id AND deleted_at IS NULL;
  IF v_club_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF NOT (public.is_club_owner(v_uid, v_club_id)
          OR public.is_club_accountant(v_uid, v_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF v_user IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'ALREADY_LINKED');
  END IF;

  -- 12 hex chars = 48-bit space (this is a bearer credential to a staff identity; widened per
  -- review from 8/32-bit). Retry on the astronomically-rare global code collision
  -- (uq_staff_link_code) instead of letting a raw 23505 escape.
  FOR i IN 1..5 LOOP
    v_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12));
    BEGIN
      UPDATE public.staff
      SET link_code = v_code, link_code_expires_at = v_exp, updated_at = now()
      WHERE id = p_staff_id AND user_id IS NULL AND deleted_at IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      EXIT;  -- no collision → done (v_rows says whether the row was still eligible)
    EXCEPTION WHEN unique_violation THEN
      v_code := NULL;  -- code collided with another live code → regenerate and retry
    END;
  END LOOP;

  IF v_code IS NULL THEN
    RETURN jsonb_build_object('error', 'CODE_GEN_FAILED');  -- 5 collisions in a row (never in practice)
  END IF;
  IF v_rows = 0 THEN
    -- The row was linked or removed between the SELECT check and the UPDATE (TOCTOU): the code
    -- was NOT persisted, so do NOT hand back an unusable code — report the real state instead.
    RETURN jsonb_build_object('error', 'ALREADY_LINKED');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'code', v_code, 'expires_at', v_exp);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_generate_link_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_generate_link_code(uuid) TO authenticated;

-- ── 2. Redeem — the STAFF (auth.uid()) links themselves; one-time, first-link-wins ──
CREATE OR REPLACE FUNCTION public.staff_redeem_link_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_staff record;
  v_won   uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF length(v_code) < 6 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'code');
  END IF;

  SELECT id, club_id, user_id, link_code_expires_at INTO v_staff
  FROM public.staff WHERE link_code = v_code AND deleted_at IS NULL;
  IF v_staff.id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF v_staff.user_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'ALREADY_LINKED'); END IF;
  IF v_staff.link_code_expires_at IS NOT NULL AND v_staff.link_code_expires_at < now() THEN
    RETURN jsonb_build_object('error', 'EXPIRED');
  END IF;

  -- A uid may hold at most ONE active staff row per club (uq_staff_user_per_club). If the caller
  -- is already linked to a DIFFERENT active row in THIS club, fail cleanly instead of a raw 23505.
  IF EXISTS (SELECT 1 FROM public.staff
             WHERE club_id = v_staff.club_id AND user_id = v_uid AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'ALREADY_LINKED_ELSEWHERE');
  END IF;

  -- Concurrency-safe first-link-wins + one-time (clear the code on success). The EXCEPTION guards
  -- the race window where a concurrent link created the (club, uid) pair after the check above.
  BEGIN
    UPDATE public.staff
    SET user_id = v_uid, link_code = NULL, link_code_expires_at = NULL, updated_at = now()
    WHERE id = v_staff.id AND user_id IS NULL AND deleted_at IS NULL
    RETURNING user_id INTO v_won;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'ALREADY_LINKED_ELSEWHERE');
  END;

  IF v_won IS NULL THEN RETURN jsonb_build_object('error', 'ALREADY_LINKED'); END IF;

  INSERT INTO public.staff_link_audit (staff_id, club_id, user_id, actor)
  VALUES (v_staff.id, v_staff.club_id, v_uid, v_uid);

  RETURN jsonb_build_object('status', 'ok', 'staff_id', v_staff.id, 'club_id', v_staff.club_id);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_redeem_link_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_redeem_link_code(text) TO authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Controlled-apply TEST PLAN (tx + ROLLBACK; <owner>/<acct> operate <club>, <emp> is the
-- staff's own auth user, <staffrow> an unlinked staff of <club>):
--   BEGIN;
--     SET LOCAL request.jwt.claim.sub = '<acct>';
--     SELECT public.staff_generate_link_code('<staffrow>');            -- ok → {code}
--     SET LOCAL request.jwt.claim.sub = '<emp>';
--     SELECT public.staff_redeem_link_code('<code>');                  -- ok (binds <emp>)
--     SELECT public.staff_redeem_link_code('<code>');                  -- NOT_FOUND (one-time, cleared)
--     SET LOCAL request.jwt.claim.sub = '<acct>';
--     SELECT public.staff_generate_link_code('<staffrow>');            -- ALREADY_LINKED
--     SET LOCAL request.jwt.claim.sub = '<other_no_role>';
--     SELECT public.staff_generate_link_code('<staffrow2>');           -- Forbidden
--   ROLLBACK;
-- VERIFY: prosrc has auth.uid() bind; both fns SECURITY DEFINER + search_path=public; no anon EXECUTE.
-- ROLLBACK (undo):
--   DROP FUNCTION IF EXISTS public.staff_redeem_link_code(text);
--   DROP FUNCTION IF EXISTS public.staff_generate_link_code(uuid);
--   DROP INDEX IF EXISTS public.uq_staff_link_code;
--   ALTER TABLE public.staff DROP COLUMN IF EXISTS link_code_expires_at;
--   ALTER TABLE public.staff DROP COLUMN IF EXISTS link_code;
-- ═══════════════════════════════════════════════════════════════════════════════
