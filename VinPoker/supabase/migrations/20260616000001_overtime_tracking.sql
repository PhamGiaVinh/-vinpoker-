-- 20260616000001_overtime_tracking.sql
-- Adds overtime tracking columns + updated perform_swing RPC
-- Handles 1:1 dealer-to-table ratio where no replacement is available at swing time

ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS overtime_started_at TIMESTAMPTZ;

ALTER TABLE dealer_attendance
  ADD COLUMN IF NOT EXISTS overtime_minutes INT NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT);

CREATE FUNCTION perform_swing(
  p_assignment_id          UUID,
  p_version                INT,
  p_next_attendance_id     UUID DEFAULT NULL,
  p_send_to_break          BOOLEAN DEFAULT FALSE,
  p_break_duration_minutes INT DEFAULT NULL,
  p_swing_duration_minutes INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_attendance_id  UUID;
  v_table_id           UUID;
  v_club_id            UUID;
  v_current_version    INT;
  v_ot_started_at      TIMESTAMPTZ;   -- existing OT start, NULL if not in OT
  v_is_new_ot          BOOLEAN;
  v_new_assignment_id  UUID;
  v_ot_minutes         INT;
  v_comp_break         INT;
  v_now                TIMESTAMPTZ := NOW();
BEGIN
  -- Load + lock in one shot
  SELECT
    da.attendance_id,
    da.table_id,
    da.version,
    da.overtime_started_at,         -- NULL = not in OT yet
    gt.club_id
  INTO
    v_old_attendance_id,
    v_table_id,
    v_current_version,
    v_ot_started_at,
    v_club_id
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.swing_processed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  IF v_current_version != p_version THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  -- ── NO DEALER AVAILABLE: start or continue OT tracking ───────────────────
  IF p_next_attendance_id IS NULL THEN
    v_is_new_ot := (v_ot_started_at IS NULL);  -- true only first time

    -- INVARIANT: swing_due_at = NOW() + 55s so Pass 3 retries on next cron tick
    -- (not past — that would cause all OT tables to be processed repeatedly
    --  within the same tick before swing_due_at update commits)
    -- INVARIANT: overtime_started_at uses COALESCE — never overwritten once set
    -- INVARIANT: retry_count reset to 0 — OT is not an error, no give-up
    UPDATE dealer_assignments
    SET overtime_started_at     = COALESCE(overtime_started_at, v_now),
        swing_retry_count       = 0,
        last_swing_attempted_at = v_now,
        swing_due_at            = v_now + INTERVAL '55 seconds',
        version                 = version + 1
    WHERE id = p_assignment_id;

    -- Mark dealer as needing priority break — lowers score by -500 in scoring
    -- so any available dealer (including newly checked-in) is always preferred
    UPDATE dealer_attendance
    SET priority_break_flag = true
    WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object(
      'outcome',        'no_dealer',
      'is_new_overtime', v_is_new_ot,
      'overtime_started_at', COALESCE(v_ot_started_at, v_now)
    );
  END IF;

  -- ── DEALER FOUND: execute swing with compensatory break if OT ────────────

  -- Compute compensatory break duration
  -- INVARIANT: computed from overtime_started_at, NOT from dealer_attendance.overtime_minutes
  -- (enforceBreakBalance writes that column for display — reading it here would cause double-count)
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0,
      EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60
    );
    -- INVARIANT: hard cap at 60 minutes to prevent phantom on_break records
    -- when OT break extends past shift end
    v_comp_break := LEAST(
      p_break_duration_minutes + (v_ot_minutes / 2),  -- standard + 50% OT
      60
    );
  ELSE
    v_ot_minutes := 0;
    v_comp_break := p_break_duration_minutes;
  END IF;

  -- Release old assignment
  UPDATE dealer_assignments
  SET status             = 'completed',
      swing_processed_at = v_now,
      released_at        = v_now,
      overtime_started_at = NULL,    -- clear OT tracking
      version            = version + 1
  WHERE id = p_assignment_id;

  -- Update old dealer: record accumulated OT + clear priority flag
  -- INVARIANT: accumulate (+=), not overwrite, because dealer may have had
  -- prior OT sessions earlier in the shift
  UPDATE dealer_attendance
  SET overtime_minutes    = overtime_minutes + v_ot_minutes,
      priority_break_flag = false
  WHERE id = v_old_attendance_id;

  -- Send old dealer to break (compensatory if OT, standard otherwise)
  -- INVARIANT: p_send_to_break is forced true by process-swing when OT dealer
  -- is being relieved — do not rely on evaluateBreakNeed for OT path
  IF p_send_to_break THEN
    UPDATE dealer_attendance
    SET current_state = 'on_break'
    WHERE id = v_old_attendance_id;

    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes)
    VALUES (p_assignment_id, v_now, v_comp_break);
  ELSE
    UPDATE dealer_attendance
    SET current_state = 'available'
    WHERE id = v_old_attendance_id;
  END IF;

  -- Assign new dealer
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status,
    assigned_at, swing_due_at, version
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned',
    v_now,
    v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL,
    1
  )
  ON CONFLICT ON CONSTRAINT idx_unique_active_attendance DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  -- Concurrent assignment conflict: rollback
  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET status = 'assigned', swing_processed_at = NULL,
        released_at = NULL, overtime_started_at = v_ot_started_at,
        version = p_version
    WHERE id = p_assignment_id;
    UPDATE dealer_attendance
    SET current_state = 'assigned', priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes)
    WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_next_attendance_id;

  INSERT INTO swing_audit_logs (club_id, table_id, action, details, triggered_by)
  VALUES (v_club_id, v_table_id, 'swing_executed',
    jsonb_build_object(
      'ot_minutes', v_ot_minutes,
      'comp_break_minutes', v_comp_break,
      'was_overtime', v_ot_started_at IS NOT NULL
    ), 'system');

  RETURN jsonb_build_object(
    'outcome',             'swung',
    'new_assignment_id',   v_new_assignment_id,
    'ot_minutes',          v_ot_minutes,
    'comp_break_minutes',  v_comp_break,
    'old_dealer_on_break', p_send_to_break
  );
END;
$$;

GRANT EXECUTE ON FUNCTION perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT)
  TO service_role;
