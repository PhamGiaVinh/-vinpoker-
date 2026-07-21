-- Durable mass-open concurrency tests. Disposable database only.
-- Fixtures are committed so independent dblink sessions can observe them.

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

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES ('81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'open-race@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'OPEN RACE', 'HCM', 'approved');

INSERT INTO public.game_tables (id, club_id, table_name, table_type, status)
VALUES
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'RACE OPEN 1', 'cash', 'inactive'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'RACE OPEN 2', 'cash', 'inactive'),
  ('83000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', 'RACE OPEN 3', 'cash', 'inactive'),
  ('83000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000001', 'RACE OPEN 4', 'cash', 'inactive');

UPDATE public.dealer_mass_open_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['82000000-0000-4000-8000-000000000001'::uuid],
    updated_at = now()
WHERE id;

COMMIT;

SELECT dblink_connect('open_same_a', 'dbname=' || current_database());
SELECT dblink_connect('open_same_b', 'dbname=' || current_database());

SELECT dblink_send_query('open_same_a', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_open_dealer_tables(
    '84000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY[
      '83000000-0000-4000-8000-000000000001'::uuid,
      '83000000-0000-4000-8000-000000000002'::uuid
    ],
    'tournament'
  )::text
  FROM claims
$query$);

SELECT dblink_send_query('open_same_b', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_open_dealer_tables(
    '84000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY[
      '83000000-0000-4000-8000-000000000002'::uuid,
      '83000000-0000-4000-8000-000000000001'::uuid
    ],
    'tournament'
  )::text
  FROM claims
$query$);

CREATE TEMP TABLE same_open_results (response jsonb NOT NULL);
INSERT INTO same_open_results SELECT response::jsonb FROM dblink_get_result('open_same_a') AS t(response text);
INSERT INTO same_open_results SELECT response::jsonb FROM dblink_get_result('open_same_b') AS t(response text);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
      AND bool_and(response->>'outcome' = 'waiting_for_dealer')
      AND count(*) FILTER (WHERE (response->>'idempotent_replay')::boolean) = 1
   FROM same_open_results),
  'concurrent same request creates one operation and one replay'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.dealer_open_operations
   WHERE id = '84000000-0000-4000-8000-000000000001'),
  'concurrent replay persists one operation'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.swing_audit_logs
   WHERE action = 'dealer_tables_open_operation'
     AND details->>'operation_id' = '84000000-0000-4000-8000-000000000001'),
  'concurrent replay persists one audit row'
);

SELECT dblink_disconnect('open_same_a');
SELECT dblink_disconnect('open_same_b');

SELECT dblink_connect('open_inverse_a', 'dbname=' || current_database());
SELECT dblink_connect('open_inverse_b', 'dbname=' || current_database());

SELECT dblink_send_query('open_inverse_a', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_open_dealer_tables(
    '84000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY[
      '83000000-0000-4000-8000-000000000003'::uuid,
      '83000000-0000-4000-8000-000000000004'::uuid
    ],
    'tournament'
  )::text
  FROM claims
$query$);

SELECT dblink_send_query('open_inverse_b', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_open_dealer_tables(
    '84000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY[
      '83000000-0000-4000-8000-000000000004'::uuid,
      '83000000-0000-4000-8000-000000000003'::uuid
    ],
    'tournament'
  )::text
  FROM claims
$query$);

CREATE TEMP TABLE inverse_open_results (response jsonb NOT NULL);
INSERT INTO inverse_open_results SELECT response::jsonb FROM dblink_get_result('open_inverse_a') AS t(response text);
INSERT INTO inverse_open_results SELECT response::jsonb FROM dblink_get_result('open_inverse_b') AS t(response text);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
      AND count(*) FILTER (WHERE response->>'outcome' = 'waiting_for_dealer') = 1
      AND count(*) FILTER (
        WHERE response->>'outcome' = 'conflict'
          AND response->>'reason' = 'table_in_open_operation'
      ) = 1
   FROM inverse_open_results),
  'inverse table order yields one operation and one clean conflict without deadlock'
);

SELECT dblink_disconnect('open_inverse_a');
SELECT dblink_disconnect('open_inverse_b');

DO $$
BEGIN
  RAISE NOTICE 'dealer open operation concurrency tests passed';
END;
$$;
