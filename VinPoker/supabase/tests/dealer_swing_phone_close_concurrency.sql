-- Concurrent guarded close test. Disposable database only.

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

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES ('ea000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'close-race@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES ('eb000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'CLOSE RACE', 'HCM', 'approved');

INSERT INTO public.dealer_shifts (id, club_id, tour_name, start_time, end_time)
VALUES ('ec000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'RACE SHIFT', '00:00', '23:59');

INSERT INTO public.game_tables (id, club_id, shift_id, table_name, status)
VALUES
  ('ed000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'RACE 1', 'active'),
  ('ed000000-0000-4000-8000-000000000002', 'eb000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'RACE 2', 'active');

UPDATE public.dealer_swing_phone_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['eb000000-0000-4000-8000-000000000001'::uuid],
    updated_at = now()
WHERE id;

SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);

CREATE TABLE public._test_phone_close_snapshots (
  operation_id uuid PRIMARY KEY,
  expected_state jsonb NOT NULL
);

INSERT INTO public._test_phone_close_snapshots
SELECT operation_id, jsonb_build_object('state_hash', response->'state_hash', 'tables', response->'tables')
FROM (
  SELECT
    operation_id,
    public.close_dealer_tables(
      operation_id,
      'eb000000-0000-4000-8000-000000000001',
      'ec000000-0000-4000-8000-000000000001',
      table_ids,
      NULL,
      true
    ) AS response
  FROM (VALUES
    (
      'ee000000-0000-4000-8000-000000000001'::uuid,
      ARRAY[
        'ed000000-0000-4000-8000-000000000001'::uuid,
        'ed000000-0000-4000-8000-000000000002'::uuid
      ]
    ),
    (
      'ee000000-0000-4000-8000-000000000002'::uuid,
      ARRAY[
        'ed000000-0000-4000-8000-000000000002'::uuid,
        'ed000000-0000-4000-8000-000000000001'::uuid
      ]
    )
  ) input(operation_id, table_ids)
) dry_runs;

SELECT dblink_connect('close_order_a', 'dbname=' || current_database());
SELECT dblink_connect('close_order_b', 'dbname=' || current_database());

SELECT dblink_send_query('close_order_a', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  ), snapshot AS (
    SELECT expected_state FROM public._test_phone_close_snapshots
    WHERE operation_id = 'ee000000-0000-4000-8000-000000000001'
  )
  SELECT public.close_dealer_tables(
    'ee000000-0000-4000-8000-000000000001',
    'eb000000-0000-4000-8000-000000000001',
    'ec000000-0000-4000-8000-000000000001',
    ARRAY[
      'ed000000-0000-4000-8000-000000000001'::uuid,
      'ed000000-0000-4000-8000-000000000002'::uuid
    ],
    snapshot.expected_state,
    false
  )::text
  FROM claims, snapshot
$query$);

SELECT dblink_send_query('close_order_b', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  ), snapshot AS (
    SELECT expected_state FROM public._test_phone_close_snapshots
    WHERE operation_id = 'ee000000-0000-4000-8000-000000000002'
  )
  SELECT public.close_dealer_tables(
    'ee000000-0000-4000-8000-000000000002',
    'eb000000-0000-4000-8000-000000000001',
    'ec000000-0000-4000-8000-000000000001',
    ARRAY[
      'ed000000-0000-4000-8000-000000000002'::uuid,
      'ed000000-0000-4000-8000-000000000001'::uuid
    ],
    snapshot.expected_state,
    false
  )::text
  FROM claims, snapshot
$query$);

CREATE TEMP TABLE close_race_results (response jsonb NOT NULL);
INSERT INTO close_race_results SELECT response::jsonb FROM dblink_get_result('close_order_a') AS t(response text);
INSERT INTO close_race_results SELECT response::jsonb FROM dblink_get_result('close_order_b') AS t(response text);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
      AND count(*) FILTER (WHERE response->>'outcome' = 'completed') = 1
      AND count(*) FILTER (WHERE response->>'outcome' = 'conflict') = 1
   FROM close_race_results),
  'inverse order close yields one completion and one conflict without deadlock'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.game_tables
   WHERE id IN (
     'ed000000-0000-4000-8000-000000000001',
     'ed000000-0000-4000-8000-000000000002'
   ) AND status = 'inactive'),
  'concurrent close deactivates both tables once'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 3 FROM public.swing_audit_logs
   WHERE club_id = 'eb000000-0000-4000-8000-000000000001'
     AND action IN ('tables_closed', 'tables_closed_bulk')),
  'concurrent close writes one audit set'
);

SELECT dblink_disconnect('close_order_a');
SELECT dblink_disconnect('close_order_b');

DROP TABLE public._test_phone_close_snapshots;

DO $$
BEGIN
  RAISE NOTICE 'dealer swing phone close concurrency tests passed';
END;
$$;
