-- Live snapshot 2026-06-12 09:37 before idle-dealer fix. OID 199042.
CREATE OR REPLACE FUNCTION public.perform_swing(p_assignment_id uuid, p_duration_minutes integer DEFAULT 30, p_send_to_break boolean DEFAULT false, p_break_duration_minutes integer DEFAULT 15, p_max_break_minutes integer DEFAULT 60, p_expected_version integer DEFAULT NULL::integer, p_next_attendance_id uuid DEFAULT NULL::uuid, p_rest_deficit_minutes integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_next_dealer_state  TEXT;
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

  IF p_next_attendance_id IS NOT NULL THEN
    SELECT dat.id, dat.current_state
    INTO   v_next_attendance_id, v_next_dealer_state
    FROM dealer_attendance dat
    WHERE dat.id = p_next_attendance_id
      AND dat.status = 'checked_in'
      AND dat.check_in_time IS NOT NULL
      AND dat.check_out_time IS NULL
      AND (
        dat.current_state = 'available'
        OR dat.current_state = 'on_break'
        OR dat.current_state = 'pre_assigned'
      )
    FOR UPDATE OF dat;

    IF NOT FOUND THEN
      v_next_attendance_id := NULL;
    END IF;
  END IF;

  IF v_next_attendance_id IS NULL AND v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id AND dat.current_state = 'pre_assigned'
    FOR UPDATE OF dat;
    IF NOT FOUND THEN v_next_attendance_id := NULL;
    END IF;
  END IF;

  IF v_next_attendance_id IS NULL THEN
    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    INNER JOIN dealers d ON d.id = dat.dealer_id
    LEFT JOIN dealer_shift_metrics dsm ON dsm.attendance_id = dat.id
    WHERE d.club_id = v_club_id
      AND dat.id != v_old_attendance_id
      AND (dat.shift_id = v_shift_id OR dat.shift_id IS NULL)
      AND (
        dat.current_state = 'available'
        OR (dat.current_state = 'on_break' AND COALESCE(dsm.minutes_since_rest, 0) >= 10)
      )
      AND dat.status = 'checked_in'
      AND dat.check_in_time IS NOT NULL
      AND dat.check_out_time IS NULL
    ORDER BY
      CASE WHEN dat.current_state = 'available' THEN 0 ELSE 1 END,
      dat.shift_id IS NULL,
      dat.priority_break_flag ASC,
      COALESCE(dsm.worked_minutes_since_last_break, 0) ASC,
      RANDOM()
    LIMIT 1
    FOR UPDATE OF dat SKIP LOCKED;

    IF NOT FOUND THEN
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

  SELECT current_state INTO v_next_dealer_state
  FROM dealer_attendance WHERE id = v_next_attendance_id;

  IF v_next_dealer_state = 'on_break' THEN
    UPDATE dealer_breaks
    SET break_end = NOW()
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = v_next_attendance_id
        AND status = 'completed'
      ORDER BY released_at DESC NULLS LAST
      LIMIT 1
    )
    AND break_end IS NULL;

    UPDATE dealer_breaks
    SET break_end = NOW()
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = v_next_attendance_id
    )
    AND break_end IS NULL;
  END IF;

  SELECT public.perform_swing(
    p_assignment_id        := p_assignment_id,
    p_version              := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id   := v_next_attendance_id,
    p_send_to_break        := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes  := p_duration_minutes,
    p_swing_due_at         := NULL,
    p_rest_deficit_minutes := p_rest_deficit_minutes
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$function$

