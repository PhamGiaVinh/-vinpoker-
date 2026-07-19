-- Overlapping planner attack test. Disposable database only.
-- dblink sessions commit, so fixtures are explicitly removed at the end.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;

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
INSERT INTO public.clubs (id, name, region, status)
VALUES ('b1000000-0000-4000-8000-000000000001', 'ROTATION RACE TEST', 'TEST', 'approved');

INSERT INTO public.game_tables (id, club_id, table_name, status)
VALUES ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'RACE 1', 'active');

SELECT dblink_connect('rotation_plan_a', 'dbname=' || current_database());
SELECT dblink_connect('rotation_plan_b', 'dbname=' || current_database());

SELECT dblink_send_query('rotation_plan_a', $query$
  SELECT public.upsert_rotation_plan(
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'table_id', 'b2000000-0000-4000-8000-000000000001',
      'slot_index', 0,
      'planned_relief_at', '2030-01-01T10:00:00Z',
      'solver_version', 'race-a',
      'score', 10
    )),
    NULL
  )::text
$query$);

SELECT dblink_send_query('rotation_plan_b', $query$
  SELECT public.upsert_rotation_plan(
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'table_id', 'b2000000-0000-4000-8000-000000000001',
      'slot_index', 0,
      'planned_relief_at', '2030-01-01T10:05:00Z',
      'solver_version', 'race-b',
      'score', 20
    )),
    NULL
  )::text
$query$);

CREATE TEMP TABLE rotation_race_results (response jsonb NOT NULL);
INSERT INTO rotation_race_results
SELECT response::jsonb FROM dblink_get_result('rotation_plan_a') AS t(response text);
INSERT INTO rotation_race_results
SELECT response::jsonb FROM dblink_get_result('rotation_plan_b') AS t(response text);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 AND bool_and(response->>'outcome' = 'ok')
   FROM rotation_race_results),
  'both overlapping planners finish without an error'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.dealer_rotation_schedule
   WHERE table_id = 'b2000000-0000-4000-8000-000000000001'
     AND slot_index = 0
     AND status IN ('predicted', 'announced', 'executing')),
  'overlapping planners leave at most one live row per table slot'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
   FROM public.dealer_rotation_schedule
   WHERE table_id = 'b2000000-0000-4000-8000-000000000001'),
  'serialized changed plans leave one superseded and one live row'
);

SELECT dblink_disconnect('rotation_plan_a');
SELECT dblink_disconnect('rotation_plan_b');

DELETE FROM public.clubs WHERE id = 'b1000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  RAISE NOTICE 'dealer rotation plan concurrency tests passed';
END;
$$;
