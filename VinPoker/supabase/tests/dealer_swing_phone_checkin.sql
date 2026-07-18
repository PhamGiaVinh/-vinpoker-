-- Dealer Swing phone operator check-in contract tests.
-- Run only against a disposable database restored from the current schema.
-- Every fixture and write is rolled back.

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

CREATE OR REPLACE FUNCTION pg_temp.entry_json(
  p_entry_id uuid,
  p_mode text,
  p_input_method text,
  p_user_id uuid,
  p_dealer_id uuid,
  p_shift_assignment_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'entry_id', p_entry_id,
    'mode', p_mode,
    'input_method', p_input_method,
    'user_id', p_user_id,
    'dealer_id', p_dealer_id,
    'shift_assignment_id', p_shift_assignment_id,
    'reason', p_reason
  );
$$;

SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.operator_check_in_dealers(uuid,uuid,jsonb)', 'EXECUTE'),
  'anon cannot execute operator check-in'
);
SELECT pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.operator_check_in_dealers(uuid,uuid,jsonb)', 'EXECUTE'),
  'authenticated can execute operator check-in'
);
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.operator_dealer_checkin_requests', 'SELECT'),
  'request store is not directly readable by authenticated'
);
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.dealer_swing_phone_rollout', 'UPDATE'),
  'runtime gate is not directly writable by authenticated'
);
SELECT pg_temp.assert_true(
  (SELECT NOT enabled AND NOT all_clubs_enabled AND cardinality(allowed_club_ids) = 0
   FROM public.dealer_swing_phone_rollout WHERE id),
  'runtime rollout defaults off with an empty allowlist'
);

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authenticated', 'authenticated', 'operator-a@test.invalid', now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'authenticated', 'authenticated', 'operator-b@test.invalid', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'authenticated', 'authenticated', 'dealer-qr@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'HSOP TEST', 'HCM', 'approved'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'OTHER TEST', 'HCM', 'approved');

INSERT INTO public.dealers (id, club_id, user_id, full_name, status)
VALUES
  ('d0000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Linked dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222', NULL, 'Inactive dealer', 'inactive'),
  ('d0000000-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', NULL, 'Too early dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000004', '22222222-2222-2222-2222-222222222222', NULL, 'Waiting dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000005', '22222222-2222-2222-2222-222222222222', NULL, 'On time dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000006', '22222222-2222-2222-2222-222222222222', NULL, 'Late dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000007', '22222222-2222-2222-2222-222222222222', NULL, 'Bridge dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000008', '22222222-2222-2222-2222-222222222222', NULL, 'Replay dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000009', '22222222-2222-2222-2222-222222222222', NULL, 'Partial dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000010', '22222222-2222-2222-2222-222222222222', NULL, 'Mismatch caller', 'active'),
  ('d0000000-0000-4000-8000-000000000011', '22222222-2222-2222-2222-222222222222', NULL, 'Mismatch owner', 'active'),
  ('d0000000-0000-4000-8000-000000000012', '22222222-2222-2222-2222-222222222222', NULL, 'Invalid state dealer', 'active'),
  ('d0000000-0000-4000-8000-000000000020', '33333333-3333-3333-3333-333333333333', NULL, 'Other club dealer', 'active');

INSERT INTO public.dealer_shifts (id, club_id, tour_name, start_time, end_time)
VALUES
  ('c0000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'TEST SHIFT', '00:00', '23:59'),
  ('c0000000-0000-4000-8000-000000000002', '33333333-3333-3333-3333-333333333333', 'OTHER SHIFT', '00:00', '23:59');

INSERT INTO public.dealer_schedule_runs (
  id, club_id, work_date, solver_version, status, published_at
)
VALUES (
  'c1000000-0000-4000-8000-000000000001',
  '22222222-2222-2222-2222-222222222222',
  (now() AT TIME ZONE 'UTC')::date,
  'sql-test',
  'published',
  now()
);

INSERT INTO public.dealer_shift_assignments (
  id, club_id, run_id, dealer_id, work_date,
  scheduled_start_at, scheduled_end_at, status, checked_in_at
)
VALUES
  ('a0000000-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', (now() AT TIME ZONE 'UTC')::date, now() + interval '2 hours', now() + interval '10 hours', 'published', NULL),
  ('a0000000-0000-4000-8000-000000000004', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', (now() AT TIME ZONE 'UTC')::date, now() + interval '20 minutes', now() + interval '8 hours', 'published', NULL),
  ('a0000000-0000-4000-8000-000000000005', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', (now() AT TIME ZONE 'UTC')::date, now() - interval '1 minute', now() + interval '8 hours', 'confirmed', NULL),
  ('a0000000-0000-4000-8000-000000000006', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', (now() AT TIME ZONE 'UTC')::date, now() - interval '20 minutes', now() + interval '8 hours', 'published', NULL),
  ('a0000000-0000-4000-8000-000000000007', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000007', (now() AT TIME ZONE 'UTC')::date, now() - interval '1 minute', now() + interval '8 hours', 'checked_in', now() - interval '20 minutes'),
  ('a0000000-0000-4000-8000-000000000011', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', (now() AT TIME ZONE 'UTC')::date, now() - interval '1 minute', now() + interval '8 hours', 'published', NULL),
  ('a0000000-0000-4000-8000-000000000012', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000012', (now() AT TIME ZONE 'UTC')::date, now() - interval '1 minute', now() + interval '8 hours', 'cancelled', NULL);

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE v jsonb;
BEGIN
  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000000', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000001', NULL, 'dark deploy probe'
    ))
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'rollout_disabled', 'server master switch blocks writes');
END;
$$;

INSERT INTO public.dealer_selfcheckin_config (id, scheduled_pool_enabled, updated_at)
VALUES (true, true, now())
ON CONFLICT (id) DO UPDATE
SET scheduled_pool_enabled = EXCLUDED.scheduled_pool_enabled,
    updated_at = EXCLUDED.updated_at;

UPDATE public.dealer_swing_phone_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['22222222-2222-2222-2222-222222222222'::uuid],
    updated_at = now()
WHERE id;

SET LOCAL ROLE authenticated;

DO $$
DECLARE v jsonb;
BEGIN
  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000001',
    '33333333-3333-3333-3333-333333333333',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000001', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000020', NULL, 'cross-club attempt'
    ))
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'invalid_request', 'actor cannot target another club');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-00000000000e',
    '22222222-2222-2222-2222-222222222222',
    '{}'::jsonb
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'invalid_request', 'malformed entries object rejected');

  SELECT jsonb_agg('{}'::jsonb) INTO v FROM generate_series(1, 51);
  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-00000000000f',
    '22222222-2222-2222-2222-222222222222',
    v
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'batch_too_large', 'batch 51 rejected');
END;
$$;

DO $$
DECLARE v jsonb;
BEGIN
  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000002',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(
      pg_temp.entry_json('e0000000-0000-4000-8000-000000000002', 'unscheduled', 'camera', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', NULL, NULL, 'walk-in'),
      pg_temp.entry_json('e0000000-0000-4000-8000-000000000003', 'unscheduled', 'manual_list', NULL, 'd0000000-0000-4000-8000-000000000001', NULL, 'walk-in')
    )
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'duplicate_dealer', 'duplicate resolved dealer rejects full batch');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000003',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000004', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000002', NULL, 'backup'
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'dealer_inactive', 'inactive dealer rejected');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000004',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000005', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000008', NULL, NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'reason_required', 'unscheduled reason required per entry');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000005',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000006', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000010', NULL, NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'shift_not_found', 'scheduled shift id required per entry');
END;
$$;

DO $$
DECLARE v jsonb;
BEGIN
  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000006',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000007', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'too_early', 'scheduled too-early rejected');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000007',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000008', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'checked_in_waiting', 'early arrival waits for shift');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000008',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-000000000009', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'checked_in_available', 'on-time arrival enters pool');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-000000000009',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-00000000000a', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'checked_in_available', 'late arrival enters pool');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-00000000000a',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-00000000000b', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'already_checked_in', 'already checked-in is stable');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-00000000000b',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-00000000000c', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'shift_dealer_mismatch', 'shift dealer mismatch rejected');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-00000000000c',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-00000000000d', 'scheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000012', NULL
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'invalid_shift_state', 'cancelled shift rejected');

  v := public.operator_check_in_dealers(
    'f0000000-0000-4000-8000-00000000000d',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e0000000-0000-4000-8000-00000000000e', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000020', NULL, 'wrong club'
    ))
  );
  PERFORM pg_temp.assert_eq(v->'results'->0->>'code', 'club_mismatch', 'dealer club is derived server-side');
END;
$$;

DO $$
DECLARE v_first jsonb; v_replay jsonb; v_conflict jsonb; v_partial jsonb;
BEGIN
  v_first := public.operator_check_in_dealers(
    'f1000000-0000-4000-8000-000000000001',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e1000000-0000-4000-8000-000000000001', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000008', NULL, 'walk-in backup'
    ))
  );
  v_replay := public.operator_check_in_dealers(
    'f1000000-0000-4000-8000-000000000001',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e1000000-0000-4000-8000-000000000001', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000008', NULL, 'walk-in backup'
    ))
  );
  PERFORM pg_temp.assert_true(v_first = v_replay, 'idempotent replay returns cached response');

  v_conflict := public.operator_check_in_dealers(
    'f1000000-0000-4000-8000-000000000001',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(pg_temp.entry_json(
      'e1000000-0000-4000-8000-000000000001', 'unscheduled', 'manual_list', NULL,
      'd0000000-0000-4000-8000-000000000008', NULL, 'changed reason'
    ))
  );
  PERFORM pg_temp.assert_eq(v_conflict->>'outcome', 'idempotency_conflict', 'request id cannot be reused with changed payload');

  v_partial := public.operator_check_in_dealers(
    'f1000000-0000-4000-8000-000000000002',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_array(
      pg_temp.entry_json('e1000000-0000-4000-8000-000000000002', 'unscheduled', 'manual_list', NULL, 'd0000000-0000-4000-8000-000000000009', NULL, 'extra dealer'),
      pg_temp.entry_json('e1000000-0000-4000-8000-000000000003', 'unscheduled', 'manual_list', NULL, 'd0000000-0000-4000-8000-000000000002', NULL, 'inactive')
    )
  );
  PERFORM pg_temp.assert_eq(v_partial->>'outcome', 'partial', 'mixed batch returns partial');
  PERFORM pg_temp.assert_eq(v_partial->'results'->0->>'code', 'checked_in_available', 'valid partial entry committed');
  PERFORM pg_temp.assert_eq(v_partial->'results'->1->>'code', 'dealer_inactive', 'invalid partial entry isolated');
END;
$$;

RESET ROLE;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.dealer_shift_assignments
    WHERE id = 'a0000000-0000-4000-8000-000000000003'
      AND checked_in_at IS NOT NULL
  ),
  'too-early attempt wrote no arrival'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.dealer_shift_assignments
    WHERE id = 'a0000000-0000-4000-8000-000000000004'
      AND checked_in_at IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.dealer_attendance
    WHERE dealer_id = 'd0000000-0000-4000-8000-000000000004'
      AND status = 'checked_in'
  ),
  'early arrival is persisted without starting payroll'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM public.dealer_shift_assignments a
    JOIN public.dealer_attendance da ON da.dealer_id = a.dealer_id AND da.status = 'checked_in'
    WHERE a.id = 'a0000000-0000-4000-8000-000000000005'
      AND a.checked_in_at <= now()
      AND da.check_in_time <= now()
  ),
  'on-time arrival and payroll start are non-future persisted values'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.dealer_shift_events
    WHERE assignment_id = 'a0000000-0000-4000-8000-000000000006'
      AND event_type = 'late'
  ),
  'late marker is persisted explicitly'
);
SELECT pg_temp.assert_eq(
  (SELECT count(*)::text FROM public.audit_logs
   WHERE action = 'operator_dealer_unscheduled_checkin'
     AND entity_id = 'd0000000-0000-4000-8000-000000000008'),
  '1',
  'idempotent replay writes one audit row'
);
SELECT pg_temp.assert_eq(
  (SELECT count(*)::text FROM public.dealer_attendance
   WHERE dealer_id = 'd0000000-0000-4000-8000-000000000008'
     AND status = 'checked_in'),
  '1',
  'idempotent replay writes one attendance row'
);

SELECT public.bridge_shift_checkins_to_pool();
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM public.dealer_shift_assignments a
    JOIN public.dealer_attendance da ON da.dealer_id = a.dealer_id AND da.status = 'checked_in'
    WHERE a.id = 'a0000000-0000-4000-8000-000000000007'
      AND da.check_in_time = a.scheduled_start_at
      AND da.check_in_time > a.checked_in_at
      AND da.check_in_time <= now()
  ),
  'scheduled bridge promotes waiting arrival at payroll start without future time'
);

DO $$
BEGIN
  RAISE NOTICE 'dealer swing phone check-in SQL tests passed';
END;
$$;

ROLLBACK;
