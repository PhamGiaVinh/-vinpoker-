-- Live snapshot 2026-06-12 09:37 before idle-dealer fix. OID 257642.
CREATE OR REPLACE FUNCTION public.perform_swing(p_assignment_id uuid, p_next_attendance_id uuid, p_send_to_break boolean DEFAULT false, p_break_duration_minutes integer DEFAULT NULL::integer, p_reason text DEFAULT 'auto_swing'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment RECORD;
  v_table_id UUID;
  v_club_id UUID;
  v_old_attendance_id UUID;
  v_old_dealer_id UUID;
  v_old_dealer_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_actual_worked_min INT := 0;
  v_ot_minutes INT := 0;
  v_comp_break INT;
  v_swing_duration_min INT := 45;
  v_next_swing_due_at TIMESTAMPTZ;
  v_next_assignment_id UUID;
BEGIN
  SELECT a.id, a.table_id, a.club_id, a.attendance_id,
      a.dealer_id, a.duration_minutes, a.overtime_started_at,
      da.dealers->>'full_name' AS dealer_name
  INTO v_assignment
  FROM dealer_assignments a
  JOIN dealer_attendance da ON da.id = a.attendance_id
  WHERE a.id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assignment_not_found');
  END IF;

  v_table_id := v_assignment.table_id;
  v_club_id := v_assignment.club_id;
  v_old_attendance_id := v_assignment.attendance_id;
  v_old_dealer_id := v_assignment.dealer_id;
  v_old_dealer_name := v_assignment.dealer_name;

  v_actual_worked_min := COALESCE(
    EXTRACT(EPOCH FROM (v_now - v_assignment.assigned_at)) / 60, 0
  )::INT;

  IF v_assignment.overtime_started_at IS NOT NULL THEN
    v_ot_minutes := COALESCE(
      EXTRACT(EPOCH FROM (v_now - v_assignment.overtime_started_at)) / 60, 0
    )::INT;
  END IF;

  UPDATE dealer_assignments
  SET status = 'completed',
    released_at = v_now,
    swing_processed_at = v_now,
    overtime_started_at = NULL,
    updated_at = v_now
  WHERE id = p_assignment_id;

  UPDATE dealer_attendance
  SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag = false,
    total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    last_released_at = v_now,
    pool_entered_at = v_now,
    updated_at = v_now
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  SELECT COALESCE(swing_duration_minutes, 45),
    COALESCE(min_duration_minutes, 20),
    COALESCE(max_duration_minutes, 60),
    COALESCE(base_duration_minutes, 30),
    COALESCE(auto_adjust_duration, false),
    COALESCE(target_ratio::NUMERIC, 1.2)
  INTO v_swing_duration_min, v_comp_break, v_comp_break, v_comp_break, v_comp_break, v_comp_break
  FROM swing_config
  WHERE club_id = v_club_id AND table_type = 'tournament'
  LIMIT 1;

  v_swing_duration_min := COALESCE(v_swing_duration_min, 45);
  v_next_swing_due_at := v_now + (v_swing_duration_min || ' minutes')::INTERVAL;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id,
    v_table_id,
    v_club_id,
    'assigned',
    v_now,
    1,
    v_next_swing_due_at
  ) RETURNING id INTO v_next_assignment_id;

  UPDATE dealer_attendance
  SET current_state = 'assigned',
    updated_at = v_now
  WHERE id = p_next_attendance_id;

  RETURN jsonb_build_object(
    'ok', true,
    'old_attendance_id', v_old_attendance_id,
    'new_assignment_id', v_next_assignment_id,
    'worked_minutes', v_actual_worked_min,
    'ot_minutes', v_ot_minutes,
    'sent_to_break', p_send_to_break
  );
END;
$function$

