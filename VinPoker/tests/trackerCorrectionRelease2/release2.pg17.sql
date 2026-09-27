\set ON_ERROR_STOP on

DO $assertions$
DECLARE
  v_report oid := pg_catalog.to_regprocedure(
    'public.report_tracker_wrong_action_v1(uuid,uuid,uuid,uuid,jsonb,bigint,uuid)'
  );
  v_undo oid := pg_catalog.to_regprocedure(
    'public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'
  );
BEGIN
  IF v_report IS NULL OR v_undo IS NULL THEN
    RAISE EXCEPTION 'tracker_correction_release2_rpc_missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_report, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_report, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_report, 'EXECUTE') THEN
    RAISE EXCEPTION 'wrong_action_report_grants_wrong';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_undo, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_undo, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_undo, 'EXECUTE') THEN
    RAISE EXCEPTION 'durable_undo_grants_wrong';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tracker_correction_uat_scopes WHERE enabled) THEN
    RAISE EXCEPTION 'tracker_correction_scope_enabled_by_default';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'trg_block_tracker_action_while_correction_pending'
      AND tgrelid = 'public.hand_actions'::regclass AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'trg_block_tracker_hand_progress_while_correction_pending'
      AND tgrelid = 'public.tournament_hands'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'correction_pending_progress_guard_missing';
  END IF;
  IF public.report_tracker_wrong_action_v1(
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  )->>'error' IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'wrong_action_invalid_request_guard_missing';
  END IF;
  IF public.undo_tracker_last_action_v1(
    NULL, NULL, NULL, NULL, NULL, NULL
  )->>'error' IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'undo_invalid_request_guard_missing';
  END IF;
END;
$assertions$;

SELECT 'TRACKER_CORRECTION_RELEASE2_PG17_CATALOG_PASS' AS result;
