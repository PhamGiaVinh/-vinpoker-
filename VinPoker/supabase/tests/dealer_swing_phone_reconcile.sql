-- Phone reconcile wrapper + canonical swap/cycle/CAS tests.
-- Disposable current-schema database only; all writes are rolled back.

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

CREATE OR REPLACE FUNCTION pg_temp.attach_reconcile_plan(p_corrections jsonb, p_plan jsonb)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_agg(
    correction.value || jsonb_build_object(
      'expected_assignment_id', plan.value->'expected_assignment_id',
      'expected_version', plan.value->'expected_version'
    ) ORDER BY correction.ordinality
  )
  FROM jsonb_array_elements(p_corrections) WITH ORDINALITY correction(value, ordinality)
  LEFT JOIN LATERAL (
    SELECT value
    FROM jsonb_array_elements(p_plan)
    WHERE value->>'table_id' = correction.value->>'table_id'
    LIMIT 1
  ) plan ON true;
$$;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'reconcile-admin@test.invalid', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'reconcile-operator@test.invalid', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'reconcile-other@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'RECONCILE TEST', 'HCM', 'approved'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'OTHER RECONCILE', 'HCM', 'approved');

INSERT INTO public.club_dealer_controls (user_id, club_id, granted_by)
VALUES ('a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');

INSERT INTO public.dealer_shifts (id, club_id, tour_name, start_time, end_time)
VALUES ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'RECONCILE SHIFT', '00:00', '23:59');

INSERT INTO public.game_tables (id, club_id, shift_id, table_name, status)
VALUES
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'SWAP 1', 'active'),
  ('a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'SWAP 2', 'active'),
  ('a4000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'CYCLE 1', 'active'),
  ('a4000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'CYCLE 2', 'active'),
  ('a4000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'CYCLE 3', 'active'),
  ('a4000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'RACE', 'active'),
  ('a4000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'ADMIN OLD', 'active'),
  ('a4000000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000002', NULL, 'OTHER CLUB TABLE', 'active');

INSERT INTO public.dealers (id, club_id, full_name, status)
SELECT
  ('a5000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'Reconcile dealer ' || n,
  'active'
FROM generate_series(1, 9) n;

INSERT INTO public.dealer_attendance (
  id, dealer_id, shift_id, shift_date, status, current_state, check_in_time
)
SELECT
  ('a6000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('a5000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'a3000000-0000-4000-8000-000000000001'::uuid,
  current_date,
  'checked_in',
  CASE WHEN n IN (8, 9) THEN 'available' ELSE 'assigned' END,
  now() - interval '3 hours'
FROM generate_series(1, 9) n;

INSERT INTO public.dealer_assignments (
  id, attendance_id, dealer_id, table_id, club_id, status,
  assigned_at, swing_due_at, version
)
SELECT
  ('a7000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('a6000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('a5000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('a4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'assigned',
  now() - interval '2 hours',
  now() + interval '30 minutes',
  1
FROM generate_series(1, 7) n;

UPDATE public.dealer_swing_phone_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['a2000000-0000-4000-8000-000000000001'::uuid],
    updated_at = now()
WHERE id;

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Swap two tables.
DO $$
DECLARE
  v_effective timestamptz := clock_timestamp();
  v_corrections jsonb := jsonb_build_array(
    jsonb_build_object('table_id', 'a4000000-0000-4000-8000-000000000001', 'actual_attendance_id', 'a6000000-0000-4000-8000-000000000002'),
    jsonb_build_object('table_id', 'a4000000-0000-4000-8000-000000000002', 'actual_attendance_id', 'a6000000-0000-4000-8000-000000000001')
  );
  v_dry jsonb;
  v_apply jsonb;
BEGIN
  v_dry := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001', v_corrections, v_effective,
    'swap two tables', '[]'::jsonb, true, false
  );
  PERFORM pg_temp.assert_eq(v_dry->>'outcome', 'dry_run', 'swap two dry-run');
  PERFORM pg_temp.assert_true((v_dry->>'can_apply')::boolean, 'swap two can apply');

  v_apply := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001',
    pg_temp.attach_reconcile_plan(v_corrections, v_dry->'plan'),
    v_effective, 'swap two tables', '[]'::jsonb, false, false
  );
  PERFORM pg_temp.assert_eq(v_apply->>'outcome', 'applied', 'swap two applies');
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT bool_and(
     (attendance_id = 'a6000000-0000-4000-8000-000000000001' AND table_id = 'a4000000-0000-4000-8000-000000000002')
     OR
     (attendance_id = 'a6000000-0000-4000-8000-000000000002' AND table_id = 'a4000000-0000-4000-8000-000000000001')
   ) FROM public.dealer_assignments
   WHERE attendance_id IN (
     'a6000000-0000-4000-8000-000000000001',
     'a6000000-0000-4000-8000-000000000002'
   ) AND released_at IS NULL),
  'swap two final assignment positions'
);

-- Cycle three tables: 3->4, 4->5, 5->3.
DO $$
DECLARE
  v_effective timestamptz := clock_timestamp();
  v_corrections jsonb := jsonb_build_array(
    jsonb_build_object('table_id', 'a4000000-0000-4000-8000-000000000003', 'actual_attendance_id', 'a6000000-0000-4000-8000-000000000005'),
    jsonb_build_object('table_id', 'a4000000-0000-4000-8000-000000000004', 'actual_attendance_id', 'a6000000-0000-4000-8000-000000000003'),
    jsonb_build_object('table_id', 'a4000000-0000-4000-8000-000000000005', 'actual_attendance_id', 'a6000000-0000-4000-8000-000000000004')
  );
  v_dry jsonb;
  v_apply jsonb;
BEGIN
  v_dry := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001', v_corrections, v_effective,
    'cycle three tables', '[]'::jsonb, true, false
  );
  PERFORM pg_temp.assert_eq(v_dry->>'outcome', 'dry_run', 'cycle three dry-run');
  PERFORM pg_temp.assert_true((v_dry->>'can_apply')::boolean, 'cycle three can apply');

  v_apply := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001',
    pg_temp.attach_reconcile_plan(v_corrections, v_dry->'plan'),
    v_effective, 'cycle three tables', '[]'::jsonb, false, false
  );
  PERFORM pg_temp.assert_eq(v_apply->>'outcome', 'applied', 'cycle three applies');
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT count(*) = 3 FROM public.dealer_assignments
   WHERE released_at IS NULL AND (
     (attendance_id = 'a6000000-0000-4000-8000-000000000003' AND table_id = 'a4000000-0000-4000-8000-000000000004')
     OR (attendance_id = 'a6000000-0000-4000-8000-000000000004' AND table_id = 'a4000000-0000-4000-8000-000000000005')
     OR (attendance_id = 'a6000000-0000-4000-8000-000000000005' AND table_id = 'a4000000-0000-4000-8000-000000000003')
   )),
  'cycle three final assignment positions'
);

DO $$
DECLARE v jsonb;
BEGIN
  v := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001',
    jsonb_build_array(
      jsonb_build_object('table_id', 'a4000000-0000-4000-8000-000000000003', 'actual_attendance_id', 'a6000000-0000-4000-8000-000000000003'),
      jsonb_build_object('table_id', 'a4000000-0000-4000-8000-000000000004', 'actual_attendance_id', 'a6000000-0000-4000-8000-000000000003')
    ),
    clock_timestamp(), 'duplicate dealer test', '[]'::jsonb, true, false
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'dealer_duplicate_in_payload', 'duplicate dealer rejected');

  v := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'table_id', 'a4000000-0000-4000-8000-000000000008',
      'actual_attendance_id', 'a6000000-0000-4000-8000-000000000008'
    )),
    clock_timestamp(), 'cross club table test', '[]'::jsonb, true, false
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'invalid_input', 'cross-club table rejected');
END;
$$;

-- Race: preview replacement, bump current assignment version, apply old plan.
DO $$
DECLARE
  v_effective timestamptz := clock_timestamp();
  v_corrections jsonb := jsonb_build_array(jsonb_build_object(
    'table_id', 'a4000000-0000-4000-8000-000000000006',
    'actual_attendance_id', 'a6000000-0000-4000-8000-000000000008'
  ));
  v_displaced jsonb := jsonb_build_array(jsonb_build_object(
    'attendance_id', 'a6000000-0000-4000-8000-000000000006',
    'resolution', 'pool_available',
    'reason', 'race replacement'
  ));
  v_dry jsonb;
  v_apply jsonb;
BEGIN
  v_dry := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001', v_corrections, v_effective,
    'race replacement', v_displaced, true, false
  );
  PERFORM pg_temp.assert_true((v_dry->>'can_apply')::boolean, 'race preview initially can apply');

  UPDATE public.dealer_assignments
  SET version = version + 1
  WHERE id = 'a7000000-0000-4000-8000-000000000006';

  v_apply := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001',
    pg_temp.attach_reconcile_plan(v_corrections, v_dry->'plan'),
    v_effective, 'race replacement', v_displaced, false, false
  );
  PERFORM pg_temp.assert_eq(v_apply->>'outcome', 'race_lost', 'stale reconcile plan loses race');
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT table_id = 'a4000000-0000-4000-8000-000000000006'
   FROM public.dealer_assignments
   WHERE id = 'a7000000-0000-4000-8000-000000000006'),
  'race-lost leaves assignment at original table'
);

-- Non-admin 120-minute gate, override denial, then owner-admin override acceptance.
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
DO $$
DECLARE
  v_corrections jsonb := jsonb_build_array(jsonb_build_object(
    'table_id', 'a4000000-0000-4000-8000-000000000007',
    'actual_attendance_id', 'a6000000-0000-4000-8000-000000000009'
  ));
  v_displaced jsonb := jsonb_build_array(jsonb_build_object(
    'attendance_id', 'a6000000-0000-4000-8000-000000000007',
    'resolution', 'pool_available',
    'reason', 'old correction'
  ));
  v jsonb;
BEGIN
  v := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001', v_corrections,
    now() - interval '121 minutes', 'old correction', v_displaced, true, false
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'effective_at_too_old', 'non-admin blocked after 120 minutes');

  v := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001', v_corrections,
    now() - interval '121 minutes', 'old correction', v_displaced, true, true
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'override_forbidden', 'non-admin cannot override 120 minutes');
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
DO $$
DECLARE
  v_corrections jsonb := jsonb_build_array(jsonb_build_object(
    'table_id', 'a4000000-0000-4000-8000-000000000007',
    'actual_attendance_id', 'a6000000-0000-4000-8000-000000000009'
  ));
  v_displaced jsonb := jsonb_build_array(jsonb_build_object(
    'attendance_id', 'a6000000-0000-4000-8000-000000000007',
    'resolution', 'pool_available',
    'reason', 'admin old correction'
  ));
  v jsonb;
BEGIN
  v := public.dealer_phone_reconcile_room_state(
    'a2000000-0000-4000-8000-000000000001', v_corrections,
    now() - interval '121 minutes', 'admin old correction', v_displaced, true, true
  );
  PERFORM pg_temp.assert_eq(v->>'outcome', 'dry_run', 'club admin may preview old correction');
  PERFORM pg_temp.assert_true((v->>'can_apply')::boolean, 'club admin old correction can apply');
END;
$$;

DO $$
BEGIN
  RAISE NOTICE 'dealer swing phone reconcile tests passed';
END;
$$;

ROLLBACK;
