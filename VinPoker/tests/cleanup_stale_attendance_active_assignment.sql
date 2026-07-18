-- ============================================================================
-- P1 cleanup_stale_attendance active-binding invariants
--
-- Local PostgreSQL only. This is a transaction-level harness, not a text test.
-- Run after ALL migrations, never against production:
--   psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 \
--     -f tests/cleanup_stale_attendance_active_assignment.sql
--
-- It seeds only throwaway ca61... UUIDs, rolls every test back to its own
-- savepoint, and rolls the outer transaction back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

BEGIN;

INSERT INTO public.clubs (id, name, region)
VALUES
  ('ca610000-0000-0000-0000-000000000001', '__cleanup_active_a__', 'test'),
  ('ca610000-0000-0000-0000-000000000002', '__cleanup_active_b__', 'test');

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.seed_stale_attendance(
  p_club_id uuid,
  p_label text,
  p_state text DEFAULT 'assigned'
)
RETURNS TABLE(dealer_id uuid, attendance_id uuid, table_id uuid)
LANGUAGE plpgsql
AS $$
BEGIN
  dealer_id := gen_random_uuid();
  attendance_id := gen_random_uuid();
  table_id := gen_random_uuid();

  INSERT INTO public.dealers (id, club_id, full_name, tier)
  VALUES (dealer_id, p_club_id, '__cleanup_' || p_label || '__', 'C');

  INSERT INTO public.game_tables (id, club_id, table_name, table_type, status)
  VALUES (table_id, p_club_id, '__cleanup_' || p_label || '__', 'tournament', 'active');

  INSERT INTO public.dealer_attendance (
    id, dealer_id, status, current_state, check_in_time, shift_date
  ) VALUES (
    attendance_id, dealer_id, 'checked_in', p_state, now() - interval '7 days', current_date
  );

  RETURN NEXT;
END;
$$;

\echo '=== cleanup_stale_attendance active-binding invariants ==='

-- T1: stale attendance with no binding remains eligible for cleanup.
SAVEPOINT t1;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't1');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.dealer_attendance
    WHERE id = r.attendance_id AND status = 'checked_out' AND current_state = 'checked_out'
      AND check_out_time = check_in_time + interval '8 hours'
  ), 'T1 stale attendance without binding was not checked out');
  RAISE NOTICE 'PASS T1';
END;
$$;
ROLLBACK TO SAVEPOINT t1;

-- T2: newly-created active assignment protects an old attendance.
SAVEPOINT t2;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't2');
  INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at)
  VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
          'assigned', now(), now() + interval '45 minutes');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.dealer_attendance WHERE id = r.attendance_id
      AND status = 'checked_in' AND current_state = 'assigned' AND check_out_time IS NULL
  ), 'T2 fresh active assignment was checked out');
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.dealer_assignments WHERE attendance_id = r.attendance_id
      AND status = 'assigned' AND released_at IS NULL AND release_reason IS NULL
  ), 'T2 fresh active assignment was released');
  RAISE NOTICE 'PASS T2';
END;
$$;
ROLLBACK TO SAVEPOINT t2;

-- T3: active assignment older than two hours still protects the dealer.
SAVEPOINT t3;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't3');
  INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at)
  VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
          'assigned', now() - interval '4 hours', now() - interval '3 hours');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((SELECT check_out_time IS NULL FROM public.dealer_attendance WHERE id = r.attendance_id),
    'T3 >2h active assignment was checked out');
  RAISE NOTICE 'PASS T3';
END;
$$;
ROLLBACK TO SAVEPOINT t3;

-- T4: an arbitrarily overdue swing_due_at never authorizes cleanup.
SAVEPOINT t4;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't4');
  INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at)
  VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
          'on_break', now() - interval '2 days', now() - interval '36 hours');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((SELECT check_out_time IS NULL FROM public.dealer_attendance WHERE id = r.attendance_id),
    'T4 overdue swing_due_at was treated as cleanable');
  RAISE NOTICE 'PASS T4';
END;
$$;
ROLLBACK TO SAVEPOINT t4;

-- T5: released/completed history is not active and therefore does not block cleanup.
SAVEPOINT t5;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't5');
  INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, released_at)
  VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
          'completed', now() - interval '3 days', now() - interval '2 days');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((SELECT status = 'checked_out' FROM public.dealer_attendance WHERE id = r.attendance_id),
    'T5 released assignment incorrectly blocked cleanup');
  RAISE NOTICE 'PASS T5';
END;
$$;
ROLLBACK TO SAVEPOINT t5;

-- T6: historical rows do not matter when at least one canonical live binding remains.
SAVEPOINT t6;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't6');
  INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, released_at)
  VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
          'swing_skipped', now() - interval '4 days', now() - interval '3 days');
  INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at)
  VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
          'assigned', now() - interval '5 hours', now() - interval '4 hours');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((SELECT check_out_time IS NULL FROM public.dealer_attendance WHERE id = r.attendance_id),
    'T6 active row was lost among historical assignments');
  RAISE NOTICE 'PASS T6';
END;
$$;
ROLLBACK TO SAVEPOINT t6;

-- T7: club scope changes only the candidate attendance set, never another club.
SAVEPOINT t7;
DO $$
DECLARE a record; b record;
BEGIN
  SELECT * INTO a FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't7a');
  SELECT * INTO b FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000002', 't7b');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((SELECT status = 'checked_out' FROM public.dealer_attendance WHERE id = a.attendance_id),
    'T7 in-scope attendance was not cleaned');
  PERFORM pg_temp.assert_true((SELECT status = 'checked_in' FROM public.dealer_attendance WHERE id = b.attendance_id),
    'T7 cross-club attendance was touched');
  RAISE NOTICE 'PASS T7';
END;
$$;
ROLLBACK TO SAVEPOINT t7;

-- T8: reserved is not a seated assignment, but it is a live dealer binding.
SAVEPOINT t8;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't8', 'on_break');
  INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at)
  VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
          'reserved', now() - interval '5 hours', now() - interval '4 hours');
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((SELECT check_out_time IS NULL FROM public.dealer_attendance WHERE id = r.attendance_id),
    'T8 live reservation did not protect attendance');
  RAISE NOTICE 'PASS T8';
END;
$$;
ROLLBACK TO SAVEPOINT t8;

-- T9: an active row that pre-assigns this attendance is also a live binding.
SAVEPOINT t9;
DO $$
DECLARE current_dealer record; next_dealer record;
BEGIN
  SELECT * INTO current_dealer FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't9current');
  SELECT * INTO next_dealer FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't9next', 'pre_assigned');
  INSERT INTO public.dealer_assignments (
    attendance_id, pre_assigned_attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at
  ) VALUES (
    current_dealer.attendance_id, next_dealer.attendance_id, current_dealer.dealer_id,
    'ca610000-0000-0000-0000-000000000001', current_dealer.table_id,
    'assigned', now() - interval '6 hours', now() - interval '5 hours'
  );
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((SELECT check_out_time IS NULL FROM public.dealer_attendance WHERE id = next_dealer.attendance_id),
    'T9 pre-assigned live binding did not protect attendance');
  RAISE NOTICE 'PASS T9';
END;
$$;
ROLLBACK TO SAVEPOINT t9;

-- T10: reproduce the 16/07 five-dealer incident with overdue assignments.
SAVEPOINT t10;
DO $$
DECLARE r record; i integer; v_checked_out integer; v_live integer;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't10_' || i);
    INSERT INTO public.dealer_assignments (attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at)
    VALUES (r.attendance_id, r.dealer_id, 'ca610000-0000-0000-0000-000000000001', r.table_id,
            'assigned', now() - interval '4 hours', now() - interval '3 hours');
  END LOOP;
  PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  SELECT count(*) INTO v_checked_out FROM public.dealer_attendance
    WHERE dealer_id IN (SELECT id FROM public.dealers WHERE full_name LIKE '__cleanup_t10_%__')
      AND status = 'checked_out';
  SELECT count(*) INTO v_live FROM public.dealer_assignments
    WHERE club_id = 'ca610000-0000-0000-0000-000000000001'
      AND released_at IS NULL AND status = 'assigned'
      AND dealer_id IN (SELECT id FROM public.dealers WHERE full_name LIKE '__cleanup_t10_%__');
  PERFORM pg_temp.assert_true(v_checked_out = 0, 'T10 incident fixture checked out one or more dealers');
  PERFORM pg_temp.assert_true(v_live = 5, 'T10 incident fixture released one or more assignments');
  RAISE NOTICE 'PASS T10';
END;
$$;
ROLLBACK TO SAVEPOINT t10;

-- T11: repeated cleanup is idempotent for an attendance with no live binding.
SAVEPOINT t11;
DO $$
DECLARE r record; first_result jsonb; second_result jsonb;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't11');
  first_result := public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  second_result := public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  PERFORM pg_temp.assert_true((first_result->>'cleaned')::integer = 1, 'T11 first cleanup did not clean exactly one attendance');
  PERFORM pg_temp.assert_true((second_result->>'cleaned')::integer = 0, 'T11 second cleanup was not idempotent');
  PERFORM pg_temp.assert_true((SELECT status = 'checked_out' FROM public.dealer_attendance WHERE id = r.attendance_id),
    'T11 attendance did not remain checked out');
  RAISE NOTICE 'PASS T11';
END;
$$;
ROLLBACK TO SAVEPOINT t11;

-- T12: a failure during the cleanup statement leaves no partial attendance change.
SAVEPOINT t12;
CREATE OR REPLACE FUNCTION pg_temp.fail_cleanup_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'test cleanup failure';
END;
$$;
DO $$
DECLARE r record; did_fail boolean := false;
BEGIN
  SELECT * INTO r FROM pg_temp.seed_stale_attendance('ca610000-0000-0000-0000-000000000001', 't12');
  EXECUTE format(
    'CREATE TRIGGER cleanup_active_assignment_test_failure BEFORE UPDATE ON public.dealer_attendance '
    || 'FOR EACH ROW WHEN (OLD.id = %L::uuid) EXECUTE FUNCTION pg_temp.fail_cleanup_update()',
    r.attendance_id
  );
  BEGIN
    PERFORM public.cleanup_stale_attendance('ca610000-0000-0000-0000-000000000001', 24);
  EXCEPTION WHEN OTHERS THEN
    did_fail := true;
  END;
  PERFORM pg_temp.assert_true(did_fail, 'T12 injected update failure did not propagate');
  PERFORM pg_temp.assert_true(EXISTS (
    SELECT 1 FROM public.dealer_attendance
    WHERE id = r.attendance_id AND status = 'checked_in' AND current_state = 'assigned' AND check_out_time IS NULL
  ), 'T12 failure left a partial checkout');
  RAISE NOTICE 'PASS T12';
END;
$$;
ROLLBACK TO SAVEPOINT t12;

ROLLBACK;
\echo 'ALL CLEANUP ACTIVE-BINDING TRANSACTION TESTS PASSED'
