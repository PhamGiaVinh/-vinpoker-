-- Fix: transition_dealer_state và execute_pre_assigned_swing tính sai worked_minutes
-- bằng cách dùng check_in_time làm fallback → giá trị khổng lồ (4000+ phút).
-- Với compute-on-read, cột này deprecated. Set về 0 cho mọi state.

BEGIN;

-- 1. Reset toàn bộ worked_minutes_since_last_break về 0
UPDATE dealer_attendance
SET worked_minutes_since_last_break = 0;

-- 2. transition_dealer_state: bỏ logic tính từ check_in_time, set về 0
CREATE OR REPLACE FUNCTION public.transition_dealer_state(
  p_attendance_id UUID,
  p_new_state     TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_state TEXT;
  v_valid     BOOLEAN;
BEGIN
  SELECT current_state INTO v_old_state
  FROM dealer_attendance
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTENDANCE_NOT_FOUND');
  END IF;

  IF v_old_state = p_new_state THEN
    RETURN jsonb_build_object(
      'ok', true, 'from', v_old_state, 'to', p_new_state, 'noop', true
    );
  END IF;

  v_valid := CASE
    WHEN v_old_state = 'available'     AND p_new_state IN ('pre_assigned','assigned','in_transition','on_break','checked_out') THEN true
    WHEN v_old_state = 'pre_assigned'  AND p_new_state IN ('assigned','available','checked_out')                              THEN true
    WHEN v_old_state = 'assigned'      AND p_new_state IN ('on_break','in_transition','available','checked_out')              THEN true
    WHEN v_old_state = 'in_transition' AND p_new_state IN ('assigned','available','on_break','checked_out')                   THEN true
    WHEN v_old_state = 'on_break'      AND p_new_state IN ('available','in_transition','checked_out')                         THEN true
    WHEN v_old_state = 'swing_ready'   AND p_new_state IN ('in_transition','available','checked_out')                         THEN true
    ELSE false
  END;

  IF NOT v_valid THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'INVALID_TRANSITION', 'from', v_old_state, 'to', p_new_state
    );
  END IF;

  PERFORM set_config('app.state_reason', COALESCE(p_reason, 'transition_dealer_state'), true);

  UPDATE dealer_attendance
  SET
    current_state = p_new_state,
    worked_minutes_since_last_break = 0
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object('ok', true, 'from', v_old_state, 'to', p_new_state);
END;
$$;

-- 3. execute_pre_assigned_swing: bỏ logic tính từ check_in_time, set về 0
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id UUID,
  p_next_attendance_id UUID,
  p_swing_due_at TIMESTAMPTZ,
  p_duration_minutes INT DEFAULT 30,
  p_break_duration_minutes INT DEFAULT 15,
  p_send_to_break BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now               TIMESTAMPTZ := NOW();
  v_club_id           UUID;
  v_table_id          UUID;
  v_old_attendance_id UUID;
  v_new_assignment_id UUID;
  v_rows_updated      INT;
  v_actual_worked_min INT;
  v_last_break_end    TIMESTAMPTZ;
  v_check_in_time     TIMESTAMPTZ;
  v_incoming_name     TEXT;
  v_old_overtime_min  INT;
  v_ot_minutes        INT;
  v_overtime_started  TIMESTAMPTZ;
  v_comp_break        INT;
  v_base_break        INT;
BEGIN
  IF p_old_assignment_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_old_assignment_id is null');
  END IF;

  IF p_next_attendance_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_next_attendance_id is null');
  END IF;

  IF p_swing_due_at IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_swing_due_at is null');
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_duration_minutes must be > 0');
  END IF;

  SELECT gt.club_id, da.table_id, da.attendance_id, da.overtime_started_at
  INTO v_club_id, v_table_id, v_old_attendance_id, v_overtime_started
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_old_assignment_id AND da.status = 'assigned';

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'error', 'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED', 'detail', p_old_assignment_id
    );
  END IF;

  SELECT d.full_name INTO v_incoming_name
  FROM dealer_attendance datt
  JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_next_attendance_id
    AND current_state = 'pre_assigned'
    AND status = 'checked_in';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET current_state = 'available', pre_assigned_table_id = NULL, pre_assigned_at = NULL
    WHERE id = p_next_attendance_id AND current_state = 'pre_assigned';

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'Dealer ' || p_next_attendance_id || ' no longer pre_assigned or checked out',
      'incoming_name', COALESCE(v_incoming_name, 'Unknown')
    );
  END IF;

  v_base_break := COALESCE(p_break_duration_minutes, 15);

  IF v_overtime_started IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_overtime_started))::INT / 60);
    SELECT overtime_minutes INTO v_old_overtime_min FROM dealer_attendance WHERE id = v_old_attendance_id;
    v_comp_break := LEAST(v_base_break + (v_ot_minutes / 2), GREATEST(v_base_break * 2, 30));
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db
  JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time FROM dealer_attendance WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  UPDATE dealer_assignments
  SET status = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
      swing_processed_at = v_now, overtime_started_at = NULL, updated_at = v_now
  WHERE id = p_old_assignment_id;

  UPDATE dealer_attendance
  SET
    current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag = false,
    total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  INSERT INTO dealer_assignments (attendance_id, table_id, status, assigned_at, version, swing_due_at, idempotency_key)
  VALUES (p_next_attendance_id, v_table_id, 'assigned', v_now, 1, p_swing_due_at, 'pre_assign_' || p_old_assignment_id)
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET status = 'assigned', swing_processed_at = NULL, overtime_started_at = v_overtime_started, updated_at = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET current_state = 'assigned', overtime_minutes = COALESCE(overtime_minutes, 0) - v_ot_minutes,
        priority_break_flag = true, worked_minutes_since_last_break = 0,
        total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
    WHERE id = v_old_attendance_id;

    UPDATE dealer_attendance SET current_state = 'available' WHERE id = p_next_attendance_id;

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'New dealer ' || p_next_attendance_id || ' was already assigned elsewhere',
      'incoming_name', COALESCE(v_incoming_name, 'Unknown'), 'rollback', true
    );
  END IF;

  UPDATE dealer_attendance
  SET current_state = 'assigned', total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = p_next_attendance_id;

  INSERT INTO swing_log (assignment_id, outcome, club_id, table_id, triggered_by, metadata)
  VALUES (p_old_assignment_id, 'swung', v_club_id, v_table_id, 'system',
    jsonb_build_object('type', 'pre_assigned_swing', 'new_assignment_id', v_new_assignment_id,
      'incoming_attendance_id', p_next_attendance_id, 'outgoing_attendance_id', v_old_attendance_id,
      'incoming_name', v_incoming_name, 'ot_minutes', v_ot_minutes,
      'comp_break_minutes', v_comp_break, 'old_dealer_on_break', p_send_to_break));

  RETURN jsonb_build_object(
    'status', 'success', 'new_assignment_id', v_new_assignment_id,
    'incoming_name', v_incoming_name, 'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes', v_comp_break
  );
END;
$$;

COMMIT;
