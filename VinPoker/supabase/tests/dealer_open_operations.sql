-- Durable Dealer Swing mass-open tests. Disposable current-schema database only.
-- All fixtures and writes are rolled back.

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
  NOT has_function_privilege(
    'anon',
    'public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text)',
    'EXECUTE'
  ),
  'anon cannot execute durable open RPC'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text)',
    'EXECUTE'
  ),
  'authenticated operator can execute durable open RPC'
);
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.dealer_open_operations', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.dealer_open_operation_targets', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.dealer_mass_open_rollout', 'SELECT'),
  'operation and rollout stores are internal'
);

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'open-owner@test.invalid', now(), now()),
  ('71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-owner@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'OPEN TEST', 'HCM', 'approved'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 'OTHER OPEN TEST', 'HCM', 'approved');

INSERT INTO public.dealer_shifts (id, club_id, tour_name, start_time, end_time, closed_at)
VALUES
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'OPEN SHIFT', '00:00', '23:59', NULL),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'OTHER SHIFT', '00:00', '23:59', NULL),
  ('73000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', 'CLOSED SHIFT', '00:00', '23:59', now());

INSERT INTO public.game_tables (id, club_id, table_name, table_type, status, shift_id)
VALUES
  ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'OPEN 1', 'cash', 'active', NULL),
  ('74000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'OPEN 2', 'cash', 'inactive', NULL),
  ('74000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', 'OPEN 3', 'cash', 'inactive', NULL),
  ('74000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000001', 'OPEN 4', 'cash', 'inactive', NULL),
  ('74000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000001', 'OPEN 5', 'cash', 'inactive', NULL),
  ('74000000-0000-4000-8000-000000000006', '72000000-0000-4000-8000-000000000001', 'OPEN MAINT', 'cash', 'maintenance', NULL),
  ('74000000-0000-4000-8000-000000000099', '72000000-0000-4000-8000-000000000002', 'OTHER OPEN', 'cash', 'inactive', NULL);

INSERT INTO public.dealers (id, club_id, full_name, status)
VALUES
  ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Already staffed', 'active'),
  ('75000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'New staff', 'active');

INSERT INTO public.dealer_attendance (
  id, dealer_id, shift_id, shift_date, status, current_state, check_in_time
)
VALUES
  ('76000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', NULL, current_date, 'checked_in', 'available', now()),
  ('76000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', current_date, 'checked_in', 'available', now());

SELECT public.assign_dealer_to_table(
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  now(),
  now() + interval '45 minutes',
  '72000000-0000-4000-8000-000000000001',
  'open-test-existing'
);

SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_eq(
  public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000000',
    '72000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY['74000000-0000-4000-8000-000000000002'::uuid],
    'tournament'
  )->>'outcome',
  'rollout_disabled',
  'runtime master is off by default'
);

RESET ROLE;
UPDATE public.dealer_mass_open_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['72000000-0000-4000-8000-000000000001'::uuid],
    updated_at = now()
WHERE id;
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_eq(
  public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000010',
    '72000000-0000-4000-8000-000000000002',
    NULL,
    ARRAY['74000000-0000-4000-8000-000000000099'::uuid],
    'tournament'
  )->>'outcome',
  'invalid_request',
  'cross-club actor is rejected'
);

SELECT pg_temp.assert_eq(
  public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000011',
    '72000000-0000-4000-8000-000000000001',
    NULL,
    array_fill('74000000-0000-4000-8000-000000000002'::uuid, ARRAY[51]),
    'tournament'
  )->>'outcome',
  'batch_too_large',
  'batch 51 is rejected before writes'
);

SELECT pg_temp.assert_eq(
  public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000012',
    '72000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY[
      '74000000-0000-4000-8000-000000000002'::uuid,
      '74000000-0000-4000-8000-000000000002'::uuid
    ],
    'tournament'
  )->>'reason',
  'duplicate_table',
  'duplicate table is rejected before writes'
);

SELECT pg_temp.assert_eq(
  public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000013',
    '72000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000003',
    ARRAY['74000000-0000-4000-8000-000000000002'::uuid],
    'tournament'
  )->>'reason',
  'shift_not_active',
  'closed shift is rejected'
);

CREATE TEMP TABLE open_result (response jsonb NOT NULL);
INSERT INTO open_result
SELECT public.operator_open_dealer_tables(
  '77000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  ARRAY[
    '74000000-0000-4000-8000-000000000002'::uuid,
    '74000000-0000-4000-8000-000000000001'::uuid
  ],
  'tournament'
);

SELECT pg_temp.assert_eq((SELECT response->>'outcome' FROM open_result), 'waiting_for_dealer', 'partial open waits honestly');
SELECT pg_temp.assert_eq((SELECT response->>'assigned' FROM open_result), '1', 'existing staffed table counts as assigned');
SELECT pg_temp.assert_eq((SELECT response->>'remaining' FROM open_result), '1', 'one empty table remains');
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.game_tables
    WHERE id = '74000000-0000-4000-8000-000000000001'
      AND table_type = 'cash'
      AND shift_id IS NULL
      AND status = 'active'
  ),
  'already staffed table keeps its shift, type and dealer'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.game_tables
    WHERE id = '74000000-0000-4000-8000-000000000002'
      AND table_type = 'tournament'
      AND shift_id = '73000000-0000-4000-8000-000000000001'
      AND status = 'active'
      AND dealer_open_operation_id = '77000000-0000-4000-8000-000000000001'
      AND opened_at IS NOT NULL
  ),
  'empty target is opened and marked for continuation'
);

SELECT pg_temp.assert_true(
  (public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001',
    ARRAY[
      '74000000-0000-4000-8000-000000000001'::uuid,
      '74000000-0000-4000-8000-000000000002'::uuid
    ],
    'tournament'
  )->>'idempotent_replay')::boolean,
  'same request and canonical payload replays'
);
SELECT pg_temp.assert_eq(
  public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY['74000000-0000-4000-8000-000000000002'::uuid],
    'tournament'
  )->>'outcome',
  'idempotency_conflict',
  'request id cannot be reused with changed payload'
);

SELECT public.assign_dealer_to_table(
  '76000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000002',
  now(),
  now() + interval '45 minutes',
  '72000000-0000-4000-8000-000000000001',
  'open-test-second'
);
SELECT pg_temp.assert_eq(
  public.get_dealer_open_operation(
    '77000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001'
  )->>'operation_status',
  'completed',
  'assignment trigger completes operation when every table is staffed'
);
SELECT pg_temp.assert_eq(
  (SELECT count(*)::text FROM public.swing_audit_logs
   WHERE action = 'dealer_tables_open_operation'
     AND details->>'operation_id' = '77000000-0000-4000-8000-000000000001'),
  '1',
  'idempotent replay writes one operation audit'
);
RESET ROLE;
UPDATE public.dealer_open_operations
SET expires_at = now() - interval '1 second'
WHERE id = '77000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_eq(
  public.get_dealer_open_operation(
    '77000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001'
  )->>'operation_status',
  'completed',
  'completed operation keeps its terminal status after marker expiry'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.game_tables
    WHERE id IN (
      '74000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000002'
    )
      AND (dealer_open_operation_id IS NOT NULL OR opened_at IS NOT NULL)
  ),
  'completed operation clears every marker after 24 hours'
);

SELECT public.operator_open_dealer_tables(
  '77000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000001',
  NULL,
  ARRAY['74000000-0000-4000-8000-000000000003'::uuid],
  'tournament'
);
UPDATE public.game_tables
SET status = 'inactive'
WHERE id = '74000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.game_tables
    WHERE id = '74000000-0000-4000-8000-000000000003'
      AND dealer_open_operation_id IS NULL
      AND opened_at IS NULL
  ),
  'closing a table clears the session marker immediately'
);
RESET ROLE;
SELECT pg_temp.assert_eq(
  (SELECT status FROM public.dealer_open_operations
   WHERE id = '77000000-0000-4000-8000-000000000002'),
  'cancelled',
  'closing a pending target cancels its operation'
);

SET LOCAL ROLE authenticated;
SELECT public.operator_open_dealer_tables(
  '77000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000001',
  NULL,
  ARRAY['74000000-0000-4000-8000-000000000004'::uuid],
  'tournament'
);
RESET ROLE;
UPDATE public.dealer_open_operations
SET expires_at = now() - interval '1 second'
WHERE id = '77000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_eq(
  public.get_dealer_open_operation(
    '77000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001'
  )->>'operation_status',
  'expired',
  '24 hour expiry is enforced on refresh'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.game_tables
    WHERE id = '74000000-0000-4000-8000-000000000004'
      AND dealer_open_operation_id IS NULL
      AND opened_at IS NULL
  ),
  'expiry clears the current session marker'
);

SELECT public.operator_open_dealer_tables(
  '77000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000001',
  NULL,
  ARRAY['74000000-0000-4000-8000-000000000005'::uuid],
  'tournament'
);
SELECT pg_temp.assert_eq(
  public.operator_open_dealer_tables(
    '77000000-0000-4000-8000-000000000005',
    '72000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY['74000000-0000-4000-8000-000000000005'::uuid],
    'tournament'
  )->>'reason',
  'table_in_open_operation',
  'overlapping live operation is rejected'
);

DO $$
BEGIN
  RAISE NOTICE 'dealer open operation SQL tests passed';
END;
$$;

ROLLBACK;
