-- ═══════════════════════════════════════════════════════════════════════════════
--  Fix perform_swing RPC: create missing unique index, fix ON CONFLICT syntax
--  ═══════════════════════════════════════════════════════════════════════════════
--  Root cause: idx_unique_active_attendance was created as a UNIQUE INDEX
--  (not a CONSTRAINT), so ON CONFLICT ON CONSTRAINT idx_unique_active_attendance
--  failed with "constraint does not exist". Also the index itself may not have
--  been created (migration may not have been applied).
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create the partial unique index if missing (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_attendance
  ON dealer_assignments(attendance_id) WHERE status = 'assigned';

-- 2. Fix perform_swing RPC to use ON CONFLICT (attendance_id) WHERE status = 'assigned'
--    instead of ON CONFLICT ON CONSTRAINT idx_unique_active_attendance
CREATE OR REPLACE FUNCTION perform_swing(
  p_assignment_id UUID,
  p_version INT,
  p_next_attendance_id UUID DEFAULT NULL,
  p_send_to_break BOOLEAN DEFAULT FALSE,
  p_break_duration_minutes INT DEFAULT NULL,
  p_swing_duration_minutes INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_attendance_id  UUID;
  v_table_id           UUID;
  v_club_id            UUID;
  v_current_version    INT;
  v_retry_count        INT;
  v_new_assignment_id  UUID;
  v_now                TIMESTAMPTZ := NOW();
BEGIN
  SELECT
    da.attendance_id, da.table_id, da.version,
    COALESCE(da.swing_retry_count, 0), gt.club_id
  INTO v_old_attendance_id, v_table_id, v_current_version, v_retry_count, v_club_id
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.swing_processed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'race_lost'); END IF;
  IF v_current_version != p_version THEN RETURN jsonb_build_object('outcome', 'race_lost'); END IF;

  IF p_next_attendance_id IS NULL THEN
    IF v_retry_count >= 3 THEN
      UPDATE dealer_assignments SET status = 'swing_skipped', swing_processed_at = v_now, version = version + 1 WHERE id = p_assignment_id;
      INSERT INTO swing_audit_logs (club_id, table_id, action, details, triggered_by)
      VALUES (v_club_id, v_table_id, 'swing_skipped_no_dealer', jsonb_build_object('assignment_id', p_assignment_id, 'retry_count', v_retry_count), 'system');
      RETURN jsonb_build_object('outcome', 'swing_skipped', 'retry_count', v_retry_count);
    END IF;
    UPDATE dealer_assignments SET swing_retry_count = v_retry_count + 1, last_swing_attempted_at = v_now, swing_due_at = v_now + INTERVAL '90 seconds', version = version + 1 WHERE id = p_assignment_id;
    RETURN jsonb_build_object('outcome', 'no_dealer', 'retry_count', v_retry_count + 1);
  END IF;

  UPDATE dealer_assignments SET status = 'completed', swing_processed_at = v_now, released_at = v_now, version = version + 1 WHERE id = p_assignment_id;

  IF p_send_to_break THEN
    UPDATE dealer_attendance SET current_state = 'on_break', priority_break_flag = false WHERE id = v_old_attendance_id;
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes)
    VALUES (p_assignment_id, v_now, p_break_duration_minutes);
  ELSE
    UPDATE dealer_attendance SET current_state = 'available' WHERE id = v_old_attendance_id;
  END IF;

  INSERT INTO dealer_assignments (attendance_id, table_id, status, assigned_at, swing_due_at, version)
  VALUES (p_next_attendance_id, v_table_id, 'assigned', v_now, v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL, 1)
  ON CONFLICT (attendance_id) WHERE status = 'assigned' DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments SET status = 'assigned', swing_processed_at = NULL, released_at = NULL, version = p_version WHERE id = p_assignment_id;
    UPDATE dealer_attendance SET current_state = 'assigned' WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  UPDATE dealer_attendance SET current_state = 'assigned' WHERE id = p_next_attendance_id;
  INSERT INTO swing_audit_logs (club_id, table_id, action, details, triggered_by)
  VALUES (v_club_id, v_table_id, 'swing_executed', jsonb_build_object('old_assignment_id', p_assignment_id, 'new_assignment_id', v_new_assignment_id, 'sent_to_break', p_send_to_break), 'system');

  RETURN jsonb_build_object('outcome', 'swung', 'new_assignment_id', v_new_assignment_id, 'old_dealer_on_break', p_send_to_break);
END;
$$;

GRANT EXECUTE ON FUNCTION perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT) TO service_role;
