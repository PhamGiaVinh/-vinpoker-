-- ════════════════════════════════════════════════════════════════════════════
-- Migration 20260608000003_swing_in_progress.sql
-- Hardening: prevent duplicate swing execution + FOR UPDATE NOWAIT
--   Issue 2: Add swing_in_progress flag (Pass 3 optimistic lock)
--   Issue 1: FOR UPDATE NOWAIT in pre_assign_next_dealer_for_table
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Add swing_in_progress flag (defense-in-depth alongside FOR UPDATE)
ALTER TABLE dealer_assignments
ADD COLUMN IF NOT EXISTS swing_in_progress BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN dealer_assignments.swing_in_progress IS
  'Set TRUE while Pass 3 is processing a swing. Prevents duplicate execution '
  || 'if cron fires twice or RPC retries. Reset in finally block.';

-- 2. Partial index for fast Pass 3 query (swing_in_progress = false is hot path)
CREATE INDEX IF NOT EXISTS idx_assignments_pending_swing
  ON dealer_assignments (swing_due_at)
  WHERE status = 'assigned' AND swing_in_progress = FALSE;

-- 3. Update pre_assign_next_dealer_for_table: FOR UPDATE NOWAIT
--    Replace STEP 2's FOR UPDATE with FOR UPDATE NOWAIT to fail-fast
--    on contention. Reduces lock wait when 2 passes race for same dealer.
CREATE OR REPLACE FUNCTION public.pre_assign_next_dealer_for_table(
  p_assignment_id     uuid,
  p_club_id           uuid,
  p_next_attendance_id uuid,
  p_version           integer
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_assignment_version  INT;
  v_dealer_id           UUID;
  v_table_id            UUID;
  v_conflict_status     TEXT;
  v_conflict_table_id   UUID;
  v_current_rest_min    INT;
  v_min_rest_min        INT := 10;
  v_needed_delay_min    INT;
  v_original_due_at     TIMESTAMPTZ;
  v_effective_due_at    TIMESTAMPTZ;
BEGIN
  SELECT version, table_id, swing_due_at
  INTO v_assignment_version, v_table_id, v_original_due_at
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND status = 'assigned'
    AND released_at IS NULL
    AND swing_processed_at IS NULL
    AND pre_assigned_attendance_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost', 'detail', 'Assignment no longer active or already pre-assigned');
  END IF;

  IF v_assignment_version != p_version THEN
    RETURN jsonb_build_object('outcome', 'race_lost', 'detail', format('Version mismatch: expected %s, got %s', p_version, v_assignment_version));
  END IF;

  -- FOR UPDATE NOWAIT: fail-fast if another pass holds the lock
  PERFORM id FROM dealer_attendance
  WHERE id = p_next_attendance_id AND current_state = 'available' FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'dealer_unavailable', 'detail', 'Dealer not in available state or lock contention');
  END IF;

  SELECT dass.status, dass.table_id INTO v_conflict_status, v_conflict_table_id
  FROM dealer_assignments dass
  WHERE dass.attendance_id = p_next_attendance_id
    AND dass.status IN ('assigned', 'on_break', 'pre_assigned')
    AND dass.released_at IS NULL
    AND dass.table_id != v_table_id
  LIMIT 1;

  IF v_conflict_status IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'dealer_unavailable', 'detail', format('Dealer has active assignment at another table (status=%s, table=%s)', v_conflict_status, v_conflict_table_id::TEXT));
  END IF;

  SELECT dass.status, dass.table_id INTO v_conflict_status, v_conflict_table_id
  FROM dealer_assignments dass
  WHERE dass.pre_assigned_attendance_id = p_next_attendance_id
    AND dass.status IN ('assigned', 'on_break')
    AND dass.released_at IS NULL
    AND dass.table_id != v_table_id
  LIMIT 1;

  IF v_conflict_status IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'dealer_unavailable', 'detail', format('Dealer already pre-assigned to another table (status=%s, table=%s)', v_conflict_status, v_conflict_table_id::TEXT));
  END IF;

  WITH last_release AS (
    SELECT MAX(released_at) AS last_released_at
    FROM dealer_assignments
    WHERE attendance_id = p_next_attendance_id AND released_at IS NOT NULL
  )
  SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - lr.last_released_at))::INT / 60, 999)
  INTO v_current_rest_min
  FROM last_release lr;

  v_needed_delay_min := GREATEST(0, v_min_rest_min - v_current_rest_min);
  v_effective_due_at := v_original_due_at + (v_needed_delay_min || ' minutes')::INTERVAL;

  PERFORM set_config('app.state_reason', format('pass2_pre_assign_assignment_%s', p_assignment_id), true);

  UPDATE dealer_assignments
  SET pre_assigned_attendance_id = p_next_attendance_id,
      pre_assigned_at = NOW(),
      swing_due_at = v_effective_due_at,
      version = version + 1,
      updated_at = NOW()
  WHERE id = p_assignment_id AND version = p_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost', 'detail', 'CAS update failed on assignment');
  END IF;

  UPDATE dealer_attendance
  SET current_state = 'pre_assigned', pre_assigned_table_id = v_table_id, pre_assigned_at = NOW()
  WHERE id = p_next_attendance_id AND current_state = 'available';

  IF NOT FOUND THEN
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL,
        swing_due_at = v_original_due_at, version = p_version, updated_at = NOW()
    WHERE id = p_assignment_id;
    RETURN jsonb_build_object('outcome', 'dealer_unavailable', 'detail', 'Dealer state changed between lock and update');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'pre_assigned',
    'effective_swing_due_at', v_effective_due_at,
    'original_swing_due_at', v_original_due_at,
    'rest_deficit_min', v_needed_delay_min,
    'current_rest_min', v_current_rest_min
  );

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('outcome', 'dealer_unavailable', 'detail', 'Lock contention (NOWAIT)');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome', 'error', 'detail', SQLERRM);
END;
$function$;

COMMENT ON FUNCTION public.pre_assign_next_dealer_for_table(uuid, uuid, uuid, integer)
  IS 'Pre-assign next dealer for table with soft 10-min rest enforcement. '
     || 'Returns effective_swing_due_at delayed by rest_deficit_min. '
     || 'Uses FOR UPDATE NOWAIT in STEP 2 to fail-fast on lock contention.';
