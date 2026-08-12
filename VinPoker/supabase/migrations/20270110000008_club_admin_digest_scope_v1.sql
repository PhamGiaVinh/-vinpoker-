-- Owner Daily Digest V1 — Club Admin read scope.
--
-- SOURCE-ONLY / RED: this migration is not applied by this change. Applying it requires
-- the controlled DB runbook, TEST cross-club authorization tests, and owner approval.
--
-- A global `club_admin` role is not a read-all-clubs permission. This table records the
-- explicit Club + User scope required before a Club Admin can read that Club's digest.
--
-- ROLLBACK (only after confirming no active Club Admin needs the scope):
--   DROP FUNCTION IF EXISTS public.revoke_owner_daily_digest_club_admin_scope(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.grant_owner_daily_digest_club_admin_scope(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.list_owner_daily_digest_clubs();
--   DROP FUNCTION IF EXISTS public.can_read_owner_daily_digest(uuid, uuid);
--   DROP TABLE IF EXISTS public.owner_daily_digest_club_admin_scopes;
--   Recreate owner_daily_digest_reports_select_owner with only owner/super_admin access.

CREATE TABLE IF NOT EXISTS public.owner_daily_digest_club_admin_scopes (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);

COMMENT ON TABLE public.owner_daily_digest_club_admin_scopes IS
  'Explicit Club + User scope for read-only Owner Daily Digest access. A global club_admin role alone is insufficient.';

ALTER TABLE public.owner_daily_digest_club_admin_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_daily_digest_club_admin_scopes FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.owner_daily_digest_club_admin_scopes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.owner_daily_digest_club_admin_scopes TO service_role;

CREATE OR REPLACE FUNCTION public.can_read_owner_daily_digest(
  p_user_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.owner_daily_digest_club_admin_scopes scope
      WHERE scope.club_id = p_club_id
        AND scope.user_id = p_user_id
        AND public.has_role(p_user_id, 'club_admin'::public.app_role)
    );
$function$;

REVOKE ALL ON FUNCTION public.can_read_owner_daily_digest(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_owner_daily_digest(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_owner_daily_digest_club_admin_scope(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'club_id and user_id are required' USING ERRCODE = '22023';
  END IF;

  IF v_actor_id IS NULL OR NOT (
    public.has_role(v_actor_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = p_club_id
        AND c.owner_id = v_actor_id
    )
  ) THEN
    RAISE EXCEPTION 'not authorized to grant this Club scope' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_role(p_user_id, 'club_admin'::public.app_role) THEN
    RAISE EXCEPTION 'target user must already have club_admin role' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.owner_daily_digest_club_admin_scopes (club_id, user_id, granted_by)
  VALUES (p_club_id, p_user_id, v_actor_id)
  ON CONFLICT (club_id, user_id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_owner_daily_digest_club_admin_scope(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'club_id and user_id are required' USING ERRCODE = '22023';
  END IF;

  IF v_actor_id IS NULL OR NOT (
    public.has_role(v_actor_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = p_club_id
        AND c.owner_id = v_actor_id
    )
  ) THEN
    RAISE EXCEPTION 'not authorized to revoke this Club scope' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.owner_daily_digest_club_admin_scopes
  WHERE club_id = p_club_id
    AND user_id = p_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.grant_owner_daily_digest_club_admin_scope(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_owner_daily_digest_club_admin_scope(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_owner_daily_digest_club_admin_scope(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_owner_daily_digest_club_admin_scope(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.list_owner_daily_digest_clubs()
RETURNS TABLE (club_id uuid, club_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT c.id, c.name
  FROM public.clubs c
  WHERE c.owner_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
    OR public.can_read_owner_daily_digest((SELECT auth.uid()), c.id)
  ORDER BY c.name ASC, c.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.list_owner_daily_digest_clubs()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_owner_daily_digest_clubs()
  TO authenticated;

DROP POLICY IF EXISTS owner_daily_digest_reports_select_owner ON public.owner_daily_digest_reports;
CREATE POLICY owner_daily_digest_reports_select_owner
  ON public.owner_daily_digest_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = owner_daily_digest_reports.club_id
        AND (
          c.owner_id = (SELECT auth.uid())
          OR public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
          OR public.can_read_owner_daily_digest((SELECT auth.uid()), owner_daily_digest_reports.club_id)
        )
    )
  );
