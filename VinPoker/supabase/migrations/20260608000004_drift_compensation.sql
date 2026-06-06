-- ════════════════════════════════════════════════════════════════════════════
-- Migration 20260608000004_drift_compensation.sql
-- Hardening: time drift compensation
--   Issue 4: next swing_due_at compensates for previous OT.
--   Formula: compensated = NOW + (base - OT/2), floor at NOW + 20min.
--   Applied in both execute_pre_assigned_swing and perform_swing.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Helper: compute compensated next swing_due_at
CREATE OR REPLACE FUNCTION public.compute_compensated_swing_due_at(
  p_now           TIMESTAMPTZ,
  p_base_duration INT,  -- minutes (e.g., 30)
  p_ot_minutes    INT   -- OT to compensate (half subtracted)
) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT GREATEST(
    p_now + ((p_base_duration - (p_ot_minutes / 2)) || ' minutes')::INTERVAL,
    p_now + INTERVAL '20 minutes'
  );
$$;

COMMENT ON FUNCTION public.compute_compensated_swing_due_at(timestamptz, integer, integer)
  IS 'Time drift compensation: next swing = NOW + (base - OT/2) min, floor 20 min. '
     || 'E.g., OT=10, base=30 → NOW + 25min. OT=30 → NOW + 20min (floor).';

-- 2. Update execute_pre_assigned_swing with compensation
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id     uuid,
  p_next_attendance_id    uuid,
  p_swing_due_at          timestamp with time zone,
  p_duration_minutes      integer,
  p_send_to_break         boolean,
  p_break_duration_minutes integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_pre_assigned_at   TIMESTAMPTZ;
  v_pre_announce_min  INT;
  v_short_notice_bonus INT;
  v_compensated_due_at TIMESTAMPTZ;
BEGIN
  RAISE DEBUG '[execute_pre_assigned_swing] invoked: p_next=% p_old_assign=%',
    p_next_attendance_id, p_old_assignment_id;

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

  SELECT gt.club_id, da.table_id, da.attendance_id, da.overtime_started_at, da.pre_assigned_at
  INTO v_club_id, v_table_id, v_old_attendance_id, v_overtime_started, v_pre_assigned_at
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_old_assignment_id AND da.status = 'assigned';

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED', 'detail', p_old_assignment_id);
  END IF;

  SELECT COALESCE(pre_announce_minutes, 5) INTO v_pre_announce_min
  FROM swing_config WHERE club_id = v_club_id LIMIT 1;

  v_short_notice_bonus := public.compute_short_notice_bonus_min(
    v_pre_assigned_at, p_swing_due_at, v_pre_announce_min
  );

  SELECT d.full_name INTO v_incoming_name
  FROM dealer_attendance datt JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  UPDATE dealer_attendance
  SET current_state = 'assigned', pre_assigned_table_id = NULL, pre_assigned_at = NULL
  WHERE id = p_next_attendance_id AND current_state = 'pre_assigned' AND status = 'checked_in';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
    WHERE id = p_old_assignment_id;
    UPDATE dealer_attendance
    SET current_state = 'available', pre_assigned_table_id = NULL, pre_assigned_at = NULL
    WHERE id = p_next_attendance_id AND current_state = 'pre_assigned';
    RETURN jsonb_build_object('status', 'race_lost', 'detail', 'Dealer ' || p_next_attendance_id || ' no longer pre_assigned or checked out', 'incoming_name', COALESCE(v_incoming_name, 'Unknown'));
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

  -- Compute compensated next swing_due_at (Issue 4)
  v_compensated_due_at := public.compute_compensated_swing_due_at(
    v_now, p_duration_minutes, v_ot_minutes
  );

  -- Log compensation if any OT
  IF v_ot_minutes > 0 THEN
    INSERT INTO diagnostic_logs (club_id, diagnostic_type, result, metadata)
    VALUES (
      v_club_id, 'drift_compensation_applied',
      jsonb_build_object(
        'ot_minutes', v_ot_minutes,
        'compensation_minutes', v_ot_minutes / 2,
        'original_due_at', p_swing_due_at,
        'compensated_due_at', v_compensated_due_at
      ),
      jsonb_build_object(
        'old_assignment_id', p_old_assignment_id,
        'next_attendance_id', p_next_attendance_id
      )
    );
  END IF;

  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db JOIN dealer_assignments da2 ON da2.id = db.assignment_id
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
  SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
      worked_minutes_since_last_break = 0,
      overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes + v_short_notice_bonus,
      priority_break_flag = false,
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at, idempotency_key
  ) VALUES (
    p_next_attendance_id, v_table_id, v_club_id, 'assigned', v_now, 1, v_compensated_due_at,
    'pre_assign_' || p_old_assignment_id
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET status = 'assigned', swing_processed_at = NULL, overtime_started_at = v_overtime_started, updated_at = v_now
    WHERE id = p_old_assignment_id;
    UPDATE dealer_attendance
    SET current_state = 'assigned',
        overtime_minutes = COALESCE(overtime_minutes, 0) - v_ot_minutes - v_short_notice_bonus,
        priority_break_flag = true,
        worked_minutes_since_last_break = 0,
        total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
    WHERE id = v_old_attendance_id;
    UPDATE dealer_attendance
    SET current_state = 'available', pre_assigned_table_id = NULL, pre_assigned_at = NULL
    WHERE id = p_next_attendance_id;
    RETURN jsonb_build_object('status', 'race_lost', 'detail', 'New dealer ' || p_next_attendance_id || ' was already assigned elsewhere', 'incoming_name', COALESCE(v_incoming_name, 'Unknown'), 'rollback', true);
  END IF;

  UPDATE dealer_attendance
  SET current_state = 'assigned', pre_assigned_table_id = NULL, pre_assigned_at = NULL,
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = p_next_attendance_id;

  INSERT INTO swing_log (assignment_id, outcome, club_id, table_id, triggered_by, metadata)
  VALUES (
    p_old_assignment_id, 'swung', v_club_id, v_table_id, 'system',
    jsonb_build_object(
      'type', 'pre_assigned_swing',
      'new_assignment_id', v_new_assignment_id,
      'incoming_attendance_id', p_next_attendance_id,
      'outgoing_attendance_id', v_old_attendance_id,
      'incoming_name', v_incoming_name,
      'ot_minutes', v_ot_minutes,
      'short_notice_bonus_min', v_short_notice_bonus,
      'pre_assigned_at', v_pre_assigned_at,
      'swing_due_at', p_swing_due_at,
      'pre_announce_min', v_pre_announce_min,
      'comp_break_minutes', v_comp_break,
      'old_dealer_on_break', p_send_to_break,
      'compensated_swing_due_at', v_compensated_due_at
    ));

  RETURN jsonb_build_object(
    'status', 'success',
    'new_assignment_id', v_new_assignment_id,
    'incoming_name', v_incoming_name,
    'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes', v_comp_break,
    'ot_minutes', v_ot_minutes,
    'short_notice_bonus_min', v_short_notice_bonus,
    'compensated_swing_due_at', v_compensated_due_at
  );
END;
$function$;

-- 3. Update perform_swing 7-param core with compensation
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id uuid,
  p_version integer,
  p_next_attendance_id uuid,
  p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT NULL::integer,
  p_swing_duration_minutes integer DEFAULT 90,
  p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_next_dealer_state  TEXT;
  v_compensated_due_at TIMESTAMPTZ;
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

  SELECT current_state INTO v_next_dealer_state
  FROM dealer_attendance
  WHERE id = p_next_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_dealer', 'message', 'Next dealer not found');
  END IF;

  IF v_next_dealer_state = 'on_break' THEN
    UPDATE dealer_breaks
    SET break_end = v_now
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = p_next_attendance_id
        AND status = 'completed'
      ORDER BY released_at DESC NULLS LAST
      LIMIT 1
    )
    AND break_end IS NULL;

    UPDATE dealer_breaks
    SET break_end = v_now
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = p_next_attendance_id
    )
    AND break_end IS NULL;
  END IF;

  v_base_break := COALESCE(p_break_duration_minutes, 15);
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60);
    v_comp_break := LEAST(v_base_break + (v_ot_minutes / 2), GREATEST(v_base_break * 2, 30));
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  -- Compute compensated next swing_due_at (Issue 4)
  v_compensated_due_at := public.compute_compensated_swing_due_at(
    v_now, p_swing_duration_minutes, v_ot_minutes
  );

  -- Log compensation if any OT
  IF v_ot_minutes > 0 THEN
    INSERT INTO diagnostic_logs (club_id, diagnostic_type, result, metadata)
    VALUES (
      v_club_id, 'drift_compensation_applied',
      jsonb_build_object(
        'ot_minutes', v_ot_minutes,
        'compensation_minutes', v_ot_minutes / 2,
        'compensated_due_at', v_compensated_due_at
      ),
      jsonb_build_object(
        'assignment_id', p_assignment_id,
        'next_attendance_id', p_next_attendance_id
      )
    );
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
    p_next_attendance_id, v_table_id, v_club_id, 'assigned', v_now, 1, v_compensated_due_at
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
  WHERE id = p_next_attendance_id;

  RETURN jsonb_build_object('outcome', 'swung', 'new_assignment_id', v_new_assignment_id,
    'ot_minutes', v_ot_minutes, 'comp_break_minutes', v_comp_break,
    'old_dealer_on_break', p_send_to_break,
    'next_dealer_was_on_break', (v_next_dealer_state = 'on_break'),
    'compensated_swing_due_at', v_compensated_due_at);
END;
$function$;
