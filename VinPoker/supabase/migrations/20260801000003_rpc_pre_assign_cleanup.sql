-- =============================================================================
-- Migration: RPC execute_pre_assigned_swing — pre_assigned field cleanup
--
-- Bug #5 fix: Add pre_assigned_table_id = NULL, pre_assigned_at = NULL to
-- all 3 UPDATE paths per overload (6 total) where dealer_attendance rows
-- transition away from pre_assigned state but leave stale fields behind.
--
-- Modifications per overload:
--   [3] Step 3: SET current_state = 'assigned' → add NULL fields
--   [8] Rollback (race_lost): SET current_state = 'available' → add NULL fields
--   [9] Finalize: SET current_state = 'assigned', total_worked_minutes_today → add NULL fields
--
-- Also adds RAISE DEBUG input logging at start of each function body.
-- Wrapped in transaction for atomic deployment.
-- =============================================================================

BEGIN;

-- ─── OVERLOAD 1: (uuid, uuid, timestamptz, int, bool, int) ────────────────────
DROP FUNCTION IF EXISTS public.execute_pre_assigned_swing(
  UUID, UUID, TIMESTAMPTZ, INTEGER, BOOLEAN, INTEGER
);

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id      UUID,
  p_next_attendance_id     UUID,
  p_swing_due_at           TIMESTAMPTZ,
  p_duration_minutes       INTEGER,
  p_send_to_break          BOOLEAN,
  p_break_duration_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  RAISE DEBUG '[execute_pre_assigned_swing] invoked: p_next=% p_old_assign=%',
    p_next_attendance_id, p_old_assignment_id;

  -- GUARD: Validate inputs
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

  -- [1] Get old assignment info + OT (Phase 1: get club_id for new INSERT)
  SELECT
    gt.club_id,
    da.table_id,
    da.attendance_id,
    da.overtime_started_at
  INTO
    v_club_id,
    v_table_id,
    v_old_attendance_id,
    v_overtime_started
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

  -- [2] Get incoming dealer name
  SELECT d.full_name
  INTO v_incoming_name
  FROM dealer_attendance datt
  JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  -- [3] Check pre_assigned state and assign dealer
  -- Bug #5 fix: clear pre_assigned fields on state transition
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

  -- [4] Calculate OT + compensatory break
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

  -- [5] Calculate actual worked minutes for outgoing dealer (for assignment record only)
  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db
  JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time
  FROM dealer_attendance WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  -- [6] Close old assignment
  UPDATE dealer_assignments
  SET
    status              = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
    swing_processed_at  = v_now,
    overtime_started_at = NULL,
    updated_at          = v_now
  WHERE id = p_old_assignment_id;

  -- [7] Update state + OT accumulation for old dealer
  -- With compute-on-read: reset worked_minutes_since_last_break to 0
  UPDATE dealer_attendance
  SET
    current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag         = false,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = v_old_attendance_id;

  -- [7b] Insert break record if sending to break
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  -- [8] Create new assignment for incoming dealer (Phase 1: club_id required)
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
    -- Rollback
    UPDATE dealer_assignments
    SET status = 'assigned',
        swing_processed_at = NULL,
        overtime_started_at = v_overtime_started,
        updated_at = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET
      current_state = 'assigned',
      overtime_minutes = COALESCE(overtime_minutes, 0) - v_ot_minutes,
      priority_break_flag = true,
      worked_minutes_since_last_break = 0,
      total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
    WHERE id = v_old_attendance_id;

    -- Bug #5 fix: clear pre_assigned fields on rollback
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

  -- [9] Update new dealer state
  -- Bug #5 fix: clear pre_assigned fields on finalization
  UPDATE dealer_attendance
  SET current_state = 'assigned',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL,
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = p_next_attendance_id;

  -- [10] Insert audit log
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
      'comp_break_minutes', v_comp_break,
      'old_dealer_on_break', p_send_to_break
    ));

  RETURN jsonb_build_object(
    'status', 'success',
    'new_assignment_id', v_new_assignment_id,
    'incoming_name', v_incoming_name,
    'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes', v_comp_break
  );
END;
$$;

-- ─── OVERLOAD 2: (uuid, uuid, timestamptz, int, int, bool) ────────────────────
DROP FUNCTION IF EXISTS public.execute_pre_assigned_swing(
  UUID, UUID, TIMESTAMPTZ, INTEGER, INTEGER, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id      UUID,
  p_next_attendance_id     UUID,
  p_swing_due_at           TIMESTAMPTZ,
  p_duration_minutes       INTEGER DEFAULT 30,
  p_break_duration_minutes INTEGER DEFAULT 15,
  p_send_to_break          BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  RAISE DEBUG '[execute_pre_assigned_swing] invoked: p_next=% p_old_assign=%',
    p_next_attendance_id, p_old_assignment_id;

  -- GUARD: Validate inputs
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

  -- [1] Get old assignment info + OT (Phase 1: get club_id)
  SELECT
    gt.club_id,
    da.table_id,
    da.attendance_id,
    da.overtime_started_at
  INTO
    v_club_id, v_table_id, v_old_attendance_id, v_overtime_started
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

  -- [2] Get incoming dealer name
  SELECT d.full_name INTO v_incoming_name
  FROM dealer_attendance datt
  JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  -- [3] Check pre_assigned state and assign dealer
  -- Bug #5 fix: clear pre_assigned fields on state transition
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

  -- [4] Calculate OT + compensatory break
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

  -- [5] Calculate actual worked minutes for outgoing dealer
  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db
  JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time
  FROM dealer_attendance WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  -- [6] Close old assignment
  UPDATE dealer_assignments
  SET
    status              = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
    swing_processed_at  = v_now,
    overtime_started_at = NULL,
    updated_at          = v_now
  WHERE id = p_old_assignment_id;

  -- [7] Update state + OT accumulation for old dealer
  -- With compute-on-read: reset worked_minutes_since_last_break to 0
  UPDATE dealer_attendance
  SET
    current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag         = false,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = v_old_attendance_id;

  -- [7b] Insert break record if sending to break
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  -- [8] Create new assignment for incoming dealer (Phase 1: club_id required)
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
    -- Rollback
    UPDATE dealer_assignments
    SET status = 'assigned',
        swing_processed_at = NULL,
        overtime_started_at = v_overtime_started,
        updated_at = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET
      current_state = 'assigned',
      overtime_minutes = COALESCE(overtime_minutes, 0) - v_ot_minutes,
      priority_break_flag = true,
      worked_minutes_since_last_break = 0,
      total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
    WHERE id = v_old_attendance_id;

    -- Bug #5 fix: clear pre_assigned fields on rollback
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

  -- [9] Update new dealer state
  -- Bug #5 fix: clear pre_assigned fields on finalization
  UPDATE dealer_attendance
  SET current_state = 'assigned',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL,
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = p_next_attendance_id;

  -- [10] Insert audit log
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
      'comp_break_minutes', v_comp_break,
      'old_dealer_on_break', p_send_to_break
    ));

  RETURN jsonb_build_object(
    'status', 'success',
    'new_assignment_id', v_new_assignment_id,
    'incoming_name', v_incoming_name,
    'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes', v_comp_break
  );
END;
$$;

COMMENT ON FUNCTION public.execute_pre_assigned_swing(UUID, UUID, TIMESTAMPTZ, INTEGER, BOOLEAN, INTEGER) IS
  'Execute pre-assigned swing (overload 1). Bug #5 fix: clears pre_assigned_table_id/pre_assigned_at on all state transitions.';

COMMENT ON FUNCTION public.execute_pre_assigned_swing(UUID, UUID, TIMESTAMPTZ, INTEGER, INTEGER, BOOLEAN) IS
  'Execute pre-assigned swing (overload 2). Bug #5 fix: clears pre_assigned_table_id/pre_assigned_at on all state transitions.';

-- Validate: both overloads present with cleanup logic
DO $$
DECLARE
  v_overload_count INT;
  v_cleanup_count INT;
BEGIN
  SELECT COUNT(*), SUM(CASE WHEN prosrc LIKE '%pre_assigned_table_id = NULL%' THEN 1 ELSE 0 END)
  INTO v_overload_count, v_cleanup_count
  FROM pg_proc WHERE proname = 'execute_pre_assigned_swing';

  IF v_overload_count != 2 THEN
    RAISE EXCEPTION 'Expected 2 overloads, found %', v_overload_count;
  END IF;

  IF v_cleanup_count != 2 THEN
    RAISE EXCEPTION 'Expected 2 overloads with cleanup, found %', v_cleanup_count;
  END IF;

  RAISE NOTICE 'RPC validation passed: 2 overloads, both have pre_assigned cleanup logic';
END;
$$;

COMMIT;