\set ON_ERROR_STOP on

DO $assertions$
DECLARE
  v_authorize oid := pg_catalog.to_regprocedure(
    'public.authorize_tracker_completed_hand_correction_uat_v1(uuid,uuid)'
  );
  v_writer oid := pg_catalog.to_regprocedure(
    'public.commit_tracker_hand_correction_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text)'
  );
BEGIN
  IF v_authorize IS NULL OR v_writer IS NULL THEN
    RAISE EXCEPTION 'tracker_correction_release3_dependency_missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_authorize, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_authorize, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_authorize, 'EXECUTE') THEN
    RAISE EXCEPTION 'completed_hand_authorizer_grants_wrong';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_writer, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_writer, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_writer, 'EXECUTE') THEN
    RAISE EXCEPTION 'completed_hand_writer_grants_wrong';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tracker_correction_uat_scopes
    WHERE capability = 'correct_completed_hand' AND enabled
  ) THEN
    RAISE EXCEPTION 'completed_hand_correction_enabled_by_default';
  END IF;
  IF public.authorize_tracker_completed_hand_correction_uat_v1(NULL, NULL)->>'error'
    IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'completed_hand_authorizer_invalid_request_guard_missing';
  END IF;
END;
$assertions$;

SELECT 'TRACKER_CORRECTION_RELEASE3_PG17_CATALOG_PASS' AS result;
