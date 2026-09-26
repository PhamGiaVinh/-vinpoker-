\set ON_ERROR_STOP on

DO $assertions$
DECLARE
  v_function oid := pg_catalog.to_regprocedure(
    'public.report_tracker_floor_operational_alert_v2(uuid,uuid,uuid,uuid,text,text,uuid,jsonb,bigint)'
  );
BEGIN
  IF v_function IS NULL THEN RAISE EXCEPTION 'alert_v2_missing'; END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'alert_v2_grants_wrong';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tracker_floor_alerts'
      AND column_name = 'source_revision' AND data_type = 'bigint'
  ) THEN RAISE EXCEPTION 'alert_source_revision_missing'; END IF;
  IF public.report_tracker_floor_operational_alert_v2(
    NULL, NULL, NULL, NULL, 'call_floor', NULL, NULL, NULL, NULL
  )->>'error' IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'alert_v2_invalid_request_guard_missing';
  END IF;
END;
$assertions$;

SELECT 'TRACKER_CORRECTION_RELEASE1_PG17_CATALOG_PASS' AS result;
