-- P1 cron isolation tests. Disposable current-schema database only.
-- All fixtures and writes are rolled back; no Edge request is dispatched.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_value boolean, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_value IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assert_true failed: %', p_label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_eq(p_actual text, p_expected text, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'assert_eq failed: % (actual=%, expected=%)', p_label, p_actual, p_expected;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  position('_http_response' in pg_get_functiondef(
    'public.run_process_swing_cron()'::regprocedure
  )) = 0,
  'business dispatcher never reads pg_net responses'
);

SELECT pg_temp.assert_true(
  position('timeout_milliseconds := 55000' in pg_get_functiondef(
    'public.run_process_swing_cron()'::regprocedure
  )) > 0,
  'business dispatcher gives Edge a 55 second HTTP budget'
);

SELECT pg_temp.assert_true(
  (SELECT coalesce('statement_timeout=1s' = ANY(proconfig), false)
   FROM pg_proc
   WHERE oid = 'public.observe_process_swing_cron(integer)'::regprocedure),
  'observer has a one second statement timeout'
);

SELECT pg_temp.assert_true(
  position($needle$interval '10 minutes'$needle$ in pg_get_functiondef(
    'public.observe_process_swing_cron(integer)'::regprocedure
  )) > 0,
  'observer only considers the recent response window'
);

SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.observe_process_swing_cron(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.observe_process_swing_cron(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.observe_process_swing_cron(integer)', 'EXECUTE'),
  'observer is service-role only'
);

INSERT INTO public.process_swing_cron_runs (
  request_id,
  requested_at,
  enqueue_state,
  result_state
) VALUES (
  9223372036854775000,
  now() - interval '3 minutes',
  'enqueued',
  'pending'
);

SELECT public.observe_process_swing_cron(100);

SELECT pg_temp.assert_eq(
  (SELECT result_state FROM public.process_swing_cron_runs
   WHERE request_id = 9223372036854775000),
  'failed',
  'stale pending request is failed without scanning response history'
);

SELECT pg_temp.assert_eq(
  (SELECT error_code FROM public.process_swing_cron_runs
   WHERE request_id = 9223372036854775000),
  'timeout',
  'stale pending request receives stable timeout code'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'process-swing'
      AND command = 'SELECT public.run_process_swing_cron();'
  ) AND EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'process-swing-observer'
      AND command = 'SELECT public.observe_process_swing_cron(100);'
  ),
  'dispatch and observer are independent cron jobs'
);

DO $$
BEGIN
  RAISE NOTICE 'process swing cron dispatch/observer SQL tests passed';
END;
$$;

ROLLBACK;
