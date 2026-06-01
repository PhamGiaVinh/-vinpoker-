-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: perform_swing — WITH app.state_reason CONTEXT
--
-- Complete rewrite of perform_swing that properly uses app.state_reason for
-- every state transition, ensuring the trigger captures meaningful audit reasons.
--
-- Key improvements:
--   + app.state_reason set BEFORE every dealer_attendance UPDATE
--   + Version guard (optimistic locking) via p_expected_version
--   + State guard (rejects if already in_transition)
--   + Gets next dealer internally (pre-assigned first, then pool)
--   + Compensatory break formula with OT calculation
--   + Returns structured JSONB result
--
-- NOTE: This RPC has a different signature from previous versions. Callers
-- in index.ts must be updated to match: (p_assignment_id, p_duration_minutes,
-- p_send_to_break, p_break_duration_minutes, p_max_break_minutes, p_expected_version)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop old overloads to avoid ambiguity
DROP FUNCTION IF EXISTS public.perform_swing(
  p_assignment_id UUID,
  p_version INT,
  p_next_attendance_id UUID,
  p_send_to_break BOOLEAN,
  p_break_duration_minutes INT,
  p_swing_duration_minutes INT
);

DROP FUNCTION IF EXISTS public.perform_swing(
  p_old_assignment_id UUID,
  p_old_version INT,
  p_old_attendance_id UUID,
  p_new_attendance_id UUID,
  p_table_id UUID,
  p_club_id UUID,
  p_shift_id UUID,
  p_swing_reason TEXT,
  p_should_break BOOLEAN,
  p_break_reason TEXT
);

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id UUID,
  p_duration_minutes INT,
  p_send_to_break BOOLEAN,
  p_break_duration_minutes INT DEFAULT 15,
  p_max_break_minutes INT DEFAULT 60,
  p_expected_version INT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Old dealer (outgoing)
  v_old_dealer_id UUID;
  v_old_attendance_id UUID;
  v_started_at TIMESTAMPTZ;
  v_table_id TEXT;
  v_club_id UUID;
  v_shift_id UUID;

  -- Timing & OT
  v_actual_minutes NUMERIC;
  v_ot_minutes INT := 0;
  v_comp_break INT;
  v_work_minutes NUMERIC;

  -- New dealer (incoming)
  v_next_dealer_id UUID;
  v_next_attendance_id UUID;
  v_new_assignment_id UUID;

  -- State tracking
  v_current_state TEXT;
  v_actual_version INT;
  v_was_priority_break BOOLEAN;
  v_next_dealer_was_pre_assigned BOOLEAN := false;

  -- Results
  v_outcome TEXT;
  v_message TEXT;
BEGIN
  -- ========================================
  -- STEP 1: VALIDATE & LOCK OLD ASSIGNMENT
  -- ========================================

  SELECT
    da.dealer_id,
    da.table_id,
    da.club_id,
    da.shift_id,
    da.started_at,
    da.attendance_id,
    da.version,
    dat.current_state,
    dat.priority_break_flag
  INTO
    v_old_dealer_id,
    v_table_id,
    v_club_id,
    v_shift_id,
    v_started_at,
    v_old_attendance_id,
    v_actual_version,
    v_current_state,
    v_was_priority_break
  FROM dealer_assignments da
  INNER JOIN dealer_attendance dat ON dat.id = da.attendance_id
  WHERE da.id = p_assignment_id
    AND da.status = 'active'
    AND da.ended_at IS NULL
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'not_found',
      'message', 'Assignment not found or already ended',
      'assignment_id', p_assignment_id
    );
  END IF;

  -- Version guard (optimistic locking)
  IF p_expected_version IS NOT NULL AND v_actual_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'outcome', 'version_conflict',
      'message', 'Assignment was modified by another process',
      'expected_version', p_expected_version,
      'actual_version', v_actual_version
    );
  END IF;

  -- State guard
  IF v_current_state = 'in_transition' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_in_transition',
      'message', 'Dealer is already being swung',
      'dealer_id', v_old_dealer_id
    );
  END IF;

  -- ========================================
  -- STEP 2: LOCK DEALER IN TRANSITION
  -- ========================================

  PERFORM set_config(
    'app.state_reason',
    format('swing_start_table_%s_assignment_%s', v_table_id, p_assignment_id),
    true
  );

  UPDATE dealer_attendance
  SET
    current_state = 'in_transition',
    updated_at = NOW()
  WHERE id = v_old_attendance_id
    AND current_state = 'assigned';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'state_conflict',
      'message', format('Dealer state is not "assigned" (current: %s)', v_current_state),
      'current_state', v_current_state
    );
  END IF;

  -- ========================================
  -- STEP 3: CALCULATE OT & COMPENSATORY BREAK
  -- ========================================

  v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  v_work_minutes := v_actual_minutes;

  IF v_actual_minutes > p_duration_minutes THEN
    v_ot_minutes := FLOOR(v_actual_minutes - p_duration_minutes);
  END IF;

  v_comp_break := COALESCE(p_break_duration_minutes, 15) + FLOOR(v_ot_minutes * 0.5);
  v_comp_break := LEAST(v_comp_break, COALESCE(p_max_break_minutes, 60));

  IF v_work_minutes > 240 AND v_comp_break < 30 THEN
    v_comp_break := 30;
  END IF;

  IF v_comp_break < 5 THEN
    v_comp_break := 5;
  END IF;

  -- ========================================
  -- STEP 4: GET NEXT DEALER
  -- ========================================

  SELECT pre_assigned_attendance_id
  INTO v_next_attendance_id
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND pre_assigned_attendance_id IS NOT NULL;

  IF v_next_attendance_id IS NOT NULL THEN
    SELECT dealer_id, current_state
    INTO v_next_dealer_id, v_current_state
    FROM dealer_attendance
    WHERE id = v_next_attendance_id
      AND current_state = 'pre_assigned'
    FOR UPDATE;

    IF FOUND THEN
      v_next_dealer_was_pre_assigned := true;
    ELSE
      v_next_attendance_id := NULL;
    END IF;
  END IF;

  IF v_next_attendance_id IS NULL THEN
    SELECT id, dealer_id
    INTO v_next_attendance_id, v_next_dealer_id
    FROM dealer_attendance
    WHERE club_id = v_club_id
      AND shift_id = v_shift_id
      AND current_state = 'available'
      AND checked_in_at IS NOT NULL
      AND checked_out_at IS NULL
    ORDER BY
      priority_break_flag DESC,
      worked_minutes_since_last_break ASC,
      RANDOM()
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      PERFORM set_config(
        'app.state_reason',
        format('swing_no_dealer_revert_table_%s', v_table_id),
        true
      );

      UPDATE dealer_attendance
      SET current_state = 'assigned', updated_at = NOW()
      WHERE id = v_old_attendance_id;

      RETURN jsonb_build_object(
        'outcome', 'no_dealer_available',
        'message', 'No dealers in pool',
        'table_id', v_table_id
      );
    END IF;
  END IF;

  -- ========================================
  -- STEP 5: END OLD ASSIGNMENT
  -- ========================================

  UPDATE dealer_assignments
  SET
    status = 'completed',
    ended_at = NOW(),
    actual_duration_minutes = v_actual_minutes,
    overtime_minutes = v_ot_minutes,
    version = version + 1
  WHERE id = p_assignment_id;

  -- ========================================
  -- STEP 6: UPDATE OLD DEALER STATE
  -- ========================================

  IF p_send_to_break THEN
    PERFORM set_config(
      'app.state_reason',
      format('swing_to_break_ot_%s_break_%s', v_ot_minutes, v_comp_break),
      true
    );

    UPDATE dealer_attendance
    SET
      current_state = 'on_break',
      break_count = break_count + 1,
      priority_break_flag = FALSE,
      updated_at = NOW()
    WHERE id = v_old_attendance_id;

    INSERT INTO dealer_breaks (
      id, attendance_id, dealer_id, club_id, shift_id,
      started_at, duration_minutes, is_compensatory, overtime_minutes_earned
    ) VALUES (
      gen_random_uuid(), v_old_attendance_id, v_old_dealer_id, v_club_id, v_shift_id,
      NOW(), v_comp_break, v_ot_minutes > 0, v_ot_minutes
    );

    v_outcome := 'swung_to_break';
    v_message := format(
      'Dealer %s swung off table %s, break %s min (OT: %s min)',
      v_old_dealer_id, v_table_id, v_comp_break, v_ot_minutes
    );
  ELSE
    PERFORM set_config(
      'app.state_reason',
      format('swing_to_pool_ot_%s', v_ot_minutes),
      true
    );

    UPDATE dealer_attendance
    SET
      current_state = 'available',
      worked_minutes_since_last_break = 0,
      priority_break_flag = FALSE,
      updated_at = NOW()
    WHERE id = v_old_attendance_id;

    v_outcome := 'swung_to_pool';
    v_message := format(
      'Dealer %s returned to pool (OT: %s min)',
      v_old_dealer_id, v_ot_minutes
    );
  END IF;

  -- Accumulate OT for both branches
  UPDATE dealer_attendance
  SET
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    updated_at = NOW()
  WHERE id = v_old_attendance_id;

  -- ========================================
  -- STEP 7: CREATE NEW ASSIGNMENT
  -- ========================================

  v_new_assignment_id := gen_random_uuid();

  INSERT INTO dealer_assignments (
    id, club_id, shift_id, table_id, dealer_id, attendance_id,
    status, started_at, version, expected_duration_minutes, created_at
  ) VALUES (
    v_new_assignment_id, v_club_id, v_shift_id, v_table_id,
    v_next_dealer_id, v_next_attendance_id,
    'active', NOW(), 1, p_duration_minutes, NOW()
  );

  -- ========================================
  -- STEP 8: UPDATE NEW DEALER STATE
  -- ========================================

  PERFORM set_config(
    'app.state_reason',
    format('swing_assign_new_dealer_table_%s_%s',
      v_table_id,
      CASE WHEN v_next_dealer_was_pre_assigned THEN 'pre_assigned' ELSE 'from_pool' END
    ),
    true
  );

  UPDATE dealer_attendance
  SET
    current_state = 'assigned',
    current_table_id = v_table_id,
    pre_assigned_table_id = NULL,
    pre_assigned_at = NULL,
    updated_at = NOW()
  WHERE id = v_next_attendance_id;

  -- ========================================
  -- STEP 9: CLEAR PRE-ASSIGNMENT LINK
  -- ========================================

  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = NULL,
    pre_assigned_at = NULL
  WHERE id = p_assignment_id;

  -- ========================================
  -- STEP 10: RETURN SUCCESS
  -- ========================================

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'message', v_message,
    'old_assignment_id', p_assignment_id,
    'new_assignment_id', v_new_assignment_id,
    'old_dealer_id', v_old_dealer_id,
    'new_dealer_id', v_next_dealer_id,
    'table_id', v_table_id,
    'overtime_minutes', v_ot_minutes,
    'break_duration', CASE WHEN p_send_to_break THEN v_comp_break ELSE NULL END,
    'was_priority_break', v_was_priority_break,
    'actual_duration', v_actual_minutes,
    'version', v_actual_version + 1
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'outcome', 'error',
      'message', SQLERRM,
      'error_code', SQLSTATE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT) TO service_role;

COMMENT ON FUNCTION public.perform_swing IS
  'Complete swing RPC with app.state_reason context for every state transition. '
  'Handles dealer lock, OT calc, compensatory break, next-dealer pick, and audit.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'perform_swing'
  ), 'perform_swing function missing';
  RAISE NOTICE '✓ perform_swing updated with app.state_reason context';
END;
$$;

COMMIT;
