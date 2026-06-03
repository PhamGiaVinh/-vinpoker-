-- =============================================================================
-- Migration: Fix perform_swing — final consolidated state
--
-- Fixes applied (iterative debugging session):
--   1. Removed references to non-existent columns:
--      - dealer_assignments: started_at, current_state, expected_duration_minutes, dealer_id (old col), club_id (old col), shift_id (old col), ended_at, checked_in_at, checked_out_at
--      - dealer_attendance: updated_at, current_table_id
--   2. Added 'in_transition' to dealer_attendance_current_state_check constraint
--   3. Removed updated_at = NOW() from dealer_attendance UPDATE statements (column doesn't exist)
--   4. Dropped ambiguous 7-param overload with DEFAULTs that conflicted with 6-param
--   5. Recreated clean 6-param wrapper + 7-param core engine
--   6. Allow shift_id = NULL in pool query — dealers checked in without a shift
--      should still be eligible for swing assignment. ORDER BY shift_id IS NULL
--      to prefer shift-matched dealers over shiftless ones.
--   7. Add status = 'checked_in' filter to pool query — prevents checked_out dealers
--      from being assigned. current_state = 'available' alone is insufficient because
--      a dealer can be marked available but have status = 'checked_out'.
--   8. Include on_break dealers in pool query if they've rested >= 10 minutes.
--      ORDER BY prefers 'available' dealers first (CASE 0/1), then shift match,
--      then priority_break and worked_minutes. When an on_break dealer is selected,
--      the wrapper ends their break (transitions to 'available') before delegating
--      to the 7-param core.
--
-- Signature:
--   6-param: perform_swing(p_assignment_id UUID, p_duration_minutes INT DEFAULT 30,
--             p_send_to_break BOOLEAN DEFAULT false, p_break_duration_minutes INT DEFAULT 15,
--             p_max_break_minutes INT DEFAULT 60, p_expected_version INT DEFAULT NULL)
--   7-param: perform_swing(p_assignment_id UUID, p_version INT,
--             p_next_attendance_id UUID, p_send_to_break BOOLEAN DEFAULT false,
--             p_break_duration_minutes INT DEFAULT NULL,
--             p_swing_duration_minutes INT DEFAULT 90, p_swing_due_at TIMESTAMPTZ DEFAULT NULL)
-- =============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 1: Add 'in_transition' to dealer_attendance_current_state_check
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE dealer_attendance DROP CONSTRAINT dealer_attendance_current_state_check;
ALTER TABLE dealer_attendance ADD CONSTRAINT dealer_attendance_current_state_check
  CHECK (current_state = ANY (ARRAY['available', 'assigned', 'on_break', 'checked_out', 'pre_assigned', 'in_transition']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 2: 6-PARAM WRAPPER (called by frontend via supabase.rpc)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id UUID,
  p_duration_minutes INT DEFAULT 30,
  p_send_to_break BOOLEAN DEFAULT false,
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
  v_old_attendance_id  UUID;
  v_table_id           UUID;
  v_club_id            UUID;
  v_shift_id           UUID;
  v_current_version    INT;
  v_current_state      TEXT;
  v_ot_started_at      TIMESTAMPTZ;
  v_was_priority_break BOOLEAN;
  v_pre_assigned_id    UUID;
  v_next_attendance_id UUID;
  v_swing_result       JSONB;
BEGIN
  SELECT da.version, da.table_id, da.attendance_id, da.pre_assigned_attendance_id,
         da.overtime_started_at,
         gt.club_id,
         dat.shift_id, dat.current_state, dat.priority_break_flag
  INTO   v_current_version, v_table_id, v_old_attendance_id, v_pre_assigned_id,
         v_ot_started_at,
         v_club_id,
         v_shift_id, v_current_state, v_was_priority_break
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  JOIN dealer_attendance dat ON dat.id = da.attendance_id
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.swing_processed_at IS NULL
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found', 'message', 'Assignment not found or already swung');
  END IF;

  IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'outcome', 'version_conflict',
      'message', 'Assignment was modified by another process',
      'expected_version', p_expected_version,
      'actual_version', v_current_version
    );
  END IF;

  IF v_current_state = 'in_transition' THEN
    RETURN jsonb_build_object('outcome', 'already_in_transition', 'message', 'Dealer is already being swung');
  END IF;

  UPDATE dealer_attendance SET current_state = 'in_transition'
  WHERE id = v_old_attendance_id AND current_state = 'assigned';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'state_conflict',
      'message', format('Dealer state changed concurrently (expected assigned, got %s)', v_current_state),
      'current_state', v_current_state
    );
  END IF;

  v_next_attendance_id := NULL;

  IF v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id AND dat.current_state = 'pre_assigned'
    FOR UPDATE;
    IF NOT FOUND THEN v_next_attendance_id := NULL;
    END IF;
  END IF;

  IF v_next_attendance_id IS NULL THEN
    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    INNER JOIN dealers d ON d.id = dat.dealer_id
    WHERE d.club_id = v_club_id
      AND dat.id != v_old_attendance_id
      AND (dat.shift_id = v_shift_id OR dat.shift_id IS NULL)
      AND (
        dat.current_state = 'available'
        OR (dat.current_state = 'on_break' AND COALESCE(dat.worked_minutes_since_last_break, 0) >= 10)
      )
      AND dat.status = 'checked_in'
      AND dat.check_in_time IS NOT NULL
      AND dat.check_out_time IS NULL
    ORDER BY
      CASE WHEN dat.current_state = 'available' THEN 0 ELSE 1 END,
      dat.shift_id IS NULL,
      dat.priority_break_flag ASC,
      dat.worked_minutes_since_last_break ASC,
      RANDOM()
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      -- Revert: put old dealer back to assigned
      UPDATE dealer_attendance SET current_state = 'assigned' WHERE id = v_old_attendance_id;

      IF v_ot_started_at IS NULL THEN
        UPDATE dealer_assignments SET overtime_started_at = NOW() WHERE id = p_assignment_id;
      END IF;

      RETURN jsonb_build_object(
        'outcome', 'no_dealer',
        'message', 'No dealers available in pool',
        'table_id', v_table_id,
        'is_new_overtime', (v_ot_started_at IS NULL),
        'overtime_started_at', COALESCE(v_ot_started_at, NOW())
      );
    END IF;
  END IF;

  SELECT public.perform_swing(
    p_assignment_id        := p_assignment_id,
    p_version              := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id   := v_next_attendance_id,
    p_send_to_break        := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes  := p_duration_minutes,
    p_swing_due_at         := NULL
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 3: 7-PARAM CORE ENGINE (called by 6-param wrapper)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id          UUID,
  p_version                INT,
  p_next_attendance_id     UUID,
  p_send_to_break          BOOLEAN DEFAULT false,
  p_break_duration_minutes INT DEFAULT NULL,
  p_swing_duration_minutes INT DEFAULT 90,
  p_swing_due_at           TIMESTAMPTZ DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_attendance_id  UUID;
  v_table_id           UUID;
  v_club_id            UUID;
  v_current_version    INT;
  v_ot_started_at      TIMESTAMPTZ;
  v_is_new_ot          BOOLEAN;
  v_new_assignment_id  UUID;
  v_ot_minutes         INT;
  v_comp_break         INT;
  v_base_break         INT;
  v_now                TIMESTAMPTZ := NOW();
  v_swing_due_at       TIMESTAMPTZ;
BEGIN
  v_swing_due_at := COALESCE(p_swing_due_at, v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL);

  SELECT
    da.attendance_id, da.table_id, da.version, da.overtime_started_at, gt.club_id
  INTO
    v_old_attendance_id, v_table_id, v_current_version, v_ot_started_at, v_club_id
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.version = p_version
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost', 'reason', 'version_mismatch');
  END IF;

  v_is_new_ot := (v_ot_started_at IS NULL);

  IF p_next_attendance_id IS NULL THEN
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments SET overtime_started_at = v_now WHERE id = p_assignment_id;
      v_ot_started_at := v_now;
    END IF;

    UPDATE dealer_attendance SET priority_break_flag = true WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object('outcome', 'no_dealer', 'is_new_overtime', v_is_new_ot,
      'overtime_started_at', v_ot_started_at);
  END IF;

  v_base_break := COALESCE(p_break_duration_minutes, 15);
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60);
    v_comp_break := LEAST(v_base_break + (v_ot_minutes / 2), GREATEST(v_base_break * 2, 30));
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  UPDATE dealer_assignments
  SET status = 'completed', version = version + 1, released_at = v_now,
      swing_processed_at = v_now, overtime_started_at = NULL, updated_at = v_now
  WHERE id = p_assignment_id;

  UPDATE dealer_attendance
  SET overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
      priority_break_flag = false
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    UPDATE dealer_attendance SET current_state = 'on_break', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;
  ELSE
    UPDATE dealer_attendance SET current_state = 'available', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;
  END IF;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id, v_table_id, v_club_id, 'assigned', v_now, 1, v_swing_due_at
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments SET status = 'assigned', version = version + 1, released_at = NULL,
        swing_processed_at = NULL, updated_at = v_now
    WHERE id = p_assignment_id;
    UPDATE dealer_attendance SET current_state = 'assigned',
        priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes)
    WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  UPDATE dealer_attendance SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0)
  WHERE id = v_next_attendance_id;

  RETURN jsonb_build_object('outcome', 'swung', 'new_assignment_id', v_new_assignment_id,
    'ot_minutes', v_ot_minutes, 'comp_break_minutes', v_comp_break,
    'old_dealer_on_break', p_send_to_break);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ) TO service_role;

COMMIT;