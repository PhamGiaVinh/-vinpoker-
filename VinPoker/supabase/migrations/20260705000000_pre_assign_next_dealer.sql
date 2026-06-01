-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: pre_assign_next_dealer_for_table — atomic pre-assignment
--
-- Picks best available dealer, locks them, sets state=pre_assigned,
-- links to the assignment — all in one transaction.
-- Uses app.state_reason for audit trail via trigger.
-- Rollback if assignment is no longer active.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.pre_assign_next_dealer_for_table(
  p_club_id UUID,
  p_shift_id UUID,
  p_assignment_id UUID,
  p_table_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dealer_attendance_id UUID;
  v_dealer_id UUID;
  v_dealer_name TEXT;
  v_current_state TEXT;
  v_priority_break BOOLEAN;
  v_reason TEXT;
BEGIN
  -- ========================================
  -- STEP 1: Pick best available dealer
  -- Scoring identical to perform_swing
  -- ========================================

  SELECT
    da.id,
    da.dealer_id,
    d.full_name,
    da.current_state,
    da.priority_break_flag
  INTO
    v_dealer_attendance_id,
    v_dealer_id,
    v_dealer_name,
    v_current_state,
    v_priority_break
  FROM dealer_attendance da
  INNER JOIN dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.shift_id = p_shift_id
    AND da.current_state = 'available'
    AND da.check_in_time IS NOT NULL
    AND da.check_out_time IS NULL
  ORDER BY
    da.priority_break_flag DESC,             -- Priority break first
    da.worked_minutes_since_last_break ASC,  -- Least worked
    RANDOM()                                 -- Tiebreaker
  LIMIT 1
  FOR UPDATE SKIP LOCKED;  -- Lock dealer atomically

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No available dealers'
    );
  END IF;

  -- ========================================
  -- STEP 2: Set session context for audit
  -- ========================================

  PERFORM set_config(
    'app.state_reason',
    format('pass2_pre_assign_table_%s', p_table_id),
    true
  );

  -- ========================================
  -- STEP 3: Update dealer state
  -- ========================================

  UPDATE dealer_attendance
  SET
    current_state = 'pre_assigned',
    pre_assigned_table_id = p_table_id,
    pre_assigned_at = NOW()
  WHERE id = v_dealer_attendance_id
    AND current_state = 'available';  -- Safety guard

  IF NOT FOUND THEN
    -- State changed between SELECT and UPDATE (race)
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Dealer %s state changed to %s', v_dealer_name, v_current_state)
    );
  END IF;

  -- ✅ Trigger fires: available → pre_assigned with reason

  -- ========================================
  -- STEP 4: Link to assignment
  -- ========================================

  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = v_dealer_attendance_id,
    pre_assigned_at = NOW(),
    updated_at = NOW()
  WHERE id = p_assignment_id
    AND status IN ('assigned', 'active')
    AND released_at IS NULL;

  IF NOT FOUND THEN
    -- Assignment no longer active — rollback dealer state
    PERFORM set_config(
      'app.state_reason',
      'pass2_rollback_assignment_ended',
      true
    );

    UPDATE dealer_attendance
    SET
      current_state = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
    WHERE id = v_dealer_attendance_id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Assignment no longer active'
    );
  END IF;

  -- ========================================
  -- STEP 5: Determine reason for audit
  -- ========================================

  IF v_priority_break THEN
    v_reason := 'Priority break dealer';
  ELSE
    v_reason := 'Least worked dealer';
  END IF;

  -- ========================================
  -- STEP 6: Return success
  -- ========================================

  RETURN jsonb_build_object(
    'ok', true,
    'dealer_id', v_dealer_id,
    'dealer_name', v_dealer_name,
    'attendance_id', v_dealer_attendance_id,
    'reason', v_reason,
    'was_priority_break', v_priority_break
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pre_assign_next_dealer_for_table(UUID, UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.pre_assign_next_dealer_for_table IS
  'Atomically picks and pre-assigns a dealer to a table. Handles rollback if assignment ended.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'pre_assign_next_dealer_for_table'
  ), 'pre_assign_next_dealer_for_table function missing';
  RAISE NOTICE '✓ pre_assign_next_dealer_for_table created';
END;
$$;

COMMIT;
