-- =============================================================================
-- Migration: perform_swing (core 7-param overload) — RETRY
--
-- Context:
--   This is a re-application of 20260719000004. The first application may have
--   failed silently or had a transient issue. The end state is identical to
--   migration 000004, so the SQL is the same CREATE OR REPLACE statement.
--
--   Kept as a separate file to preserve the version history and audit trail
--   (the 000005 version is recorded in supabase_migrations.schema_migrations
--   for this retry).
--
-- See: 20260719000004_perform_swing_overload2_set_club_id.sql
-- =============================================================================

BEGIN;

-- Drop the specific 7-param overload (the one that takes p_swing_due_at)
DROP FUNCTION IF EXISTS public.perform_swing(
  UUID, INTEGER, UUID, BOOLEAN, INTEGER, INTEGER, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id          UUID,
  p_version                INTEGER,
  p_next_attendance_id     UUID,
  p_send_to_break          BOOLEAN,
  p_break_duration_minutes INTEGER,
  p_swing_duration_minutes INTEGER,
  p_swing_due_at           TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Lock + get club_id (Phase 1: required for new INSERT)
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

  -- OT path: no replacement dealer available
  IF p_next_attendance_id IS NULL THEN
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments SET overtime_started_at = v_now
      WHERE id = p_assignment_id;
      v_ot_started_at := v_now;
    END IF;
    UPDATE dealer_attendance SET priority_break_flag = true
    WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'no_dealer', 'is_new_overtime', v_is_new_ot,
      'overtime_started_at', v_ot_started_at);
  END IF;

  -- Compute compensatory break duration
  v_base_break := COALESCE(p_break_duration_minutes, 15);
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60);
    v_comp_break := LEAST(v_base_break + (v_ot_minutes / 2), GREATEST(v_base_break * 2, 30));
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  -- Release old assignment
  UPDATE dealer_assignments
  SET status = 'completed', version = version + 1, released_at = v_now,
      swing_processed_at = v_now, overtime_started_at = NULL
  WHERE id = p_assignment_id;

  -- Update old dealer OT minutes accumulation
  UPDATE dealer_attendance
  SET overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
      priority_break_flag = false
  WHERE id = v_old_attendance_id;

  -- Send old dealer to break or back to available
  IF p_send_to_break THEN
    UPDATE dealer_attendance
    SET current_state = 'on_break', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes)
    VALUES (p_assignment_id, v_now, v_comp_break);
  ELSE
    UPDATE dealer_attendance
    SET current_state = 'available', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;
  END IF;

  -- [8] Create new assignment WITH club_id (Phase 1)
  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id, v_table_id, v_club_id, 'assigned', v_now, 1, v_swing_due_at
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET status = 'assigned', version = version + 1, released_at = NULL,
        swing_processed_at = NULL
    WHERE id = p_assignment_id;
    UPDATE dealer_attendance
    SET current_state = 'assigned', priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes)
    WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  UPDATE dealer_attendance
  SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0)
  WHERE id = p_next_attendance_id;

  INSERT INTO swing_audit_logs (assignment_id, action, club_id, table_id, triggered_by, details)
  VALUES (p_assignment_id, 'swung', v_club_id, v_table_id, 'system',
    jsonb_build_object('new_assignment_id', v_new_assignment_id,
      'incoming_attendance_id', p_next_attendance_id,
      'outgoing_attendance_id', v_old_attendance_id,
      'ot_minutes', v_ot_minutes,
      'comp_break_minutes', v_comp_break,
      'was_overtime', v_ot_started_at IS NOT NULL,
      'swing_due_at', v_swing_due_at));

  RETURN jsonb_build_object('outcome', 'swung', 'new_assignment_id', v_new_assignment_id,
    'ot_minutes', v_ot_minutes, 'comp_break_minutes', v_comp_break,
    'old_dealer_on_break', p_send_to_break);
END;
$$;

COMMENT ON FUNCTION public.perform_swing(UUID, INTEGER, UUID, BOOLEAN, INTEGER, INTEGER, TIMESTAMPTZ) IS
  'Core 7-param swing engine. Phase 1: includes club_id in INSERT for NOT NULL compliance. (Retry of 20260719000004)';

COMMIT;
