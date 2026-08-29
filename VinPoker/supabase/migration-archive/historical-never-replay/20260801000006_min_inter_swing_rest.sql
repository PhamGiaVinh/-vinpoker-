-- Migration: min_inter_swing_rest
-- Adds: last_released_at tracking on dealer_attendance,
--        min_inter_swing_rest_minutes config on swing_config,
--        Partial index for cooldown filtering

-- 1. Add last_released_at to dealer_attendance
ALTER TABLE public.dealer_attendance
  ADD COLUMN IF NOT EXISTS last_released_at TIMESTAMPTZ;

-- 2. Add min_inter_swing_rest_minutes to swing_config
ALTER TABLE public.swing_config
  ADD COLUMN IF NOT EXISTS min_inter_swing_rest_minutes INT NOT NULL DEFAULT 10;

-- 3. Partial index for cooldown filtering
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_released
  ON public.dealer_attendance(club_id, last_released_at)
  WHERE current_state IN ('available', 'on_break');

-- 4. Backfill last_released_at from MAX(released_at) of prior assignments
UPDATE dealer_attendance da
SET last_released_at = sub.max_released
FROM (
  SELECT attendance_id, MAX(released_at) AS max_released
  FROM dealer_assignments
  WHERE released_at IS NOT NULL
  GROUP BY attendance_id
) sub
WHERE da.id = sub.attendance_id
  AND da.last_released_at IS NULL;

-- 5. Update perform_swing RPC: set last_released_at = NOW() when dealer leaves table
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
  v_actual_worked_min INT;
  v_ot_minutes INT := 0;
  v_comp_break INT;
  v_next_assignment_id UUID;
  v_next_swing_due_at TIMESTAMPTZ;
  v_swing_duration_min INT;
  v_result JSONB;
BEGIN
  -- [1] Lock and fetch the current assignment
  SELECT * INTO v_assignment
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND status = 'assigned'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Assignment not found or not assigned');
  END IF;

  v_table_id := v_assignment.table_id;
  v_old_attendance_id := v_assignment.attendance_id;

  -- Get club_id and dealer info
  SELECT d.club_id, d.full_name INTO v_club_id, v_old_dealer_name
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.id = v_old_attendance_id;

  v_old_dealer_id := (SELECT dealer_id FROM dealer_attendance WHERE id = v_old_attendance_id);

  -- [2] Calculate actual worked minutes and overtime
  v_actual_worked_min := EXTRACT(EPOCH FROM (v_now - v_assignment.assigned_at))::INT / 60;

  IF v_assignment.overtime_started_at IS NOT NULL THEN
    v_ot_minutes := EXTRACT(EPOCH FROM (v_now - v_assignment.overtime_started_at))::INT / 60;
  END IF;

  -- [3] Determine break duration
  IF p_break_duration_minutes IS NOT NULL THEN
    v_comp_break := p_break_duration_minutes;
  ELSE
    SELECT COALESCE(
      (SELECT break_duration_minutes FROM swing_config WHERE club_id = v_club_id AND table_type = 'tournament' LIMIT 1),
      15
    ) INTO v_comp_break;
  END IF;

  -- [4] Release old dealer from table
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

-- 6. Update execute_pre_assigned_swing RPC: set last_released_at = NOW()
-- Find the latest version of this function and add last_released_at
-- We'll use CREATE OR REPLACE FUNCTION to update both overloads

-- Overload 1: (p_assignment_id, p_next_attendance_id, p_send_to_break, p_break_duration_minutes, p_reason)
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
  v_now TIMESTAMPTZ := NOW();
  v_actual_worked_min INT;
  v_ot_minutes INT := 0;
  v_comp_break INT;
  v_next_assignment_id UUID;
  v_next_swing_due_at TIMESTAMPTZ;
  v_swing_duration_min INT;
  v_rest_deficit_min INT := 0;
  v_original_due_at TIMESTAMPTZ;
  v_effective_due_at TIMESTAMPTZ;
  v_min_rest_min INT := 10;
BEGIN
  -- [1] Lock and validate the current assignment
  SELECT * INTO v_assignment
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND status = 'assigned'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Assignment not found or not assigned');
  END IF;

  v_table_id := v_assignment.table_id;
  v_old_attendance_id := v_assignment.attendance_id;
  v_original_due_at := v_assignment.swing_due_at;

  -- Get club_id
  SELECT d.club_id INTO v_club_id
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.id = v_old_attendance_id;

  -- [2] Calculate worked minutes
  v_actual_worked_min := EXTRACT(EPOCH FROM (v_now - v_assignment.assigned_at))::INT / 60;
  IF v_assignment.overtime_started_at IS NOT NULL THEN
    v_ot_minutes := EXTRACT(EPOCH FROM (v_now - v_assignment.overtime_started_at))::INT / 60;
  END IF;

  -- [3] Break duration
  IF p_break_duration_minutes IS NOT NULL THEN
    v_comp_break := p_break_duration_minutes;
  ELSE
    SELECT COALESCE(
      (SELECT break_duration_minutes FROM swing_config WHERE club_id = v_club_id AND table_type = 'tournament' LIMIT 1),
      15
    ) INTO v_comp_break;
  END IF;

  -- [4] Release old dealer
  UPDATE dealer_assignments
  SET status = 'completed',
    released_at = v_now,
    swing_processed_at = v_now,
    overtime_started_at = NULL,
    updated_at = v_now
  WHERE id = p_assignment_id;

  -- [5] Update old dealer state with last_released_at
  UPDATE dealer_attendance
  SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag = false,
    total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    last_released_at = v_now,
    updated_at = v_now
  WHERE id = v_old_attendance_id;

  -- [5b] Insert break record if needed
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  -- [6] Get rest deficit for incoming dealer
  WITH last_release AS (
    SELECT MAX(released_at) AS last_released_at
    FROM dealer_assignments
    WHERE attendance_id = p_next_attendance_id
      AND released_at IS NOT NULL
  )
  SELECT COALESCE(
    EXTRACT(EPOCH FROM (NOW() - lr.last_released_at))::INT / 60,
    999
  ) INTO v_rest_deficit_min
  FROM last_release lr;

  -- [7] Calculate effective swing_due_at with rest deficit
  SELECT COALESCE(swing_duration_minutes, 45) INTO v_swing_duration_min
  FROM swing_config
  WHERE club_id = v_club_id AND table_type = 'tournament'
  LIMIT 1;

  SELECT COALESCE(min_inter_swing_rest_minutes, 10) INTO v_min_rest_min
  FROM swing_config
  WHERE club_id = v_club_id AND table_type = 'tournament'
  LIMIT 1;

  v_rest_deficit_min := GREATEST(0, v_min_rest_min - v_rest_deficit_min);
  v_effective_due_at := v_now + (v_swing_duration_min || ' minutes')::INTERVAL + (v_rest_deficit_min || ' minutes')::INTERVAL;

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
    v_effective_due_at
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
    'sent_to_break', p_send_to_break,
    'rest_deficit_min', v_rest_deficit_min,
    'effective_due_at', v_effective_due_at
  );
END;
$$;

-- 7. Update end_expired_breaks: reset last_released_at = NULL
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