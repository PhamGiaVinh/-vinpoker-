-- Migration: add_pool_entered_at
-- Pool cooldown guard: dealer vừa vào pool cần 1 phút buffer để
-- Telegram kịp gửi pre-assign notification trước khi bị pick lại.
--
-- pool_entered_at được set = NOW() khi:
--   1. perform_swing release dealer (cùng lúc với last_released_at)
--   2. execute_pre_assigned_swing release dealer
--   3. end_expired_breaks kết thúc break (dealer vào pool mới)
-- Được clear = NULL khi dealer check-out (không còn trong pool).

-- 1. Add pool_entered_at to dealer_attendance
ALTER TABLE public.dealer_attendance
  ADD COLUMN IF NOT EXISTS pool_entered_at TIMESTAMPTZ;

-- 2. Partial index cho pool cooldown query
-- Match query: .eq("club_id", x) .in("current_state", ["available","on_break"]) .gt("pool_entered_at", y)
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_pool_entered
  ON public.dealer_attendance(club_id, pool_entered_at)
  WHERE current_state IN ('available', 'on_break');

-- 3. Backfill: pool_entered_at = last_released_at cho record cũ
-- (approximation — future releases sẽ set pool_entered_at = NOW())
-- Chỉ backfill record chưa có pool_entered_at để idempotent.
UPDATE dealer_attendance
SET pool_entered_at = last_released_at
WHERE last_released_at IS NOT NULL
  AND pool_entered_at IS NULL;

-- 4. Update perform_swing RPC: set pool_entered_at = v_now
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id UUID,
  p_next_attendance_id UUID,
  p_send_to_break BOOLEAN DEFAULT FALSE,
  p_break_duration_minutes INT DEFAULT NULL,
  p_reason TEXT DEFAULT 'auto_swing'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- [1] Get assignment + table + club info (with version check)
  SELECT a.id, a.table_id, a.club_id, a.attendance_id,
      a.dealer_id, a.duration_minutes, a.overtime_started_at,
      da.dealers->>'full_name' AS dealer_name
  INTO v_assignment
  FROM dealer_assignments a
  JOIN dealer_attendance da ON da.id = a.attendance_id
  WHERE a.id = p_assignment_id
  FOR UPDATE; -- row lock

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assignment_not_found');
  END IF;

  v_table_id := v_assignment.table_id;
  v_club_id := v_assignment.club_id;
  v_old_attendance_id := v_assignment.attendance_id;
  v_old_dealer_id := v_assignment.dealer_id;
  v_old_dealer_name := v_assignment.dealer_name;

  -- [2] Calculate actual worked minutes
  v_actual_worked_min := COALESCE(
    EXTRACT(EPOCH FROM (v_now - v_assignment.assigned_at)) / 60, 0
  )::INT;

  -- [3] Calculate OT minutes if started
  IF v_assignment.overtime_started_at IS NOT NULL THEN
    v_ot_minutes := COALESCE(
      EXTRACT(EPOCH FROM (v_now - v_assignment.overtime_started_at)) / 60, 0
    )::INT;
  END IF;

  -- [4] Complete old assignment
  UPDATE dealer_assignments
  SET status = 'completed',
    released_at = v_now,
    swing_processed_at = v_now,
    overtime_started_at = NULL,
    updated_at = v_now
  WHERE id = p_assignment_id;

  -- [5] Update old dealer state
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

  -- [5b] Insert break record if sending to break
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  -- [6] Get effective swing config for next dealer
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

  -- [7] Calculate next swing_due_at
  v_next_swing_due_at := v_now + (v_swing_duration_min || ' minutes')::INTERVAL;

  -- [8] Create new assignment for incoming dealer
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

  -- [9] Update incoming dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned',
    updated_at = v_now
  WHERE id = p_next_attendance_id;

  -- [10] Return result
  RETURN jsonb_build_object(
    'ok', true,
    'old_attendance_id', v_old_attendance_id,
    'new_assignment_id', v_next_assignment_id,
    'worked_minutes', v_actual_worked_min,
    'ot_minutes', v_ot_minutes,
    'sent_to_break', p_send_to_break
  );
END;
$$;

-- 5. Update execute_pre_assigned_swing RPC: set pool_entered_at = v_now
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_assignment_id UUID,
  p_next_attendance_id UUID,
  p_send_to_break BOOLEAN DEFAULT FALSE,
  p_break_duration_minutes INT DEFAULT NULL,
  p_reason TEXT DEFAULT 'pre_assigned_swing'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment RECORD;
  v_table_id UUID;
  v_club_id UUID;
  v_old_attendance_id UUID;
  v_old_dealer_id UUID;
  v_old_dealer_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_actual_worked_min INT;
  v_ot_minutes INT := 0;
  v_comp_break INT;
  v_swing_duration_min INT := 45;
  v_next_swing_due_at TIMESTAMPTZ;
  v_next_assignment_id UUID;
  v_rest_deficit_min INT := 0;
  v_effective_due_at TIMESTAMPTZ;
BEGIN
  -- [1] Lock assignment row
  SELECT a.id, a.table_id, a.club_id, a.attendance_id,
      a.dealer_id, a.duration_minutes, a.overtime_started_at,
      a.swing_due_at, a.pre_announce_sent_at,
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

  -- [2] Calculate actual worked minutes
  v_actual_worked_min := COALESCE(
    EXTRACT(EPOCH FROM (v_now - v_assignment.assigned_at)) / 60, 0
  )::INT;

  -- [3] Calculate OT minutes
  IF v_assignment.overtime_started_at IS NOT NULL THEN
    v_ot_minutes := COALESCE(
      EXTRACT(EPOCH FROM (v_now - v_assignment.overtime_started_at)) / 60, 0
    )::INT;
  END IF;

  -- [4] Complete old assignment
  UPDATE dealer_assignments
  SET status = 'completed',
    released_at = v_now,
    swing_processed_at = v_now,
    overtime_started_at = NULL,
    updated_at = v_now
  WHERE id = p_assignment_id;

  -- [5] Update old dealer state
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

  -- [5b] Insert break record if sending to break
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  -- [6] Get swing config
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

  -- [7] Calculate next swing_due_at with rest deficit
  v_next_swing_due_at := v_now + (v_swing_duration_min || ' minutes')::INTERVAL;

  -- Rest deficit: delay next swing if incoming dealer just finished a break
  IF p_break_duration_minutes IS NOT NULL AND p_break_duration_minutes > 0 THEN
    v_rest_deficit_min := GREATEST(0, p_break_duration_minutes - v_swing_duration_min);
    IF v_rest_deficit_min > 0 THEN
      v_effective_due_at := v_next_swing_due_at + (v_rest_deficit_min || ' minutes')::INTERVAL;
    ELSE
      v_effective_due_at := v_next_swing_due_at;
    END IF;
  ELSE
    v_effective_due_at := v_next_swing_due_at;
  END IF;

  -- [8] Create new assignment
  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id,
    v_table_id,
    v_club_id,
    'assigned',
    v_now,
    1,
    v_effective_due_at
  ) RETURNING id INTO v_next_assignment_id;

  -- [9] Update incoming dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned',
    updated_at = v_now
  WHERE id = p_next_attendance_id;

  -- [10] Return
  RETURN jsonb_build_object(
    'ok', true,
    'old_attendance_id', v_old_attendance_id,
    'new_assignment_id', v_next_assignment_id,
    'worked_minutes', v_actual_worked_min,
    'ot_minutes', v_ot_minutes,
    'rest_deficit_min', v_rest_deficit_min,
    'effective_due_at', v_effective_due_at
  );
END;
$$;

-- 6. Update end_expired_breaks: set pool_entered_at = NOW() (không NULL)
CREATE OR REPLACE FUNCTION public.end_expired_breaks(
  p_club_id UUID DEFAULT NULL
)
RETURNS TABLE(
  attendance_id UUID,
  dealer_name TEXT,
  break_start TIMESTAMPTZ,
  expected_duration_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT DISTINCT ON (da.id)
      da.id AS att_id,
      d.full_name AS d_name,
      db.break_start AS br_start,
      db.expected_duration_minutes AS exp_min
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    JOIN dealer_assignments dass ON dass.attendance_id = da.id
    JOIN dealer_breaks db ON db.assignment_id = dass.id
    WHERE da.current_state = 'on_break'
      AND da.status = 'checked_in'
      AND db.break_end IS NULL
      AND NOW() > db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
    ORDER BY da.id, db.break_start DESC
  )
  UPDATE dealer_attendance da
  SET
    current_state = 'available',
    priority_break_flag = false,
    worked_minutes_since_last_break = 0,
    last_released_at = NULL,
    pool_entered_at = NOW(),
    updated_at = NOW()
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING
    da.id,
    expired.d_name,
    expired.br_start,
    expired.exp_min;
END;
$$;
