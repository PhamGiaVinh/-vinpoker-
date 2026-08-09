-- Ops Unified Workspace V3: caller-bound raw capability contract.
-- SOURCE ONLY. Production apply requires the owner-gated migration runbook.
--
-- Capability booleans intentionally describe direct club ownership or direct
-- membership only. Module inheritance (owner/super-admin) belongs to the
-- frontend runtime registry and is not materialized as fake memberships.

BEGIN;

DO $preflight$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_table text;
  v_kind_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'clubs',
    'user_roles',
    'club_floors',
    'club_cashiers',
    'club_trackers',
    'club_dealer_controls',
    'club_accountants',
    'club_chip_masters',
    'club_marketers',
    'club_fnb_staff'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      v_missing := array_append(v_missing, 'public.' || v_table);
    END IF;
  END LOOP;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    v_missing := array_append(v_missing, 'auth.uid()');
  END IF;
  IF to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    v_missing := array_append(v_missing, 'public.has_role(uuid,public.app_role)');
  END IF;
  IF to_regtype('public.fnb_role_kind') IS NULL THEN
    v_missing := array_append(v_missing, 'public.fnb_role_kind');
  ELSE
    SELECT count(*)
    INTO v_kind_count
    FROM pg_catalog.pg_enum e
    WHERE e.enumtypid = 'public.fnb_role_kind'::regtype
      AND e.enumlabel IN ('cashier', 'server', 'kitchen');
    IF v_kind_count <> 3 THEN
      v_missing := array_append(v_missing, 'public.fnb_role_kind facets');
    END IF;
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'OPS_V3_CAPABILITY_DEPENDENCY_MISSING: %', array_to_string(v_missing, ', ')
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_my_ops_capability_scope()
RETURNS TABLE (
  club_id uuid,
  can_owner boolean,
  can_floor boolean,
  can_cashier boolean,
  can_tracker boolean,
  can_dealer_control boolean,
  can_accountant boolean,
  can_chip_master boolean,
  can_marketer boolean,
  can_fnb_cashier boolean,
  can_fnb_server boolean,
  can_fnb_kitchen boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH scope_rows (
    club_id,
    can_owner,
    can_floor,
    can_cashier,
    can_tracker,
    can_dealer_control,
    can_accountant,
    can_chip_master,
    can_marketer,
    can_fnb_cashier,
    can_fnb_server,
    can_fnb_kitchen
  ) AS (
    SELECT
      c.id,
      true, false, false, false, false, false, false, false, false, false, false
    FROM public.clubs c
    WHERE c.owner_id = v_actor

    UNION ALL
    SELECT cf.club_id,
      false, true, false, false, false, false, false, false, false, false, false
    FROM public.club_floors cf
    WHERE cf.user_id = v_actor

    UNION ALL
    SELECT cc.club_id,
      false, false, true, false, false, false, false, false, false, false, false
    FROM public.club_cashiers cc
    WHERE cc.user_id = v_actor

    UNION ALL
    SELECT ct.club_id,
      false, false, false, true, false, false, false, false, false, false, false
    FROM public.club_trackers ct
    WHERE ct.user_id = v_actor

    UNION ALL
    SELECT dc.club_id,
      false, false, false, false, true, false, false, false, false, false, false
    FROM public.club_dealer_controls dc
    WHERE dc.user_id = v_actor

    UNION ALL
    SELECT ca.club_id,
      false, false, false, false, false, true, false, false, false, false, false
    FROM public.club_accountants ca
    WHERE ca.user_id = v_actor

    UNION ALL
    SELECT cm.club_id,
      false, false, false, false, false, false, true, false, false, false, false
    FROM public.club_chip_masters cm
    WHERE cm.user_id = v_actor

    UNION ALL
    SELECT mk.club_id,
      false, false, false, false, false, false, false, true, false, false, false
    FROM public.club_marketers mk
    WHERE mk.user_id = v_actor

    UNION ALL
    SELECT fs.club_id,
      false, false, false, false, false, false, false, false,
      fs.kind = 'cashier'::public.fnb_role_kind,
      fs.kind = 'server'::public.fnb_role_kind,
      fs.kind = 'kitchen'::public.fnb_role_kind
    FROM public.club_fnb_staff fs
    WHERE fs.user_id = v_actor
  )
  SELECT
    sr.club_id,
    bool_or(sr.can_owner) AS can_owner,
    bool_or(sr.can_floor) AS can_floor,
    bool_or(sr.can_cashier) AS can_cashier,
    bool_or(sr.can_tracker) AS can_tracker,
    bool_or(sr.can_dealer_control) AS can_dealer_control,
    bool_or(sr.can_accountant) AS can_accountant,
    bool_or(sr.can_chip_master) AS can_chip_master,
    bool_or(sr.can_marketer) AS can_marketer,
    bool_or(sr.can_fnb_cashier) AS can_fnb_cashier,
    bool_or(sr.can_fnb_server) AS can_fnb_server,
    bool_or(sr.can_fnb_kitchen) AS can_fnb_kitchen
  FROM scope_rows sr
  GROUP BY sr.club_id
  ORDER BY sr.club_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_ops_global_capability()
RETURNS TABLE (is_super_admin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT public.has_role(v_actor, 'super_admin'::public.app_role);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_ops_clubs_for_super_admin(
  p_search text DEFAULT NULL,
  p_after_name text DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (club_id uuid, club_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_limit integer;
  v_search text := nullif(btrim(p_search), '');
BEGIN
  IF v_actor IS NULL
    OR NOT public.has_role(v_actor, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF (p_after_name IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_requires_name_and_id' USING ERRCODE = '22023';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  RETURN QUERY
  SELECT c.id, c.name
  FROM public.clubs c
  WHERE (
    v_search IS NULL
    OR c.name ILIKE '%' || v_search || '%'
    OR c.id::text = v_search
  )
    AND (
      p_after_name IS NULL
      OR (lower(c.name), c.id) > (lower(p_after_name), p_after_id)
    )
  ORDER BY lower(c.name), c.id
  LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_ops_capability_scope() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_my_ops_global_capability() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_ops_clubs_for_super_admin(text, text, uuid, integer)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_ops_capability_scope() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_ops_global_capability() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ops_clubs_for_super_admin(text, text, uuid, integer)
  TO authenticated;

COMMENT ON FUNCTION public.get_my_ops_capability_scope() IS
  'Caller-bound raw club capability rows. Does not expand super-admin to every club.';
COMMENT ON FUNCTION public.get_my_ops_global_capability() IS
  'Caller-bound global Ops capability. Currently exposes only super-admin state.';
COMMENT ON FUNCTION public.list_ops_clubs_for_super_admin(text, text, uuid, integer) IS
  'Bounded, cursor-paginated club selector for the authenticated super-admin caller.';

-- ROLLBACK (owner-gated forward migration only):
-- DROP FUNCTION IF EXISTS public.list_ops_clubs_for_super_admin(text, text, uuid, integer);
-- DROP FUNCTION IF EXISTS public.get_my_ops_global_capability();
-- DROP FUNCTION IF EXISTS public.get_my_ops_capability_scope();

COMMIT;
