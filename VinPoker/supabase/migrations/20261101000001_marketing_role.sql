-- Marketing module (MKT-1, A2) — club-scoped Marketing role. DEPENDS ON 000000 (enum value).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply 000000 (enum) FIRST + verify, THEN
-- this in a controlled session (Management API / `supabase db query --linked --file`, NOT
-- `db push` / not deploy_db). Regen types.ts in a SEPARATE step. schema_migrations is NOT touched.
--
-- WHY: a club-scoped **Marketing** operator role lets an owner delegate marketing/social posting
-- for specific club(s) without granting club ownership. Shape mirrors public.club_chip_masters
-- (20261016000000) and public.club_trackers (20260611000001) exactly.
--
-- WHAT (additive, idempotent):
--   1. public.club_marketers membership table + RLS.
--   2. public.is_club_marketer(_user_id,_club_id) — SECURITY DEFINER STABLE pure lookup.
--   3. public.marketer_club_ids(_user_id) — SETOF uuid (own memberships + owned clubs + all if
--      super_admin); used as the membership filter by the MKT-2 marketing_posts RLS.
--   4. Owner-gated grant/revoke RPCs (no self-escalation — a marketer CANNOT grant).
--
-- The 'marketing' app_role value (000000) is for coarse UI affordance ONLY (showing the nav
-- entry). ALL data authority is enforced by club_marketers membership via the helpers below — a
-- global 'marketing' role is NEVER a read-all-clubs grant.

-- ===========================================================================================
-- 1. Role membership table (shape mirrors public.club_chip_masters).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.club_marketers (
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_marketers_pkey PRIMARY KEY (club_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_marketer_user ON public.club_marketers(user_id);

ALTER TABLE public.club_marketers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_marketers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.club_marketers TO authenticated;

-- A member reads their own row; the club owner (+ super_admin via the helper) reads all rows of
-- their club. Writes are default-deny → only the owner-gated grant/revoke RPCs below.
DROP POLICY IF EXISTS club_marketers_select ON public.club_marketers;
CREATE POLICY club_marketers_select ON public.club_marketers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_club_owner(auth.uid(), club_id));

-- ===========================================================================================
-- 2. Membership helper — pure lookup. Pass auth.uid() in policies so a caller can only test
--    their own membership.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.is_club_marketer(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_marketers m
    WHERE m.user_id = _user_id AND m.club_id = _club_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_club_marketer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_marketer(uuid, uuid) TO authenticated;

-- ===========================================================================================
-- 3. Club-scope helper — SETOF uuid (mirrors public.tracker_club_ids). The set of clubs the
--    user may act on for marketing: assigned memberships + owned clubs + ALL clubs if super_admin.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketer_club_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.club_marketers WHERE user_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE owner_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE public.has_role(_user_id, 'super_admin'::public.app_role)
$$;

REVOKE ALL ON FUNCTION public.marketer_club_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketer_club_ids(uuid) TO authenticated;

-- ===========================================================================================
-- 4. Owner-gated grant/revoke RPCs. is_club_owner ONLY (covers super_admin) — a marketer
--    CANNOT grant/revoke (no self-escalation).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_grant_marketer(
  p_club_id uuid,
  p_user_id uuid
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
  INSERT INTO public.club_marketers (club_id, user_id, granted_by)
  VALUES (p_club_id, p_user_id, v_uid)
  ON CONFLICT (club_id, user_id) DO NOTHING;
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_revoke_marketer(
  p_club_id uuid,
  p_user_id uuid
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
  DELETE FROM public.club_marketers WHERE club_id = p_club_id AND user_id = p_user_id;
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.marketing_grant_marketer(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_revoke_marketer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_grant_marketer(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_revoke_marketer(uuid, uuid) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 000000 + verify enum FIRST, then this; run in a tx + ROLLBACK).
--   <owner> owns <club>; <mk> is a marketer to be granted; <other> is unrelated.
--
-- BEGIN;
--   -- grant/revoke authz (owner only):
--   SET LOCAL request.jwt.claim.sub = '<owner>'; SELECT public.marketing_grant_marketer('<club>','<mk>');    -- ok
--   SET LOCAL request.jwt.claim.sub = '<mk>';    SELECT public.marketing_grant_marketer('<club>','<other>'); -- Forbidden (no self-escalation)
--   -- membership + scope helpers:
--   SELECT public.is_club_marketer('<mk>','<club>');            -- true
--   SELECT public.is_club_marketer('<other>','<club>');         -- false
--   SELECT array_agg(x) FROM public.marketer_club_ids('<mk>') x;-- contains <club>
--   SELECT array_agg(x) FROM public.marketer_club_ids('<other>') x; -- does NOT contain <club>
--   -- revoke removes membership:
--   SET LOCAL request.jwt.claim.sub = '<owner>'; SELECT public.marketing_revoke_marketer('<club>','<mk>');
--   SELECT public.is_club_marketer('<mk>','<club>');            -- false again
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.marketing_revoke_marketer(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.marketing_grant_marketer(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.marketer_club_ids(uuid);
--   DROP FUNCTION IF EXISTS public.is_club_marketer(uuid, uuid);
--   DROP TABLE IF EXISTS public.club_marketers;
--   -- (the 'marketing' enum value from 000000 cannot be dropped without recreating app_role;
--   --  leaving an unused enum value is harmless.)
-- ===========================================================================================
