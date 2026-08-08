\set ON_ERROR_STOP on

-- This harness calls the exact floor_set_table_control_mode body extracted
-- from current origin/main. A proven 40P01 is an expected blocker signal, not
-- a green safety result.
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  false
);
CREATE TABLE IF NOT EXISTS public.tracker_legacy_mode_context_shared (
  context_version TEXT NOT NULL
);
TRUNCATE public.tracker_legacy_mode_context_shared;
INSERT INTO public.tracker_legacy_mode_context_shared
SELECT public.get_tracker_table_context_v2(
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303'
)->>'context_version';

CREATE TEMP TABLE tracker_legacy_mode_results (
  race TEXT NOT NULL,
  actor TEXT NOT NULL,
  response JSONB NOT NULL
);

-- The blocker holds the tournament row. Mode is sent first: it locks the
-- table row, then waits on the tournament row. Start then takes the V2
-- tournament advisory key and waits on the same tournament row.
BEGIN;
SELECT id FROM public.tournaments
WHERE id = '00000000-0000-0000-0000-000000000103' FOR UPDATE;
SELECT dblink_connect('legacy_mode_first_mode', 'dbname=' || current_database());
SELECT dblink_connect('legacy_mode_first_start', 'dbname=' || current_database());
SELECT dblink_send_query('legacy_mode_first_mode', $$SELECT public.tracker_test_mode_attempt(
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303',
  'manual')$$);
DO $$
DECLARE v_waiters INTEGER := 0;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT COUNT(*)::INTEGER INTO v_waiters
    FROM pg_stat_activity a
    WHERE a.wait_event_type = 'Lock'
      AND a.query LIKE '%tracker_test_mode_attempt%';
    EXIT WHEN v_waiters >= 1;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 THEN RAISE EXCEPTION 'mode-first writer did not reach bounded lock wait'; END IF;
END;
$$;
SELECT dblink_send_query('legacy_mode_first_start', $$SELECT public.tracker_test_start_attempt(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303',
  (SELECT context_version FROM public.tracker_legacy_mode_context_shared),
  'legacy-mode-first-start')$$);
DO $$
DECLARE
  v_waiters INTEGER := 0;
  v_start_busy BOOLEAN := false;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT COUNT(*)::INTEGER INTO v_waiters
    FROM pg_stat_activity a
    WHERE a.wait_event_type = 'Lock'
      AND a.query LIKE '%tracker_test_%attempt%';
    SELECT dblink_is_busy('legacy_mode_first_start') INTO v_start_busy;
    EXIT WHEN v_waiters >= 1 AND v_start_busy;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 OR NOT v_start_busy THEN
    RAISE EXCEPTION 'mode-first race did not reach explicit lock barrier';
  END IF;
END;
$$;
COMMIT;
INSERT INTO tracker_legacy_mode_results
SELECT 'mode_first', 'mode', response FROM dblink_get_result('legacy_mode_first_mode') AS x(response JSONB);
INSERT INTO tracker_legacy_mode_results
SELECT 'mode_first', 'start', response FROM dblink_get_result('legacy_mode_first_start') AS x(response JSONB);
SELECT dblink_disconnect('legacy_mode_first_mode');
SELECT dblink_disconnect('legacy_mode_first_start');

DELETE FROM public.tournament_hands
WHERE tournament_id = '00000000-0000-0000-0000-000000000103';
UPDATE public.tournament_tables
SET floor_control_mode = 'tracker', floor_control_revision = 0
WHERE id = '00000000-0000-0000-0000-000000000303';

-- Opposite scheduling: start reaches its lock wait before mode is sent.
BEGIN;
SELECT id FROM public.tournaments
WHERE id = '00000000-0000-0000-0000-000000000103' FOR UPDATE;
SELECT dblink_connect('legacy_start_first_start', 'dbname=' || current_database());
SELECT dblink_connect('legacy_start_first_mode', 'dbname=' || current_database());
SELECT dblink_send_query('legacy_start_first_start', $$SELECT public.tracker_test_start_attempt(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303',
  (SELECT context_version FROM public.tracker_legacy_mode_context_shared),
  'legacy-start-first-start')$$);
DO $$
DECLARE v_waiters INTEGER := 0;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT COUNT(*)::INTEGER INTO v_waiters
    FROM pg_stat_activity a
    WHERE a.wait_event_type = 'Lock'
      AND a.query LIKE '%tracker_test_start_attempt%';
    EXIT WHEN v_waiters >= 1;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 THEN RAISE EXCEPTION 'start-first writer did not reach bounded lock wait'; END IF;
END;
$$;
SELECT dblink_send_query('legacy_start_first_mode', $$SELECT public.tracker_test_mode_attempt(
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303',
  'manual')$$);
DO $$
DECLARE
  v_waiters INTEGER := 0;
  v_mode_busy BOOLEAN := false;
BEGIN
  FOR i IN 1..200 LOOP
    SELECT COUNT(*)::INTEGER INTO v_waiters
    FROM pg_stat_activity a
    WHERE a.wait_event_type = 'Lock'
      AND a.query LIKE '%tracker_test_%attempt%';
    SELECT dblink_is_busy('legacy_start_first_mode') INTO v_mode_busy;
    EXIT WHEN v_waiters >= 1 AND v_mode_busy;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 OR NOT v_mode_busy THEN
    RAISE EXCEPTION 'start-first race did not reach explicit lock barrier';
  END IF;
END;
$$;
COMMIT;
INSERT INTO tracker_legacy_mode_results
SELECT 'start_first', 'start', response FROM dblink_get_result('legacy_start_first_start') AS x(response JSONB);
INSERT INTO tracker_legacy_mode_results
SELECT 'start_first', 'mode', response FROM dblink_get_result('legacy_start_first_mode') AS x(response JSONB);
SELECT dblink_disconnect('legacy_start_first_start');
SELECT dblink_disconnect('legacy_start_first_mode');

SELECT public.tracker_test_assert(
  (SELECT COUNT(*) FROM tracker_legacy_mode_results WHERE response->>'sqlstate' = '40P01') >= 1,
  'exact mode writer/V2 race exposes deadlock_detected'
);
SELECT public.tracker_test_assert(
  (SELECT COUNT(*) FROM public.tournament_hands
   WHERE tournament_id = '00000000-0000-0000-0000-000000000103') <= 1,
  'deadlock race never creates duplicate hands'
);
SELECT race, actor, response FROM tracker_legacy_mode_results ORDER BY race, actor;
SELECT 'PR2A_LEGACY_MODE_DEADLOCK_PROOF=PASS' AS result;
DROP TABLE public.tracker_legacy_mode_context_shared;
