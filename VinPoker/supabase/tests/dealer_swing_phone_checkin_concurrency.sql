-- Concurrency tests for operator_check_in_dealers.
-- Run only on a disposable database. This file commits fixtures so dblink
-- sessions can observe them; discard the database after the test.

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
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99', 'authenticated', 'authenticated', 'concurrency@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES ('99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99', 'CONCURRENCY TEST', 'HCM', 'approved');

INSERT INTO public.dealers (id, club_id, full_name, status)
VALUES
  ('d1000000-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999', 'Concurrent same request', 'active'),
  ('d1000000-0000-4000-8000-000000000002', '99999999-9999-4999-8999-999999999999', 'Inverse order A', 'active'),
  ('d1000000-0000-4000-8000-000000000003', '99999999-9999-4999-8999-999999999999', 'Inverse order B', 'active');

INSERT INTO public.dealer_shifts (id, club_id, tour_name, start_time, end_time)
VALUES ('c1000000-0000-4000-8000-000000000099', '99999999-9999-4999-8999-999999999999', 'CONCURRENCY', '00:00', '23:59');

UPDATE public.dealer_swing_phone_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['99999999-9999-4999-8999-999999999999'::uuid],
    updated_at = now()
WHERE id;

COMMIT;

SELECT dblink_connect('same_a', 'dbname=' || current_database());
SELECT dblink_connect('same_b', 'dbname=' || current_database());

SELECT dblink_send_query('same_a', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_check_in_dealers(
    'f2000000-0000-4000-8000-000000000001',
    '99999999-9999-4999-8999-999999999999',
    jsonb_build_array(jsonb_build_object(
      'entry_id', 'e2000000-0000-4000-8000-000000000001',
      'mode', 'unscheduled',
      'input_method', 'manual_list',
      'user_id', NULL,
      'dealer_id', 'd1000000-0000-4000-8000-000000000001',
      'shift_assignment_id', NULL,
      'reason', 'concurrent replay'
    ))
  )::text
  FROM claims
$query$);

SELECT dblink_send_query('same_b', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_check_in_dealers(
    'f2000000-0000-4000-8000-000000000001',
    '99999999-9999-4999-8999-999999999999',
    jsonb_build_array(jsonb_build_object(
      'entry_id', 'e2000000-0000-4000-8000-000000000001',
      'mode', 'unscheduled',
      'input_method', 'manual_list',
      'user_id', NULL,
      'dealer_id', 'd1000000-0000-4000-8000-000000000001',
      'shift_assignment_id', NULL,
      'reason', 'concurrent replay'
    ))
  )::text
  FROM claims
$query$);

CREATE TEMP TABLE same_request_results (response jsonb);
INSERT INTO same_request_results SELECT response::jsonb FROM dblink_get_result('same_a') AS t(response text);
INSERT INTO same_request_results SELECT response::jsonb FROM dblink_get_result('same_b') AS t(response text);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 AND count(DISTINCT response) = 1 FROM same_request_results),
  'concurrent same request returns one cached response'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.dealer_attendance
   WHERE dealer_id = 'd1000000-0000-4000-8000-000000000001' AND status = 'checked_in'),
  'concurrent same request creates one attendance row'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.audit_logs
   WHERE action = 'operator_dealer_unscheduled_checkin'
     AND entity_id = 'd1000000-0000-4000-8000-000000000001'),
  'concurrent same request creates one audit row'
);

SELECT dblink_disconnect('same_a');
SELECT dblink_disconnect('same_b');

SELECT dblink_connect('inverse_a', 'dbname=' || current_database());
SELECT dblink_connect('inverse_b', 'dbname=' || current_database());

SELECT dblink_send_query('inverse_a', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_check_in_dealers(
    'f2000000-0000-4000-8000-000000000002',
    '99999999-9999-4999-8999-999999999999',
    jsonb_build_array(
      jsonb_build_object(
        'entry_id', 'e2000000-0000-4000-8000-000000000002', 'mode', 'unscheduled',
        'input_method', 'manual_list', 'user_id', NULL,
        'dealer_id', 'd1000000-0000-4000-8000-000000000002',
        'shift_assignment_id', NULL, 'reason', 'inverse order'
      ),
      jsonb_build_object(
        'entry_id', 'e2000000-0000-4000-8000-000000000003', 'mode', 'unscheduled',
        'input_method', 'manual_list', 'user_id', NULL,
        'dealer_id', 'd1000000-0000-4000-8000-000000000003',
        'shift_assignment_id', NULL, 'reason', 'inverse order'
      )
    )
  )::text
  FROM claims
$query$);

SELECT dblink_send_query('inverse_b', $query$
  WITH claims AS (
    SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  SELECT public.operator_check_in_dealers(
    'f2000000-0000-4000-8000-000000000003',
    '99999999-9999-4999-8999-999999999999',
    jsonb_build_array(
      jsonb_build_object(
        'entry_id', 'e2000000-0000-4000-8000-000000000004', 'mode', 'unscheduled',
        'input_method', 'manual_list', 'user_id', NULL,
        'dealer_id', 'd1000000-0000-4000-8000-000000000003',
        'shift_assignment_id', NULL, 'reason', 'inverse order'
      ),
      jsonb_build_object(
        'entry_id', 'e2000000-0000-4000-8000-000000000005', 'mode', 'unscheduled',
        'input_method', 'manual_list', 'user_id', NULL,
        'dealer_id', 'd1000000-0000-4000-8000-000000000002',
        'shift_assignment_id', NULL, 'reason', 'inverse order'
      )
    )
  )::text
  FROM claims
$query$);

CREATE TEMP TABLE inverse_order_results (response jsonb);
INSERT INTO inverse_order_results SELECT response::jsonb FROM dblink_get_result('inverse_a') AS t(response text);
INSERT INTO inverse_order_results SELECT response::jsonb FROM dblink_get_result('inverse_b') AS t(response text);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 AND bool_and(response->>'outcome' = 'completed') FROM inverse_order_results),
  'inverse input batches complete without deadlock'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.dealer_attendance
   WHERE dealer_id IN (
     'd1000000-0000-4000-8000-000000000002',
     'd1000000-0000-4000-8000-000000000003'
   ) AND status = 'checked_in'),
  'inverse input batches create one attendance row per dealer'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.audit_logs
   WHERE action = 'operator_dealer_unscheduled_checkin'
     AND entity_id IN (
       'd1000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000003'
     )),
  'inverse input batches do not duplicate audit rows'
);

SELECT dblink_disconnect('inverse_a');
SELECT dblink_disconnect('inverse_b');

DO $$
BEGIN
  RAISE NOTICE 'dealer swing phone check-in concurrency tests passed';
END;
$$;
