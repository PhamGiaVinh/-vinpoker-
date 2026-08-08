\set ON_ERROR_STOP on

-- Exact post-containment race. Both directions must serialize through the
-- shared tournament advisory lock; a deadlock is a failed containment gate.
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

CREATE TEMP TABLE tracker_legacy_mode_containment_results (
  race TEXT NOT NULL,
  actor TEXT NOT NULL,
  response JSONB NOT NULL
);

-- Mode first: mode commits the context change, then start must reject the
-- token it rendered before that change.
BEGIN;
SELECT id FROM public.tournaments
WHERE id = '00000000-0000-0000-0000-000000000103' FOR UPDATE;
SELECT dblink_connect('contained_mode_first_mode', 'dbname=' || current_database());
SELECT dblink_connect('contained_mode_first_start', 'dbname=' || current_database());
SELECT dblink_send_query('contained_mode_first_mode', $$SELECT public.tracker_test_mode_attempt(
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
SELECT dblink_send_query('contained_mode_first_start', $$SELECT public.tracker_test_start_attempt(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303',
  (SELECT context_version FROM public.tracker_legacy_mode_context_shared),
  'contained-mode-first-start')$$);
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
    SELECT dblink_is_busy('contained_mode_first_start') INTO v_start_busy;
    EXIT WHEN v_waiters >= 1 AND v_start_busy;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 OR NOT v_start_busy THEN
    RAISE EXCEPTION 'mode-first race did not reach explicit lock barrier';
  END IF;
END;
$$;
COMMIT;
INSERT INTO tracker_legacy_mode_containment_results
SELECT 'mode_first', 'mode', response
FROM dblink_get_result('contained_mode_first_mode') AS x(response JSONB);
INSERT INTO tracker_legacy_mode_containment_results
SELECT 'mode_first', 'start', response
FROM dblink_get_result('contained_mode_first_start') AS x(response JSONB);
SELECT dblink_disconnect('contained_mode_first_mode');
SELECT dblink_disconnect('contained_mode_first_start');

SELECT public.tracker_test_assert(
  (SELECT response->>'ok' = 'true'
   FROM tracker_legacy_mode_containment_results
   WHERE race = 'mode_first' AND actor = 'mode'),
  'mode-first legacy writer commits'
);
SELECT public.tracker_test_assert(
  (SELECT response->>'error' = 'stale_table_context'
   FROM tracker_legacy_mode_containment_results
   WHERE race = 'mode_first' AND actor = 'start'),
  'mode-first start rejects stale context'
);
SELECT public.tracker_test_assert(
  NOT EXISTS (
    SELECT 1 FROM tracker_legacy_mode_containment_results
    WHERE response->>'sqlstate' = '40P01'
  ),
  'mode-first race has no deadlock'
);
SELECT public.tracker_test_assert(
  (SELECT floor_control_mode = 'manual'
   FROM public.tournament_tables
   WHERE id = '00000000-0000-0000-0000-000000000303'),
  'mode-first final mode is committed'
);

DELETE FROM public.tournament_hands
WHERE tournament_id = '00000000-0000-0000-0000-000000000103';
UPDATE public.tournament_tables
SET floor_control_mode = 'tracker', floor_control_revision = 0
WHERE id = '00000000-0000-0000-0000-000000000303';
TRUNCATE public.tracker_legacy_mode_context_shared;
INSERT INTO public.tracker_legacy_mode_context_shared
SELECT public.get_tracker_table_context_v2(
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303'
)->>'context_version';

-- Start first: start commits, then the mode writer observes the active hand
-- and returns its established blocker, rather than deadlocking or mutating mode.
BEGIN;
SELECT id FROM public.tournaments
WHERE id = '00000000-0000-0000-0000-000000000103' FOR UPDATE;
SELECT dblink_connect('contained_start_first_start', 'dbname=' || current_database());
SELECT dblink_connect('contained_start_first_mode', 'dbname=' || current_database());
SELECT dblink_send_query('contained_start_first_start', $$SELECT public.tracker_test_start_attempt(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000303',
  (SELECT context_version FROM public.tracker_legacy_mode_context_shared),
  'contained-start-first-start')$$);
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
SELECT dblink_send_query('contained_start_first_mode', $$SELECT public.tracker_test_mode_attempt(
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
    SELECT dblink_is_busy('contained_start_first_mode') INTO v_mode_busy;
    EXIT WHEN v_waiters >= 1 AND v_mode_busy;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF v_waiters < 1 OR NOT v_mode_busy THEN
    RAISE EXCEPTION 'start-first race did not reach explicit lock barrier';
  END IF;
END;
$$;
COMMIT;
INSERT INTO tracker_legacy_mode_containment_results
SELECT 'start_first', 'start', response
FROM dblink_get_result('contained_start_first_start') AS x(response JSONB);
INSERT INTO tracker_legacy_mode_containment_results
SELECT 'start_first', 'mode', response
FROM dblink_get_result('contained_start_first_mode') AS x(response JSONB);
SELECT dblink_disconnect('contained_start_first_start');
SELECT dblink_disconnect('contained_start_first_mode');

SELECT public.tracker_test_assert(
  (SELECT response->>'outcome' = 'started'
   FROM tracker_legacy_mode_containment_results
   WHERE race = 'start_first' AND actor = 'start'),
  'start-first V2 start commits exactly one hand'
);
SELECT public.tracker_test_assert(
  (SELECT response->>'error' = 'table_has_active_hand'
   FROM tracker_legacy_mode_containment_results
   WHERE race = 'start_first' AND actor = 'mode'),
  'start-first mode writer returns active-hand blocker'
);
SELECT public.tracker_test_assert(
  NOT EXISTS (
    SELECT 1 FROM tracker_legacy_mode_containment_results
    WHERE response->>'sqlstate' = '40P01'
  ),
  'start-first race has no deadlock'
);
SELECT public.tracker_test_assert(
  (SELECT COUNT(*) = 1
   FROM public.tournament_hands
   WHERE tournament_id = '00000000-0000-0000-0000-000000000103'),
  'start-first race creates no duplicate hand'
);

SELECT race, actor, response
FROM tracker_legacy_mode_containment_results
ORDER BY race, actor;
SELECT 'MODE_WRITER_RACE_PASS' AS result;
DROP TABLE public.tracker_legacy_mode_context_shared;
