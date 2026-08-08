-- PostgreSQL 17 runtime assertions for 20270110000000_ops_unified_capability_scope.sql.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.test_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'OPS_V3_CAPABILITY_ASSERT: %', p_message;
  END IF;
END;
$$;

-- The RPC is caller-bound and has no spoofable user-id overload.
SELECT public.test_assert(
  pg_get_function_identity_arguments('public.get_my_ops_capability_scope()'::regprocedure) = '',
  'scope has no user argument'
);
SELECT public.test_assert(
  to_regprocedure('public.get_my_ops_capability_scope(uuid)') IS NULL,
  'spoofable scope overload absent'
);

-- ACL and SECURITY DEFINER posture.
SELECT public.test_assert(has_function_privilege('authenticated', 'public.get_my_ops_capability_scope()', 'EXECUTE'), 'authenticated scope execute');
SELECT public.test_assert(NOT has_function_privilege('anon', 'public.get_my_ops_capability_scope()', 'EXECUTE'), 'anon scope denied');
SELECT public.test_assert(NOT has_function_privilege('service_role', 'public.get_my_ops_capability_scope()', 'EXECUTE'), 'service role scope denied');
SELECT public.test_assert(NOT has_function_privilege('anon', 'public.get_my_ops_global_capability()', 'EXECUTE'), 'anon global denied');
SELECT public.test_assert(NOT has_function_privilege('anon', 'public.list_ops_clubs_for_super_admin(text,text,uuid,integer)', 'EXECUTE'), 'anon club page denied');
SELECT public.test_assert(
  (SELECT prosecdef
          AND array_to_string(proconfig, ',') LIKE 'search_path=%'
          AND array_to_string(proconfig, ',') NOT LIKE '%public%'
   FROM pg_proc WHERE oid = 'public.get_my_ops_capability_scope()'::regprocedure),
  'scope uses security definer and empty search_path'
);

-- Owner is represented only by can_owner, not by fabricated memberships.
SET test.actor = '00000000-0000-4000-8000-000000000001';
SELECT public.test_assert(
  (SELECT count(*) = 1 AND bool_and(can_owner) AND NOT bool_or(can_floor OR can_cashier OR can_tracker OR can_dealer_control OR can_accountant OR can_chip_master OR can_marketer OR can_fnb_cashier OR can_fnb_server OR can_fnb_kitchen)
   FROM public.get_my_ops_capability_scope()),
  'owner remains raw ownership only'
);

-- Cross-club actor sees only three clubs, with facets aggregated per club.
SET test.actor = '00000000-0000-4000-8000-000000000003';
SELECT public.test_assert((SELECT count(*) = 3 FROM public.get_my_ops_capability_scope()), 'cross-club scope count');
SELECT public.test_assert(
  (SELECT can_floor AND can_marketer AND can_fnb_cashier AND can_fnb_kitchen
          AND NOT can_cashier AND NOT can_fnb_server
   FROM public.get_my_ops_capability_scope()
   WHERE club_id = '10000000-0000-4000-8000-000000000001'),
  'club A facets'
);
SELECT public.test_assert(
  (SELECT can_cashier AND can_accountant AND can_fnb_server
          AND NOT can_floor AND NOT can_fnb_cashier AND NOT can_fnb_kitchen
   FROM public.get_my_ops_capability_scope()
   WHERE club_id = '10000000-0000-4000-8000-000000000002'),
  'club B facets'
);
SELECT public.test_assert(
  (SELECT can_tracker AND can_dealer_control AND can_chip_master
   FROM public.get_my_ops_capability_scope()
   WHERE club_id = '10000000-0000-4000-8000-000000000003'),
  'club C facets'
);
SELECT public.test_assert(
  NOT EXISTS (SELECT 1 FROM public.get_my_ops_capability_scope() WHERE club_id = '10000000-0000-4000-8000-000000000004'),
  'cross-club spoof denied'
);

-- Revocation is visible on the next caller-bound read.
DELETE FROM public.club_trackers
WHERE club_id = '10000000-0000-4000-8000-000000000003'
  AND user_id = '00000000-0000-4000-8000-000000000003';
SELECT public.test_assert(
  (SELECT NOT can_tracker FROM public.get_my_ops_capability_scope()
   WHERE club_id = '10000000-0000-4000-8000-000000000003'),
  'tracker revocation reflected'
);

-- Super-admin is global and does not receive all clubs in the login scope.
SET test.actor = '00000000-0000-4000-8000-000000000005';
SELECT public.test_assert((SELECT is_super_admin FROM public.get_my_ops_global_capability()), 'super-admin global flag');
SELECT public.test_assert((SELECT count(*) = 0 FROM public.get_my_ops_capability_scope()), 'super-admin login scope bounded');
SELECT public.test_assert((SELECT count(*) = 2 FROM public.list_ops_clubs_for_super_admin(NULL, NULL, NULL, 2)), 'super-admin bounded page');
SELECT public.test_assert((SELECT count(*) = 1 FROM public.list_ops_clubs_for_super_admin('char', NULL, NULL, 50)), 'super-admin search');

-- Non-super users cannot use the global club browser.
SET test.actor = '00000000-0000-4000-8000-000000000004';
DO $$
BEGIN
  PERFORM public.list_ops_clubs_for_super_admin(NULL, NULL, NULL, 50);
  RAISE EXCEPTION 'OPS_V3_CAPABILITY_ASSERT: non-super club page unexpectedly allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

SELECT 'OPS_V3_CAPABILITY_PG17_PASS' AS result;
