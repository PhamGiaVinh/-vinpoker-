-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Fix break formula + pre_assigned race_lost release + stale cleanup
--
-- Changes:
--  1. perform_swing: remove hardcoded cap 60, use dynamic cap (2x base, min 30)
--  2. execute_pre_assigned_swing: add p_break_duration_minutes param
--  3. execute_pre_assigned_swing: fix state check (pre_assigned, not available)
--  4. execute_pre_assigned_swing: release dealer back to available on race_lost
--  5. execute_pre_assigned_swing: unified break formula
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Fix 1: perform_swing — dynamic cap instead of hardcoded 60 ────────────────
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id uuid,
  p_version integer,
  p_next_attendance_id uuid DEFAULT NULL::uuid,
  p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT NULL::integer,
  p_swing_duration_minutes integer DEFAULT 90,
  p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
 RETURNS jsonb
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
BEGIN
  -- INVARIANT: Use pre-calculated swing_due_at (batch-consistent) if provided.
  -- Fall back to computing from p_swing_duration_minutes for backward compat.
  v_swing_due_at := COALESCE(p_swing_due_at, v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL);

  -- Load + lock assignment row in one shot
  SELECT
    da.attendance_id,
    da.table_id,
    da.version,
    da.overtime_started_at
  INTO
    v_old_attendance_id,
    v_table_id,
    v_current_version,
    v_ot_started_at
  FROM dealer_assignments da
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.version = p_version
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost', 'reason', 'version_mismatch');
  END IF;

  -- Detect if this is a brand-new OT (first time seeing OT on this assignment)
  v_is_new_ot := (v_ot_started_at IS NOT NULL);
  v_ot_minutes := 0;

  -- Pre-compute: is this a no-dealer scenario?
  IF p_next_attendance_id IS NULL THEN
    -- Mark priority break flag for OT optimization
    IF v_ot_started_at IS NOT NULL THEN
      UPDATE dealer_attendance
      SET priority_break_flag = true
      WHERE id = v_old_attendance_id;
    END IF;

    RETURN jsonb_build_object(
      'outcome',         'no_dealer',
      'is_new_overtime',  v_is_new_ot,
      'overtime_started_at', COALESCE(v_ot_started_at, v_now)
    );
  END IF;

  -- ── DEALER FOUND: execute swing with compensatory break if OT ────────────
  v_base_break := COALESCE(p_break_duration_minutes, 15);

  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0,
      EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60
    );
    -- Formula: base break + OT/2 compensation, capped at 2x base (min 30)
    v_comp_break := LEAST(
      v_base_break + (v_ot_minutes / 2),
      GREATEST(v_base_break * 2, 30)
    );
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  -- Release old assignment
  UPDATE dealer_assignments
  SET status             = 'completed',
      version            = version + 1,
      released_at        = v_now,
      swing_processed_at = v_now,
      overtime_started_at = NULL,
      updated_at         = v_now
  WHERE id = p_assignment_id;

  -- Update old dealer attendance (OT accumulation + reset state)
  UPDATE dealer_attendance
  SET overtime_minutes    = COALESCE(overtime_minutes, 0) + v_ot_minutes,
      priority_break_flag = false
  WHERE id = v_old_attendance_id;

  -- Send old dealer to break (compensatory if OT, standard otherwise)
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
    attendance_id, table_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned', v_now, 1, v_swing_due_at
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    -- New dealer became unavailable between check and insert
    -- Rollback: restore old assignment + old dealer
    UPDATE dealer_assignments
    SET status             = 'assigned',
        version            = version + 1,
        released_at        = NULL,
        swing_processed_at = NULL,
        updated_at         = v_now
    WHERE id = p_assignment_id;

    UPDATE dealer_attendance
    SET current_state = 'assigned', priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes)
    WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  -- Update new dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0)
  WHERE id = p_next_attendance_id;

  -- Insert audit log
  INSERT INTO swing_log (assignment_id, outcome, club_id, table_id, triggered_by, metadata)
  VALUES (
    p_assignment_id, 'swung', v_club_id, v_table_id, 'system',
    jsonb_build_object(
      'new_assignment_id', v_new_assignment_id,
      'incoming_attendance_id', p_next_attendance_id,
      'outgoing_attendance_id', v_old_attendance_id,
      'ot_minutes', v_ot_minutes,
      'comp_break_minutes', v_comp_break,
      'was_overtime', v_ot_started_at IS NOT NULL,
      'swing_due_at', v_swing_due_at
    ), 'system');

  RETURN jsonb_build_object(
    'outcome',            'swung',
    'new_assignment_id',   v_new_assignment_id,
    'ot_minutes',          v_ot_minutes,
    'comp_break_minutes',  v_comp_break,
    'old_dealer_on_break', p_send_to_break
  );
END;
$function$;

-- ── Fix 2: execute_pre_assigned_swing — unified formula + race_lost release ──
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id   UUID,
  p_next_attendance_id  UUID,
  p_swing_due_at        TIMESTAMPTZ,
  p_duration_minutes    INT,
  p_send_to_break       BOOLEAN DEFAULT false,
  p_break_duration_minutes INT DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- ==========================================
  -- GUARD: Validate inputs
  -- ==========================================
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

  -- ==========================================
  -- [1] Lấy thông tin old assignment + OT
  -- ==========================================
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

  -- ==========================================
  -- [2] Lấy tên dealer mới (incoming)
  -- ==========================================
  SELECT COALESCE(d.full_name, d.name, 'Unknown')
  INTO v_incoming_name
  FROM dealer_attendance datt
  JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  -- ==========================================
  -- [3] ⚠️ FIX: Check pre_assigned state (Pass 2 sets dealer to pre_assigned)
  --     Also check status = 'checked_in' to prevent post-checkout assignment
  -- ==========================================
  UPDATE dealer_attendance
  SET
    current_state = 'assigned',
    updated_at    = v_now
  WHERE id            = p_next_attendance_id
    AND current_state = 'pre_assigned'   -- ← FIX: was 'available', broken after Pass 2 change
    AND status        = 'checked_in';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Release the old assignment's pre_assigned reference
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
    WHERE id = p_old_assignment_id;

    -- Release the dealer back to available pool (with guard)
    UPDATE dealer_attendance
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    WHERE id = p_next_attendance_id
      AND current_state = 'pre_assigned';

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'Dealer ' || p_next_attendance_id || ' no longer pre_assigned or checked out',
      'incoming_name', v_incoming_name
    );
  END IF;

  -- ==========================================
  -- [4] Calculate OT + compensatory break if applicable
  -- ==========================================
  v_base_break := COALESCE(p_break_duration_minutes, 15);

  IF v_overtime_started IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_overtime_started))::INT / 60);

    -- Get old dealer current overtime_minutes for accumulation
    SELECT overtime_minutes INTO v_old_overtime_min
    FROM dealer_attendance WHERE id = v_old_attendance_id;

    -- Formula: base break + OT/2 compensation, capped at 2x base (min 30)
    v_comp_break := LEAST(
      v_base_break + (v_ot_minutes / 2),
      GREATEST(v_base_break * 2, 30)
    );
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  -- ==========================================
  -- [5] Tính worked_minutes thực tế cho dealer CŨ
  -- ==========================================
  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db
  JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time
  FROM dealer_attendance WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  -- ==========================================
  -- [6] Close old assignment
  -- ==========================================
  UPDATE dealer_assignments
  SET
    status              = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
    swing_processed_at  = v_now,
    overtime_started_at = NULL,
    updated_at          = v_now
  WHERE id = p_old_assignment_id;

  -- ==========================================
  -- [7] Update state + OT accumulation for old dealer
  -- ==========================================
  UPDATE dealer_attendance
  SET
    current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = CASE WHEN p_send_to_break THEN 0 ELSE v_actual_worked_min END,
    overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag         = false,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    updated_at                  = v_now
  WHERE id = v_old_attendance_id;

  -- ==========================================
  -- [7b] Insert break record if sending to break
  -- ==========================================
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  -- ==========================================
  -- [8] ⚠️ FIX: ON CONFLICT DO NOTHING + null check
  --     Previously used DO UPDATE which always returned a row,
  --     making v_new_assignment_id never null. Now DO NOTHING
  --     returns null on conflict → proper rollback.
  -- ==========================================
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, version, swing_due_at, idempotency_key
  ) VALUES (
    p_next_attendance_id,
    v_table_id,
    'assigned',
    v_now,
    1,
    p_swing_due_at,
    'pre_assign_' || p_old_assignment_id
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    -- ⚠️ Duplicate: another cron just assigned this dealer or they checked in elsewhere.
    -- Rollback: release the incoming dealer and restore old dealer/assignment.

    -- Restore old assignment
    UPDATE dealer_assignments
    SET status              = 'assigned',
        swing_processed_at  = NULL,
        overtime_started_at = v_overtime_started,
        updated_at          = v_now
    WHERE id = p_old_assignment_id;

    -- Restore old dealer
    UPDATE dealer_attendance
    SET
      current_state             = 'assigned',
      overtime_minutes          = COALESCE(overtime_minutes, 0) - v_ot_minutes,
      priority_break_flag       = true,
      worked_minutes_since_last_break = v_actual_worked_min,
      total_worked_minutes_today      = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min),
      updated_at                = v_now
    WHERE id = v_old_attendance_id;

    -- Release new dealer
    UPDATE dealer_attendance
    SET current_state = 'available',
        updated_at    = v_now
    WHERE id = p_next_attendance_id;

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'New dealer ' || p_next_attendance_id || ' was already assigned elsewhere',
      'incoming_name', v_incoming_name,
      'rollback', true
    );
  END IF;

  -- ==========================================
  -- [9] Update new dealer state
  -- ==========================================
  UPDATE dealer_attendance
  SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
      updated_at = v_now
  WHERE id = p_next_attendance_id;

  -- ==========================================
  -- [10] Insert audit log
  -- ==========================================
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
    ), 'system');

  RETURN jsonb_build_object(
    'status', 'success',
    'new_assignment_id', v_new_assignment_id,
    'incoming_name', v_incoming_name,
    'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes', v_comp_break
  );
END;
$$;

-- ── Verify both functions were created ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'perform_swing'
  ) THEN
    RAISE EXCEPTION 'perform_swing function not found after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'execute_pre_assigned_swing'
  ) THEN
    RAISE EXCEPTION 'execute_pre_assigned_swing function not found after migration';
  END IF;
END $$;
