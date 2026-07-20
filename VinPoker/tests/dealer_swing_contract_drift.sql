\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'assertion failed: %', p_message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT enabled = false
      AND all_clubs_enabled = false
      AND allowed_club_ids = '{}'::uuid[]
   FROM public.dealer_mass_open_rollout WHERE id),
  'mass-open rollout must default OFF with an empty allowlist'
);

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dealer_open_operations'::regclass),
  'dealer_open_operations must have RLS enabled'
);
SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dealer_open_operation_targets'::regclass),
  'dealer_open_operation_targets must have RLS enabled'
);
SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.process_swing_dispatch_runs'::regclass),
  'process_swing_dispatch_runs must have RLS enabled'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'operator_open_dealer_tables'),
  'operator_open_dealer_tables must not have overload ambiguity'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'claim_process_swing_dispatch'),
  'claim_process_swing_dispatch must not have overload ambiguity'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'finish_process_swing_dispatch'),
  'finish_process_swing_dispatch must not have overload ambiguity'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'end_breaks_on_demand'),
  'end_breaks_on_demand must be restored exactly once by the forward migration'
);

SELECT pg_temp.assert_true(
  has_function_privilege('service_role', 'public.claim_process_swing_dispatch(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_process_swing_dispatch(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_process_swing_dispatch(uuid,uuid,uuid)', 'EXECUTE'),
  'claim RPC ACL must be service-role only'
);
SELECT pg_temp.assert_true(
  has_function_privilege('service_role', 'public.finish_process_swing_dispatch(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.finish_process_swing_dispatch(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.finish_process_swing_dispatch(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'),
  'finish RPC ACL must be service-role only'
);
SELECT pg_temp.assert_true(
  has_function_privilege('service_role', 'public.end_breaks_on_demand(uuid,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.end_breaks_on_demand(uuid,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.end_breaks_on_demand(uuid,integer,integer)', 'EXECUTE'),
  'end-break helper ACL must be service-role only'
);
SELECT pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.get_dealer_mass_open_rollout(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_dealer_mass_open_rollout(uuid)', 'EXECUTE'),
  'rollout read RPC ACL is wrong'
);
SELECT pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.get_dealer_open_operation(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_dealer_open_operation(uuid,uuid)', 'EXECUTE'),
  'operation read RPC ACL is wrong'
);
SELECT pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text)', 'EXECUTE'),
  'operator open RPC ACL is wrong'
);

SELECT pg_temp.assert_true(
  position('8000' in pg_get_functiondef('public.run_process_swing_cron()'::regprocedure)) = 0,
  'dispatcher must not restore the 8-second timeout'
);
SELECT pg_temp.assert_true(
  position('_http_response' in pg_get_functiondef('public.run_process_swing_cron()'::regprocedure)) = 0,
  'dispatcher must not read pg_net responses'
);
SELECT pg_temp.assert_true(
  position('_http_response' in pg_get_functiondef('public.observe_process_swing_cron(integer)'::regprocedure)) > 0,
  'observer must own the bounded pg_net response read'
);
SELECT pg_temp.assert_true(
  position('check_out_time IS NULL' in pg_get_functiondef('public.get_process_swing_due_club_ids()'::regprocedure)) > 0,
  'live due-club work filter must be preserved'
);
SELECT pg_temp.assert_true(
  (SELECT proconfig @> ARRAY['statement_timeout=1s']
   FROM pg_proc WHERE oid = 'public.observe_process_swing_cron(integer)'::regprocedure),
  'observer must retain a one-second statement timeout'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
   FROM cron.job
   WHERE active
     AND jobname IN ('process-swing', 'process-swing-observer')),
  'dispatcher and observer cron jobs must both be active'
);

SET session_replication_role = replica;
INSERT INTO public.clubs (id, name, region, status)
SELECT
  ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'Drift Test Club ' || i,
  'TEST',
  'approved'::public.club_status
FROM generate_series(1, 12) AS series(i)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_settings (club_id, auto_swing_enabled)
SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, true
FROM generate_series(1, 12) AS series(i)
ON CONFLICT (club_id) DO UPDATE SET auto_swing_enabled = true;

INSERT INTO public.dealers (id, club_id, full_name, status)
SELECT
  ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'Drift Dealer ' || i,
  'active'
FROM generate_series(1, 12) AS series(i)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dealer_attendance (
  id, dealer_id, status, current_state, check_in_time, check_out_time
)
SELECT
  ('20000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'checked_in', 'available', now() - interval '30 minutes', NULL
FROM generate_series(1, 12) AS series(i)
ON CONFLICT (id) DO NOTHING;
SET session_replication_role = origin;

TRUNCATE public.process_swing_dispatch_events,
         public.process_swing_dispatch_runs,
         net.http_request_log,
         net._http_response;
DO $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'PROCESS_SWING_INTERNAL_SECRET';
  IF (SELECT relkind FROM pg_class WHERE oid = 'vault.decrypted_secrets'::regclass) <> 'v' THEN
    DELETE FROM vault.decrypted_secrets WHERE name = 'PROCESS_SWING_INTERNAL_SECRET';
  END IF;
END;
$$;

SELECT public.run_process_swing_cron();
SELECT pg_temp.assert_true(
  (SELECT count(*) = 10
   FROM public.process_swing_dispatch_runs
   WHERE enqueue_state = 'skipped_secret_missing'
     AND transport_state = 'failed'
     AND net_request_id IS NULL),
  'missing secret must fail closed for a bounded ten-club tick'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM net.http_request_log),
  'missing secret must not enqueue HTTP work'
);

TRUNCATE public.process_swing_dispatch_events,
         public.process_swing_dispatch_runs,
         net.http_request_log,
         net._http_response;
SELECT vault.create_secret(
  'disposable-test-value',
  'PROCESS_SWING_INTERNAL_SECRET',
  'disposable contract test',
  '90000000-0000-4000-8000-000000000001'::uuid
);

SELECT public.run_process_swing_cron();
SELECT pg_temp.assert_true(
  (SELECT count(*) = 10
   FROM public.process_swing_dispatch_runs
   WHERE enqueue_state = 'enqueued'
     AND transport_state = 'pending'),
  'first bounded tick must enqueue ten clubs'
);
SELECT public.run_process_swing_cron();
SELECT pg_temp.assert_true(
  (SELECT count(*) = 12 FROM public.process_swing_dispatch_runs),
  'second tick must dispatch the remaining clubs without starvation'
);
SELECT public.run_process_swing_cron();
SELECT pg_temp.assert_true(
  (SELECT count(*) = 12 FROM public.process_swing_dispatch_runs),
  'active leases and request fingerprints must prevent overlap'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 12
   FROM net.http_request_log
   WHERE timeout_milliseconds = 55000
     AND body ?& ARRAY['club_id', 'run_id', 'request_id', 'tick_at']
     AND NOT body ? 'club_ids'),
  'dispatcher must send one correlated request per club at 55 seconds'
);

DO $$
DECLARE
  v_run public.process_swing_dispatch_runs%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_run
  FROM public.process_swing_dispatch_runs
  ORDER BY club_id
  LIMIT 1;

  v_result := public.claim_process_swing_dispatch(v_run.run_id, v_run.request_id, v_run.club_id);
  PERFORM pg_temp.assert_true(v_result->>'outcome' = 'claimed', 'first claim must succeed');

  v_result := public.claim_process_swing_dispatch(v_run.run_id, v_run.request_id, v_run.club_id);
  PERFORM pg_temp.assert_true(v_result->>'outcome' = 'duplicate', 'retry must not rerun business work');

  v_result := public.finish_process_swing_dispatch(
    v_run.run_id, v_run.request_id, v_run.club_id,
    'completed', NULL, jsonb_build_object('processed', 1)
  );
  PERFORM pg_temp.assert_true(v_result->>'outcome' = 'recorded', 'finish must record outcome');

  v_result := public.finish_process_swing_dispatch(
    v_run.run_id, v_run.request_id, v_run.club_id,
    'completed', NULL, jsonb_build_object('processed', 1)
  );
  PERFORM pg_temp.assert_true(v_result->>'outcome' = 'idempotent_replay', 'finish replay must be idempotent');

  v_result := public.claim_process_swing_dispatch(
    v_run.run_id,
    v_run.request_id,
    '00000000-0000-4000-8000-000000000012'::uuid
  );
  PERFORM pg_temp.assert_true(v_result->>'outcome' = 'scope_mismatch', 'cross-club claim must fail');

  PERFORM pg_temp.assert_true(
    (SELECT count(*) = 4
     FROM public.process_swing_dispatch_events
     WHERE run_id = v_run.run_id
       AND state IN ('received', 'started', 'duplicate', 'completed')),
    'claim/finish replay must not duplicate event audit rows'
  );
END;
$$;

INSERT INTO net._http_response (id, status_code, timed_out, created)
SELECT net_request_id, 200, false, now()
FROM public.process_swing_dispatch_runs
WHERE business_state IS NULL
ORDER BY club_id
LIMIT 1;

SELECT public.observe_process_swing_cron(100);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.process_swing_dispatch_runs
    WHERE transport_state = 'succeeded'
      AND business_state IS NULL
  ),
  'observer transport success must not manufacture business success'
);

UPDATE public.process_swing_dispatch_runs
SET requested_at = now() - interval '2 minutes'
WHERE run_id = (
  SELECT run_id
  FROM public.process_swing_dispatch_runs
  WHERE transport_state = 'pending'
    AND business_state IS NULL
  ORDER BY club_id
  LIMIT 1
);
SELECT public.observe_process_swing_cron(100);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.process_swing_dispatch_runs
    WHERE transport_state = 'timed_out'
      AND business_state IS NULL
  ),
  'observer timeout must remain transport-only'
);

SELECT 'dealer_swing_contract_drift_sql_pass' AS result;
