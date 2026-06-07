-- Phase 5 PR #1 Tests
-- Tests for: NOTIFY trigger state transition, atomic check, rest deficit, null baseline
-- Run these on canary club (22222222-2222-2222-2222-222222222222) to verify PR #1

\set ON_ERROR_STOP off

\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST 1: NOTIFY trigger fires on UPDATE state transition'
\echo '  Expected: trigger fires when current_state changes from on_break/assigned → available'
\echo '═══════════════════════════════════════════════════════════════════'

-- Create test dealer + attendance (skip if club doesn't exist)
DO $$
DECLARE
  v_test_dealer_id UUID;
  v_test_attendance_id UUID;
  v_old_state TEXT;
  v_new_state TEXT;
BEGIN
  -- Pick a test dealer in canary club
  SELECT d.id INTO v_test_dealer_id
  FROM public.dealers d
  WHERE d.club_id = '22222222-2222-2222-2222-222222222222'::UUID
  LIMIT 1;

  IF v_test_dealer_id IS NULL THEN
    RAISE NOTICE 'SKIP: No dealer in canary club';
    RETURN;
  END IF;

  -- Get or create test attendance
  SELECT da.id, da.current_state
  INTO   v_test_attendance_id, v_old_state
  FROM   public.dealer_attendance da
  WHERE  da.dealer_id = v_test_dealer_id
    AND  da.check_out_time IS NULL
  LIMIT 1;

  IF v_test_attendance_id IS NULL THEN
    RAISE NOTICE 'SKIP: No active attendance for test dealer';
    RETURN;
  END IF;

  RAISE NOTICE 'Test dealer: %, attendance: %, current_state: %',
    v_test_dealer_id, v_test_attendance_id, v_old_state;

  -- Force state to on_break, then transition to available
  UPDATE public.dealer_attendance
  SET current_state = 'on_break'
  WHERE id = v_test_attendance_id;

  RAISE NOTICE '  Set state to on_break — should NOT fire (not → available)';

  UPDATE public.dealer_attendance
  SET current_state = 'available'
  WHERE id = v_test_attendance_id;

  RAISE NOTICE '  Set state to available — should FIRE (on_break → available)';

  -- Restore original state
  UPDATE public.dealer_attendance
  SET current_state = v_old_state
  WHERE id = v_test_attendance_id;

  RAISE NOTICE '  Restored state to %', v_old_state;
END $$;

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST 2: NOTIFY trigger does NOT fire on no state change'
\echo '  Expected: trigger does NOT fire when available → available (other col update)'
\echo '═══════════════════════════════════════════════════════════════════'

DO $$
DECLARE
  v_test_attendance_id UUID;
  v_old_state TEXT;
  v_old_worked_min INT;
BEGIN
  SELECT da.id, da.current_state, da.worked_minutes_since_last_break
  INTO   v_test_attendance_id, v_old_state, v_old_worked_min
  FROM   public.dealer_attendance da
  INNER JOIN public.dealers d ON d.id = da.dealer_id
  WHERE  d.club_id = '22222222-2222-2222-2222-222222222222'::UUID
    AND  da.check_out_time IS NULL
    AND  da.current_state = 'available'
  LIMIT 1;

  IF v_test_attendance_id IS NULL THEN
    RAISE NOTICE 'SKIP: No available dealer in canary club';
    RETURN;
  END IF;

  RAISE NOTICE 'Test attendance: %, state: %, worked_min: %',
    v_test_attendance_id, v_old_state, v_old_worked_min;

  -- Update worked_minutes only (no state change)
  UPDATE public.dealer_attendance
  SET worked_minutes_since_last_break = COALESCE(worked_minutes_since_last_break, 0) + 1
  WHERE id = v_test_attendance_id;

  RAISE NOTICE '  Updated worked_minutes only — should NOT fire (state unchanged)';

  -- Restore
  UPDATE public.dealer_attendance
  SET worked_minutes_since_last_break = v_old_worked_min
  WHERE id = v_test_attendance_id;

  RAISE NOTICE '  Restored worked_minutes to %', v_old_worked_min;
END $$;

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST 3: atomic_dealer_ready_check returns verified for available dealer'
\echo '═══════════════════════════════════════════════════════════════════'

SELECT * FROM public.atomic_dealer_ready_check(
  '22222222-2222-2222-2222-222222222222'::UUID,
  (SELECT da.id FROM public.dealer_attendance da
   INNER JOIN public.dealers d ON d.id = da.dealer_id
   WHERE d.club_id = '22222222-2222-2222-2222-222222222222'::UUID
     AND da.current_state = 'available'
     AND da.check_out_time IS NULL
   LIMIT 1)
);

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST 4: atomic_dealer_ready_check returns skipped for assigned dealer'
\echo '═══════════════════════════════════════════════════════════════════'

SELECT * FROM public.atomic_dealer_ready_check(
  '22222222-2222-2222-2222-222222222222'::UUID,
  (SELECT da.id FROM public.dealer_attendance da
   INNER JOIN public.dealers d ON d.id = da.dealer_id
   WHERE d.club_id = '22222222-2222-2222-2222-222222222222'::UUID
     AND da.current_state = 'assigned'
   LIMIT 1)
);

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST 5: atomic_dealer_ready_check returns skipped for non-existent'
\echo '═══════════════════════════════════════════════════════════════════'

SELECT * FROM public.atomic_dealer_ready_check(
  '22222222-2222-2222-2222-222222222222'::UUID,
  '00000000-0000-0000-0000-000000000000'::UUID
);

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST 6: perform_swing has 2 overloads (both 8-param)'
\echo '═══════════════════════════════════════════════════════════════════'

SELECT count(*) AS perform_swing_overload_count
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'perform_swing'
  AND n.nspname = 'public'
  AND pg_get_function_arguments(p.oid) LIKE '%p_rest_deficit_minutes%';

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST 7: notify_dealer_ready_v2 trigger exists and enabled'
\echo '═══════════════════════════════════════════════════════════════════'

SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  tgenabled AS enabled
FROM pg_trigger
WHERE tgname = 'trg_notify_dealer_ready_v2';

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'PR #1 TESTS COMPLETE'
\echo '═══════════════════════════════════════════════════════════════════'
