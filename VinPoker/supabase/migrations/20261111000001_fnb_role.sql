-- F&B module (FNB-P1) — club-scoped F&B staff role. DEPENDS ON 20261111000000 (enum values).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply 20261111000000 (app_role values) FIRST
-- + verify, THEN this in a controlled session (Management API / `supabase db query --linked --file`,
-- NOT `db push` / not deploy_db). Regen types.ts in a SEPARATE step. schema_migrations is NOT touched.
--
-- WHY: a club-scoped **F&B staff** role lets an owner delegate F&B operations (counter cashier /
-- server / kitchen) for specific club(s) without granting club ownership. Shape mirrors
-- public.club_marketers (20261101000001), public.club_chip_masters (20261016000000) and
-- public.club_trackers (20260611000001) EXACTLY, plus one `kind` discriminator because F&B has three
-- distinct job functions (a single person may hold more than one).
--
-- WHAT (additive, idempotent):
--   0. public.fnb_role_kind enum ('cashier'|'server'|'kitchen') — created HERE (first use: the table
--      `kind` column + the grant/revoke RPC parameter). The shared app_role enum is NOT touched here.
--   1. public.club_fnb_staff membership table + RLS.
--   2. public.is_club_fnb(_user_id,_club_id) — true if the user holds ANY F&B facet at the club.
--      public.is_club_fnb_kind(_user_id,_club_id,_kind) — true for a SPECIFIC facet (e.g. cashier-only
--      money ops). Both SECURITY DEFINER STABLE pure lookups.
--   3. public.fnb_club_ids(_user_id) — SETOF uuid (own memberships + owned clubs + all if super_admin);
--      used as the membership filter by the P2+ F&B table RLS.
--   4. Owner-gated grant/revoke RPCs (is_club_owner ONLY — F&B staff CANNOT grant, no self-escalation).
--
-- The 'fnb_cashier'/'fnb_server'/'fnb_kitchen' app_role values (000000) are coarse UI affordance ONLY
-- (showing the right nav entry). ALL data authority is enforced by club_fnb_staff membership via the
-- helpers below — a global F&B enum value is NEVER a read-all-clubs grant.

-- ===========================================================================================
-- 0. Sub-role enum (new type — safe to create here; we do NOT touch the shared app_role enum).
-- ===========================================================================================
DO $$ BEGIN
  CREATE TYPE public.fnb_role_kind AS ENUM ('cashier', 'server', 'kitchen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================================
-- 1. Role membership table (shape mirrors public.club_marketers + a `kind` discriminator).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.club_fnb_staff (
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       public.fnb_role_kind NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_fnb_staff_pkey PRIMARY KEY (club_id, user_id, kind)  -- a user may hold >1 facet
);
CREATE INDEX IF NOT EXISTS idx_cfs_user ON public.club_fnb_staff(user_id);

ALTER TABLE public.club_fnb_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_fnb_staff FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.club_fnb_staff TO authenticated;

-- A member reads their own row; the club owner (+ super_admin via the helper) reads all rows of
-- their club. Writes are default-deny → only the owner-gated grant/revoke RPCs below.
DROP POLICY IF EXISTS club_fnb_staff_select ON public.club_fnb_staff;
CREATE POLICY club_fnb_staff_select ON public.club_fnb_staff
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_club_owner(auth.uid(), club_id));

-- ===========================================================================================
-- 2. Membership helpers — pure lookups. Pass auth.uid() in policies so a caller can only test
--    their own membership.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.is_club_fnb(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_fnb_staff s
    WHERE s.user_id = _user_id AND s.club_id = _club_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_club_fnb(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_fnb(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_club_fnb_kind(_user_id uuid, _club_id uuid, _kind public.fnb_role_kind)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_fnb_staff s
    WHERE s.user_id = _user_id AND s.club_id = _club_id AND s.kind = _kind
  );
$$;

REVOKE ALL ON FUNCTION public.is_club_fnb_kind(uuid, uuid, public.fnb_role_kind) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_fnb_kind(uuid, uuid, public.fnb_role_kind) TO authenticated;

-- ===========================================================================================
-- 3. Club-scope helper — SETOF uuid (mirrors public.marketer_club_ids). The set of clubs the user
--    may act on for F&B: assigned memberships + owned clubs + ALL clubs if super_admin.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_club_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.club_fnb_staff WHERE user_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE owner_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE public.has_role(_user_id, 'super_admin'::public.app_role)
$$;

REVOKE ALL ON FUNCTION public.fnb_club_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_club_ids(uuid) TO authenticated;

-- ===========================================================================================
-- 4. Owner-gated grant/revoke RPCs. is_club_owner ONLY (covers super_admin) — F&B staff CANNOT
--    grant/revoke (no self-escalation).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_grant_staff(
  p_club_id uuid,
  p_user_id uuid,
  p_kind    public.fnb_role_kind
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'user_id'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  INSERT INTO public.club_fnb_staff (club_id, user_id, kind, granted_by)
  VALUES (p_club_id, p_user_id, p_kind, v_uid)
  ON CONFLICT (club_id, user_id, kind) DO NOTHING;
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id, 'kind', p_kind);
END;
$$;

CREATE OR REPLACE FUNCTION public.fnb_revoke_staff(
  p_club_id uuid,
  p_user_id uuid,
  p_kind    public.fnb_role_kind
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  DELETE FROM public.club_fnb_staff WHERE club_id = p_club_id AND user_id = p_user_id AND kind = p_kind;
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id, 'kind', p_kind);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_grant_staff(uuid, uuid, public.fnb_role_kind)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_revoke_staff(uuid, uuid, public.fnb_role_kind) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_grant_staff(uuid, uuid, public.fnb_role_kind)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_revoke_staff(uuid, uuid, public.fnb_role_kind) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 000000 + verify enum FIRST, then this; run in a tx + ROLLBACK).
--   <owner> owns <club>; <st> is staff to be granted; <other> is unrelated.
--
-- BEGIN;
--   -- grant/revoke authz (owner only):
--   SET LOCAL request.jwt.claim.sub = '<owner>'; SELECT public.fnb_grant_staff('<club>','<st>','cashier');     -- ok
--   SET LOCAL request.jwt.claim.sub = '<st>';    SELECT public.fnb_grant_staff('<club>','<other>','cashier');  -- Forbidden (no self-escalation)
--   -- membership + scope helpers:
--   SELECT public.is_club_fnb('<st>','<club>');                  -- true
--   SELECT public.is_club_fnb_kind('<st>','<club>','cashier');   -- true
--   SELECT public.is_club_fnb_kind('<st>','<club>','kitchen');   -- false (only granted cashier)
--   SELECT public.is_club_fnb('<other>','<club>');               -- false
--   SELECT array_agg(x) FROM public.fnb_club_ids('<st>') x;      -- contains <club>
--   SELECT array_agg(x) FROM public.fnb_club_ids('<other>') x;   -- does NOT contain <club>
--   -- a user may hold multiple facets:
--   SET LOCAL request.jwt.claim.sub = '<owner>'; SELECT public.fnb_grant_staff('<club>','<st>','kitchen');
--   SELECT public.is_club_fnb_kind('<st>','<club>','kitchen');   -- true now
--   -- revoke removes only that facet:
--   SELECT public.fnb_revoke_staff('<club>','<st>','cashier');
--   SELECT public.is_club_fnb_kind('<st>','<club>','cashier');   -- false
--   SELECT public.is_club_fnb_kind('<st>','<club>','kitchen');   -- still true
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_revoke_staff(uuid, uuid, public.fnb_role_kind);
--   DROP FUNCTION IF EXISTS public.fnb_grant_staff(uuid, uuid, public.fnb_role_kind);
--   DROP FUNCTION IF EXISTS public.fnb_club_ids(uuid);
--   DROP FUNCTION IF EXISTS public.is_club_fnb_kind(uuid, uuid, public.fnb_role_kind);
--   DROP FUNCTION IF EXISTS public.is_club_fnb(uuid, uuid);
--   DROP TABLE IF EXISTS public.club_fnb_staff;
--   DROP TYPE IF EXISTS public.fnb_role_kind;
--   -- (the fnb_* app_role values from 000000 cannot be dropped without recreating app_role;
--   --  leaving unused enum values is harmless.)
-- ===========================================================================================
