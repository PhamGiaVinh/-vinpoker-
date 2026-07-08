-- ═══════════════════════════════════════════════════════════════════════════════
-- Staff Directory (Bước A) — NON-dealer staff registry. SOURCE-ONLY: NOT applied live.
--
-- Apply is a SEPARATE owner-gated controlled op (Management API: CREATE objects ->
-- verify grants/SECURITY DEFINER/search_path/RLS -> types regen). NO `supabase db push`,
-- NO deploy_db, NO schema_migrations edit here.
--
-- WHY: floor / cashier / tracker / service / security staff exist today only as auth
-- accounts + boolean club-scoped role grants (club_cashiers, club_trackers, club_floors…);
-- the club stores no HR record, no pay config, no attendance, no payroll line for them.
-- This is the registry that finally gives non-dealer staff a club-owned profile so their
-- labour cost can be recognised. DEALERS ARE UNAFFECTED — they keep their own live
-- `dealers` table + payroll chain; `staff` is a SEPARATE, parallel table (owner decision
-- 2026-07-07). Column subset mirrors the useful HR/pay fields of `dealers` (20261001*) plus
-- a `department` discriminator dealers do not need.
--
-- WHAT (additive, idempotent):
--   1. public.staff_department enum (floor|cashier|tracker|service|security) — HR/PAYROLL
--      classification ONLY. A `department='cashier'` row is a payroll record, NEVER a
--      permission — operator authority stays in club_cashiers / club_trackers / club_floors.
--   2. public.staff table + RLS (operator-read + staff self-read; NO write policy).
--   3. public.staff_upsert(...)   — Owner+Cashier create/edit (internal role check).
--   4. public.staff_link_user(...) — owner-only, first-link-wins (mirrors fnb_grant_staff).
--
-- Writes go ONLY through the SECURITY DEFINER RPCs (no INSERT/UPDATE/DELETE RLS policy),
-- so "never rely on RLS alone" holds. Staff payroll + the /staff portal UI are LATER
-- increments; this migration ships the directory + link only.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Department enum (new type; safe to create here) ───────────────────────
DO $$ BEGIN
  CREATE TYPE public.staff_department AS ENUM ('floor', 'cashier', 'tracker', 'service', 'security');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Staff registry table ──────────────────────────────────────────────────
-- Mirrors the HR/pay subset of public.dealers; adds `department`. Deliberately OMITS
-- dealer-specific columns (tier, skills, base_rate_vnd, ot_multiplier, dependents_count,
-- telegram_*, hired/joined_date) — add later only if a specific increment needs them.
CREATE TABLE IF NOT EXISTS public.staff (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                  uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- self-link axis (nullable)
  full_name                text NOT NULL,
  phone                    text,
  department               public.staff_department NOT NULL,
  employment_type          text NOT NULL DEFAULT 'full_time'
                             CHECK (employment_type IN ('full_time', 'part_time')),
  monthly_salary_vnd       bigint,                 -- FT
  hourly_rate_vnd          integer,                -- PT
  standard_hours_per_shift numeric,
  manual_bhxh_vnd          bigint,                 -- NULL=auto, 0=none, >0=exact (defer use to payroll increment)
  manual_tax_vnd           bigint,                 -- NULL=auto, 0=none, >0=exact
  status                   text NOT NULL DEFAULT 'active',
  deleted_at               timestamptz,            -- soft delete
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_club        ON public.staff (club_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_user        ON public.staff (user_id) WHERE deleted_at IS NULL;
-- A given auth user may hold at most ONE active staff row per club (multi-club allowed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_user_per_club
  ON public.staff (club_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff TO authenticated;

-- Operator read: super_admin / club_admin / club owner / club cashier of the row's club.
DROP POLICY IF EXISTS staff_select_operator ON public.staff;
CREATE POLICY staff_select_operator ON public.staff
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c
               WHERE c.id = staff.club_id AND c.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc
               WHERE cc.club_id = staff.club_id AND cc.user_id = auth.uid())
  );

-- Staff self read: own row via user_id = auth.uid() (powers the /staff portal identity hook).
DROP POLICY IF EXISTS staff_select_self ON public.staff;
CREATE POLICY staff_select_self ON public.staff
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- NO INSERT / UPDATE / DELETE policy → direct writes are denied; all writes go through the
-- owner/cashier-gated SECURITY DEFINER RPCs below.

-- ── 3. staff_upsert — Owner+Cashier create/edit ──────────────────────────────
-- p_staff_id NULL → INSERT a new staff row; non-NULL → UPDATE that row (must be same club).
-- Authz: super_admin / club_admin / owner / club cashier of p_club_id (Owner+Cashier precedent).
-- Actor is auth.uid() (never a client id). Returns the staff id.
CREATE OR REPLACE FUNCTION public.staff_upsert(
  p_club_id                  uuid,
  p_full_name                text,
  p_department               public.staff_department,
  p_employment_type          text    DEFAULT 'full_time',
  p_staff_id                 uuid    DEFAULT NULL,
  p_phone                    text    DEFAULT NULL,
  p_monthly_salary_vnd       bigint  DEFAULT NULL,
  p_hourly_rate_vnd          integer DEFAULT NULL,
  p_standard_hours_per_shift numeric DEFAULT NULL,
  p_manual_bhxh_vnd          bigint  DEFAULT NULL,
  p_manual_tax_vnd           bigint  DEFAULT NULL,
  p_status                   text    DEFAULT 'active'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'full_name');
  END IF;
  IF p_employment_type NOT IN ('full_time', 'part_time') THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'employment_type');
  END IF;

  -- Authz: operator of p_club_id (Owner+Cashier).
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_staff_id IS NULL THEN
    INSERT INTO public.staff (
      club_id, full_name, phone, department, employment_type,
      monthly_salary_vnd, hourly_rate_vnd, standard_hours_per_shift,
      manual_bhxh_vnd, manual_tax_vnd, status
    ) VALUES (
      p_club_id, btrim(p_full_name), p_phone, p_department, p_employment_type,
      p_monthly_salary_vnd, p_hourly_rate_vnd, p_standard_hours_per_shift,
      p_manual_bhxh_vnd, p_manual_tax_vnd, COALESCE(p_status, 'active')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.staff SET
      full_name                = btrim(p_full_name),
      phone                    = p_phone,
      department               = p_department,
      employment_type          = p_employment_type,
      monthly_salary_vnd       = p_monthly_salary_vnd,
      hourly_rate_vnd          = p_hourly_rate_vnd,
      standard_hours_per_shift = p_standard_hours_per_shift,
      manual_bhxh_vnd          = p_manual_bhxh_vnd,
      manual_tax_vnd           = p_manual_tax_vnd,
      status                   = COALESCE(p_status, 'active'),
      updated_at               = now()
    WHERE id = p_staff_id AND club_id = p_club_id AND deleted_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'NOT_FOUND', 'detail', 'staff row not in this club');
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'staff_id', v_id, 'club_id', p_club_id);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_upsert(uuid, text, public.staff_department, text, uuid, text, bigint, integer, numeric, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert(uuid, text, public.staff_department, text, uuid, text, bigint, integer, numeric, bigint, bigint, text) TO authenticated;

-- ── 4. staff_link_user — owner-only, first-link-wins ─────────────────────────
-- Binds an EXISTING auth user to a staff row so the person can log into the /staff portal.
-- Mirrors fnb_grant_staff: is_club_owner ONLY (covers super_admin) — no self-escalation.
-- First-link-wins: only sets user_id when currently NULL (idempotent; never steals a link).
CREATE OR REPLACE FUNCTION public.staff_link_user(
  p_staff_id uuid,
  p_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club_id uuid;
  v_current uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'user_id'); END IF;

  SELECT club_id, user_id INTO v_club_id, v_current
  FROM public.staff WHERE id = p_staff_id AND deleted_at IS NULL;
  IF v_club_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF NOT public.is_club_owner(v_uid, v_club_id) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  IF v_current IS NOT NULL THEN
    -- first-link-wins: idempotent no-op if already the same user, else refuse to steal.
    RETURN jsonb_build_object(
      'status', CASE WHEN v_current = p_user_id THEN 'ok' ELSE 'already_linked' END,
      'staff_id', p_staff_id, 'user_id', v_current
    );
  END IF;

  UPDATE public.staff SET user_id = p_user_id, updated_at = now()
  WHERE id = p_staff_id AND user_id IS NULL AND deleted_at IS NULL;

  RETURN jsonb_build_object('status', 'ok', 'staff_id', p_staff_id, 'user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_link_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_link_user(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Controlled-apply TEST PLAN (run in a tx + ROLLBACK; <owner> owns <club>, <cash> is a
-- club_cashier of <club>, <other> unrelated, <emp> the auth user to link).
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.staff_upsert('<club>','Nguyễn Văn A','floor');                    -- ok → staff_id
--   SET LOCAL request.jwt.claim.sub = '<cash>';
--   SELECT public.staff_upsert('<club>','Trần Thị B','cashier','part_time');        -- ok (cashier may manage)
--   SET LOCAL request.jwt.claim.sub = '<other>';
--   SELECT public.staff_upsert('<club>','Hack','floor');                            -- forbidden (42501)
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.staff_link_user('<staff_id>','<emp>');                            -- ok (first link)
--   SELECT public.staff_link_user('<staff_id>','<other>');                          -- already_linked (no steal)
--   SET LOCAL request.jwt.claim.sub = '<cash>';
--   SELECT public.staff_link_user('<staff_id2>','<emp>');                           -- Forbidden (owner-only)
--   SET LOCAL request.jwt.claim.sub = '<emp>';
--   SELECT id, department FROM public.staff WHERE user_id = '<emp>';                -- self-read sees own row
-- ROLLBACK;
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.staff_link_user(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.staff_upsert(uuid, text, public.staff_department, text, uuid, text, bigint, integer, numeric, bigint, bigint, text);
--   DROP TABLE IF EXISTS public.staff;
--   DROP TYPE IF EXISTS public.staff_department;
-- ═══════════════════════════════════════════════════════════════════════════════
