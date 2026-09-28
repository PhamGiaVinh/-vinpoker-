\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'dealer_swing_uat_failed: %', message; END IF;
END $$;

SELECT pg_temp.assert_true(
  has_function_privilege('authenticated','public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE'),
  'only contained entrypoints are callable');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  BEGIN
    PERFORM public.operator_perform_swing(
      'd1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      'd1000000-0000-4000-8000-000000000003', 1,
      'd1000000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'operator call unexpectedly accepted without an actor';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%SWING_OPERATOR_UNAUTHENTICATED%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ BEGIN
  BEGIN
    PERFORM public.worker_perform_swing(
      'd1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      'd1000000-0000-4000-8000-000000000003', 30, false, 15, 60, 1, NULL, 0);
    RAISE EXCEPTION 'missing exact context unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%SWING_TABLE_NOT_FOUND%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SELECT 'DEALER_SWING_INDEPENDENT_PG17_PASS' AS result;
