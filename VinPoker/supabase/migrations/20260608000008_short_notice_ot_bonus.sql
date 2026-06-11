-- ════════════════════════════════════════════════════════════════════════════
-- Migration 20260608000002_short_notice_ot_bonus.sql
-- Bàn 10 bug fix: short-notice OT bonus for outgoing dealer.
--   When swing executes with < pre_announce_min between pre_assigned_at
--   and swing_due_at, the OUTGOING dealer gets extra OT minutes
--   (capped at pre_announce_min). Applied to execute_pre_assigned_swing.
--   Pool path (perform_swing) is NOT changed: pool dealers always get
--   at least pre_announce_min notice via overtime_started_at + pass 3
--   schedule, so no short-notice scenario exists there.
--
-- Forward-only: bonus is added to overtime_minutes directly (no separate
-- column, no double-count). If logic is wrong, fix in next migration —
-- historical periods stay as-is.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════
-- 1. Index on swing_config for fast club lookup
-- ════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_swing_config_club_id
  ON swing_config (club_id);

-- ════════════════════════════════════════════════════════
-- 2. Helper function — NULL-safe short-notice bonus
-- ════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_short_notice_bonus_min(
  p_pre_assigned_at   TIMESTAMPTZ,
  p_swing_due_at      TIMESTAMPTZ,
  p_pre_announce_min  INT
) RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_pre_assigned_at IS NULL OR p_swing_due_at IS NULL THEN 0
    WHEN p_pre_announce_min IS NULL OR p_pre_announce_min <= 0 THEN 0
    ELSE LEAST(
      p_pre_announce_min,
      GREATEST(0,
        p_pre_announce_min
        - CEIL(EXTRACT(EPOCH FROM (p_swing_due_at - p_pre_assigned_at)) / 60)::INT
      )
    )
  END;
$$;

COMMENT ON FUNCTION public.compute_short_notice_bonus_min(timestamptz, timestamptz, integer)
  IS 'Bonus OT minutes for outgoing dealer when swing executes with short notice. '
     || 'Notice = swing_due_at - pre_assigned_at. Bonus = max(0, min(pre_announce_min, '
     || 'pre_announce_min - notice_min)). Returns 0 if any input is NULL.';

-- ════════════════════════════════════════════════════════
-- 3. Update execute_pre_assigned_swing (1 overload, OID 136187)
--    - Read pre_assigned_at from dealer_assignments row
--    - Read pre_announce_min from swing_config
--    - Compute bonus via helper
--    - Add bonus to outgoing dealer_attendance.overtime_minutes
--    - Include in swing_log metadata
--    - Include in return JSON
-- ════════════════════════════════════════════════════════
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

  SELECT
    gt.club_id,
    da.table_id,
    da.attendance_id,
    da.overtime_started_at,
    da.pre_assigned_at
  INTO
    v_club_id,
    v_table_id,
    v_old_attendance_id,
    v_overtime_started,
    v_pre_assigned_at
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_old_assignment_id
    AND da.status = 'assigned';

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error',  'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED',
      'detail', p_old_assignment_id
    );
  END IF;

  -- Read pre_announce_min from swing_config (with safe default 5)
  SELECT COALESCE(pre_announce_minutes, 5) INTO v_pre_announce_min
  FROM swing_config WHERE club_id = v_club_id LIMIT 1;

  -- Compute short-notice bonus (capped at pre_announce_min)
  v_short_notice_bonus := public.compute_short_notice_bonus_min(
    v_pre_assigned_at, p_swing_due_at, v_pre_announce_min
  );

  SELECT d.full_name
  INTO v_incoming_name
  FROM dealer_attendance datt
  JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  UPDATE dealer_attendance
  SET current_state = 'assigned',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
  WHERE id = p_next_attendance_id
    AND current_state = 'pre_assigned'
    AND status = 'checked_in';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    WHERE id = p_next_attendance_id
      AND current_state = 'pre_assigned';

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'Dealer ' || p_next_attendance_id || ' no longer pre_assigned or checked out',
      'incoming_name', COALESCE(v_incoming_name, 'Unknown')
    );
  END IF;

  v_base_break := COALESCE(p_break_duration_minutes, 15);

  IF v_overtime_started IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_overtime_started))::INT / 60);

    SELECT overtime_minutes INTO v_old_overtime_min
    FROM dealer_attendance WHERE id = v_old_attendance_id;

    v_comp_break := LEAST(
      v_base_break + (v_ot_minutes / 2),
      GREATEST(v_base_break * 2, 30)
    );
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db
  JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time
  FROM dealer_attendance WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  UPDATE dealer_assignments
  SET
    status              = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
    swing_processed_at  = v_now,
    overtime_started_at = NULL,
    updated_at          = v_now
  WHERE id = p_old_assignment_id;

  -- Outgoing dealer: add v_ot_minutes (regular OT) + v_short_notice_bonus (Bàn 10 fix)
  UPDATE dealer_attendance
  SET
    current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes + v_short_notice_bonus,
    priority_break_flag         = false,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at, idempotency_key
  ) VALUES (
    p_next_attendance_id,
    v_table_id,
    v_club_id,
    'assigned',
    v_now,
    1,
    p_swing_due_at,
    'pre_assign_' || p_old_assignment_id
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET status = 'assigned',
        swing_processed_at = NULL,
        overtime_started_at = v_overtime_started,
        updated_at = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET
      current_state = 'assigned',
      overtime_minutes = COALESCE(overtime_minutes, 0) - v_ot_minutes - v_short_notice_bonus,
      priority_break_flag = true,
      worked_minutes_since_last_break = 0,
      total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
    WHERE id = v_old_attendance_id;

    UPDATE dealer_attendance
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    WHERE id = p_next_attendance_id;

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'New dealer ' || p_next_attendance_id || ' was already assigned elsewhere',
      'incoming_name', COALESCE(v_incoming_name, 'Unknown'),
      'rollback', true
    );
  END IF;

  UPDATE dealer_attendance
  SET current_state = 'assigned',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL,
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
      'old_dealer_on_break', p_send_to_break
    ));

  RETURN jsonb_build_object(
    'status', 'success',
    'new_assignment_id', v_new_assignment_id,
    'incoming_name', v_incoming_name,
    'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes', v_comp_break,
    'ot_minutes', v_ot_minutes,
    'short_notice_bonus_min', v_short_notice_bonus
  );
END;
$function$;

COMMENT ON FUNCTION public.execute_pre_assigned_swing(uuid, uuid, timestamptz, integer, boolean, integer)
  IS 'Execute pre-assigned swing. Outgoing dealer gets ot_minutes + short_notice_bonus_min '
     || '(computed from pre_assigned_at - swing_due_at gap, capped at pre_announce_min). '
     || 'Forward-only: bonus added directly to overtime_minutes, no separate column.';
