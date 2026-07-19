-- Guarded phone close-table tests. Disposable current-schema database only.
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
    'public.close_dealer_tables(uuid,uuid,uuid,uuid[],jsonb,boolean)',
    'EXECUTE'
  ),
  'anon cannot execute guarded close'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.close_dealer_tables(uuid,uuid,uuid,uuid[],jsonb,boolean)',
    'EXECUTE'
  ),
  'authenticated can execute guarded close'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.close_dealer_tables(uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'legacy desktop close signature remains executable'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.dealer_phone_reconcile_room_state(uuid,jsonb,timestamptz,text,jsonb,boolean,boolean)',
    'EXECUTE'
  ),
  'authenticated can execute phone reconcile wrapper'
);
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.dealer_phone_close_requests', 'SELECT'),
  'close request store is internal'
);

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('ca000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'close-owner@test.invalid', now(), now()),
  ('ca000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-owner@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES
  ('cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'CLOSE TEST', 'HCM', 'approved'),
  ('cb000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'OTHER CLOSE TEST', 'HCM', 'approved');

INSERT INTO public.dealer_shifts (id, club_id, tour_name, start_time, end_time)
VALUES
  ('cc000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'CLOSE SHIFT', '00:00', '23:59'),
  ('cc000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 'OTHER SHIFT', '00:00', '23:59');

INSERT INTO public.game_tables (id, club_id, shift_id, table_name, status)
VALUES
  ('cd000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'CLOSE 1', 'active'),
  ('cd000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'CLOSE 2', 'active'),
  ('cd000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000002', 'OTHER TABLE', 'active');

INSERT INTO public.dealers (id, club_id, full_name, status)
VALUES
  ('ce000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'Close dealer 1', 'active'),
  ('ce000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'Close dealer 2', 'active'),
  ('ce000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000001', 'Reserved dealer', 'active'),
  ('ce000000-0000-4000-8000-000000000004', 'cb000000-0000-4000-8000-000000000001', 'Preassigned dealer', 'active');

INSERT INTO public.dealer_attendance (
  id, dealer_id, shift_id, shift_date, status, current_state,
  check_in_time, pre_assigned_table_id, pre_assigned_at
)
VALUES
  ('cf000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', current_date, 'checked_in', 'assigned', now(), NULL, NULL),
  ('cf000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000001', current_date, 'checked_in', 'assigned', now(), NULL, NULL),
  ('cf000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000001', current_date, 'checked_in', 'available', now(), NULL, NULL),
  ('cf000000-0000-4000-8000-000000000004', 'ce000000-0000-4000-8000-000000000004', 'cc000000-0000-4000-8000-000000000001', current_date, 'checked_in', 'pre_assigned', now(), 'cd000000-0000-4000-8000-000000000002', now());

INSERT INTO public.dealer_assignments (
  id, attendance_id, dealer_id, table_id, club_id, status,
  assigned_at, swing_due_at, version
)
VALUES
  ('d1000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'assigned', now(), now() + interval '30 minutes', 1),
  ('d1000000-0000-4000-8000-000000000002', 'cf000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'assigned', now(), now() + interval '30 minutes', 1),
  ('d1000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'reserved', now(), now() + interval '30 minutes', 1);

SELECT set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE v jsonb;
BEGIN
  v := public.close_dealer_tables(
    'da000000-0000-4000-8000-000000000000',
    'cb000000-0000-4000-8000-000000000001',
    'cc000000-0000-4000-8000-000000000001',
    ARRAY['cd000000-0000-4000-8000-000000000001'::uuid],
    NULL,
    true
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'rollout_disabled', 'master off blocks close server-side');

  v := public.dealer_phone_reconcile_room_state(
    'cb000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    now(),
    'runtime gate probe',
    '[]'::jsonb,
    true,
    false
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'rollout_disabled', 'master off blocks phone reconcile server-side');
END;
$$;

UPDATE public.dealer_swing_phone_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['cb000000-0000-4000-8000-000000000001'::uuid],
    updated_at = now()
WHERE id;

DO $$
DECLARE v jsonb;
BEGIN
  v := public.close_dealer_tables(
    'da000000-0000-4000-8000-000000000001',
    'cb000000-0000-4000-8000-000000000002',
    NULL,
    ARRAY['cd000000-0000-4000-8000-000000000003'::uuid],
    NULL,
    true
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'invalid_request', 'cross-club actor rejected');

  v := public.close_dealer_tables(
    'da000000-0000-4000-8000-000000000002',
    'cb000000-0000-4000-8000-000000000001',
    NULL,
    ARRAY[
      'cd000000-0000-4000-8000-000000000001'::uuid,
      'cd000000-0000-4000-8000-000000000001'::uuid
    ],
    NULL,
    true
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'invalid_request', 'duplicate table rejected');
END;
$$;

CREATE TEMP TABLE close_snapshot (
  operation_id uuid PRIMARY KEY,
  expected_state jsonb NOT NULL
);

INSERT INTO close_snapshot
SELECT
  'da000000-0000-4000-8000-000000000003'::uuid,
  jsonb_build_object('state_hash', v->'state_hash', 'tables', v->'tables')
FROM (
  SELECT public.close_dealer_tables(
    'da000000-0000-4000-8000-000000000003',
    'cb000000-0000-4000-8000-000000000001',
    'cc000000-0000-4000-8000-000000000001',
    ARRAY[
      'cd000000-0000-4000-8000-000000000002'::uuid,
      'cd000000-0000-4000-8000-000000000001'::uuid
    ],
    NULL,
    true
  ) AS v
) dry;

SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(expected_state->'tables') = 2 FROM close_snapshot),
  'dry-run returns two canonical table snapshots'
);
SELECT pg_temp.assert_true(
  (SELECT bool_and(length(item->>'state_hash') = 64)
   FROM close_snapshot, jsonb_array_elements(expected_state->'tables') item),
  'dry-run returns per-table SHA-256 hashes'
);

-- Simulate one table changing after confirmation. One stale table must block both.
UPDATE public.dealer_assignments
SET version = version + 1
WHERE id = 'd1000000-0000-4000-8000-000000000002';

DO $$
DECLARE v jsonb;
BEGIN
  SELECT public.close_dealer_tables(
    operation_id,
    'cb000000-0000-4000-8000-000000000001',
    'cc000000-0000-4000-8000-000000000001',
    ARRAY[
      'cd000000-0000-4000-8000-000000000001'::uuid,
      'cd000000-0000-4000-8000-000000000002'::uuid
    ],
    expected_state,
    false
  ) INTO v
  FROM close_snapshot;

  PERFORM pg_temp.assert_eq(v->>'outcome', 'conflict', 'stale assignment version conflicts');
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v->'results') item WHERE item->>'code' = 'conflict'),
    'conflict response identifies stale table'
  );
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.game_tables
   WHERE id IN (
     'cd000000-0000-4000-8000-000000000001',
     'cd000000-0000-4000-8000-000000000002'
   ) AND status = 'active'),
  'stale snapshot closes no tables'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.swing_audit_logs
   WHERE action IN ('tables_closed', 'tables_closed_bulk')
     AND club_id = 'cb000000-0000-4000-8000-000000000001'),
  'stale snapshot writes no close audit'
);

TRUNCATE close_snapshot;
INSERT INTO close_snapshot
SELECT
  'da000000-0000-4000-8000-000000000004'::uuid,
  jsonb_build_object('state_hash', v->'state_hash', 'tables', v->'tables')
FROM (
  SELECT public.close_dealer_tables(
    'da000000-0000-4000-8000-000000000004',
    'cb000000-0000-4000-8000-000000000001',
    'cc000000-0000-4000-8000-000000000001',
    ARRAY[
      'cd000000-0000-4000-8000-000000000001'::uuid,
      'cd000000-0000-4000-8000-000000000002'::uuid
    ],
    NULL,
    true
  ) AS v
) dry;

CREATE TEMP TABLE close_apply_result (response jsonb NOT NULL);
INSERT INTO close_apply_result
SELECT public.close_dealer_tables(
  operation_id,
  'cb000000-0000-4000-8000-000000000001',
  'cc000000-0000-4000-8000-000000000001',
  ARRAY[
    'cd000000-0000-4000-8000-000000000002'::uuid,
    'cd000000-0000-4000-8000-000000000001'::uuid
  ],
  expected_state,
  false
)
FROM close_snapshot;

SELECT pg_temp.assert_eq(
  (SELECT response->>'outcome' FROM close_apply_result),
  'completed',
  'fresh snapshot closes full batch'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.game_tables
   WHERE id IN (
     'cd000000-0000-4000-8000-000000000001',
     'cd000000-0000-4000-8000-000000000002'
   ) AND status = 'inactive' AND shift_id IS NULL),
  'full batch is inactive and detached'
);
SELECT pg_temp.assert_true(
  (SELECT current_state = 'available' AND pre_assigned_table_id IS NULL
   FROM public.dealer_attendance
   WHERE id = 'cf000000-0000-4000-8000-000000000004'),
  'preassigned dealer is released by close'
);

CREATE TEMP TABLE replay_result (response jsonb NOT NULL);
INSERT INTO replay_result
SELECT public.close_dealer_tables(
  operation_id,
  'cb000000-0000-4000-8000-000000000001',
  'cc000000-0000-4000-8000-000000000001',
  ARRAY[
    'cd000000-0000-4000-8000-000000000001'::uuid,
    'cd000000-0000-4000-8000-000000000002'::uuid
  ],
  expected_state,
  false
)
FROM close_snapshot;

SELECT pg_temp.assert_eq(
  (SELECT response->>'outcome' FROM replay_result),
  'completed',
  'apply replay returns cached completed response'
);
SELECT pg_temp.assert_true(
  (SELECT (response->>'idempotent_replay')::boolean FROM replay_result),
  'apply replay is marked idempotent'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 3 FROM public.swing_audit_logs
   WHERE action IN ('tables_closed', 'tables_closed_bulk')
     AND club_id = 'cb000000-0000-4000-8000-000000000001'),
  'apply replay does not duplicate audit rows'
);

DO $$
BEGIN
  RAISE NOTICE 'dealer swing phone close CAS tests passed';
END;
$$;

ROLLBACK;
