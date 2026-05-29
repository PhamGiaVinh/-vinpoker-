-- =============================================
-- Atomic swing RPC — replaces manual DB mutations
-- Combines CAS lock + release + break + assign in one transaction
-- =============================================
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_old_assignment_id UUID,
  p_old_version INT,
  p_old_attendance_id UUID,
  p_new_attendance_id UUID,
  p_table_id UUID,
  p_club_id UUID,
  p_shift_id UUID,
  p_swing_reason TEXT,
  p_should_break BOOLEAN,
  p_break_reason TEXT,
  p_break_duration INT,
  p_new_dealer_id UUID,
  p_idempotency_key TEXT,
  p_triggered_by TEXT,
  p_table_name TEXT,
  p_old_dealer_name TEXT,
  p_new_dealer_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_dealer_id UUID;
  v_new_assignment_id UUID;
  v_result JSONB;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Get old dealer_id (informational, doesn't need CAS)
  SELECT da2.dealer_id INTO v_old_dealer_id
  FROM dealer_attendance da2
  WHERE da2.id = p_old_attendance_id;

  -- Atomic CAS: release + version bump in one UPDATE
  UPDATE dealer_assignments
  SET released_at = v_now,
      status = 'completed',
      swing_processed_at = v_now,
      version = version + 1,
      updated_at = v_now
  WHERE id = p_old_assignment_id
    AND version = p_old_version
    AND status = 'assigned'
    AND swing_processed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'race_lost');
  END IF;

  -- Set old attendance to available
  UPDATE dealer_attendance
  SET current_state = 'available'
  WHERE id = p_old_attendance_id;

  -- If break needed
  IF p_should_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason)
    VALUES (p_old_assignment_id, v_now, p_break_duration, p_break_reason);

    UPDATE dealer_attendance
    SET current_state = 'on_break', priority_break_flag = false
    WHERE id = p_old_attendance_id;
  END IF;

  -- Assign new dealer
  IF p_new_dealer_id IS NOT NULL AND p_new_attendance_id IS NOT NULL THEN
    INSERT INTO dealer_assignments (attendance_id, table_id, assigned_at, status, idempotency_key)
    VALUES (p_new_attendance_id, p_table_id, v_now, 'assigned', p_idempotency_key)
    RETURNING id INTO v_new_assignment_id;

    UPDATE dealer_attendance
    SET current_state = 'assigned'
    WHERE id = p_new_attendance_id;
  END IF;

  -- Audit log
  INSERT INTO swing_audit_logs (
    club_id, shift_id, assignment_id, old_dealer_id, new_dealer_id,
    table_id, action, details, triggered_by
  ) VALUES (
    p_club_id, p_shift_id, p_old_assignment_id, v_old_dealer_id,
    p_new_dealer_id, p_table_id,
    CASE WHEN p_new_dealer_id IS NOT NULL THEN 'swing_success' ELSE 'swing_no_dealer' END,
    jsonb_build_object(
      'table_name', p_table_name,
      'old_dealer_name', p_old_dealer_name,
      'new_dealer_name', p_new_dealer_name,
      'reason', p_swing_reason,
      'old_went_on_break', p_should_break,
      'break_reason', p_break_reason
    ),
    p_triggered_by
  );

  v_result := jsonb_build_object(
    'status', CASE WHEN p_new_dealer_id IS NOT NULL THEN 'swung' ELSE 'swung_no_dealer' END,
    'new_assignment_id', v_new_assignment_id,
    'old_dealer_on_break', p_should_break
  );

  RETURN v_result;
END;
$$;
