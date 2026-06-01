-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Reset worked_minutes_since_last_break when entering non-working states
--
-- Problem: Dealer không chia bài (on_break, available, checked_out) vẫn giữ
--          worked_minutes_since_last_break > 0 từ lúc làm việc → badge "Nghỉ ngay"
--          hiển thị sai cho dealer đã nghỉ.
--
-- Fix: reset về 0 ở 3 chỗ:
--   1. transition_dealer_state RPC — dùng bởi tất cả edge functions
--   2. perform_swing RPC         — branch p_send_to_break bị thiếu reset
--   3. end_expired_breaks        — direct UPDATE SET current_state='available'
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. transition_dealer_state RPC: auto-reset worked_minutes khi vào non-working state
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transition_dealer_state(
  p_attendance_id UUID,
  p_new_state     TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_state TEXT;
  v_valid     BOOLEAN;
BEGIN
  -- Lock row
  SELECT current_state INTO v_old_state
  FROM dealer_attendance
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTENDANCE_NOT_FOUND');
  END IF;

  -- Same state → idempotent no-op
  IF v_old_state = p_new_state THEN
    RETURN jsonb_build_object(
      'ok', true, 'from', v_old_state, 'to', p_new_state, 'noop', true
    );
  END IF;

  -- Validate transition
  v_valid := CASE
    WHEN v_old_state = 'available'     AND p_new_state IN ('pre_assigned','assigned','in_transition','on_break','checked_out') THEN true
    WHEN v_old_state = 'pre_assigned'  AND p_new_state IN ('assigned','available','checked_out')                              THEN true
    WHEN v_old_state = 'assigned'      AND p_new_state IN ('on_break','in_transition','available','checked_out')              THEN true
    WHEN v_old_state = 'in_transition' AND p_new_state IN ('assigned','available','on_break','checked_out')                   THEN true
    WHEN v_old_state = 'on_break'      AND p_new_state IN ('available','in_transition','checked_out')                         THEN true
    WHEN v_old_state = 'swing_ready'   AND p_new_state IN ('in_transition','available','checked_out')                         THEN true
    ELSE false
  END;

  IF NOT v_valid THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INVALID_TRANSITION',
      'from', v_old_state,
      'to', p_new_state
    );
  END IF;

  -- Set session variable for trigger
  PERFORM set_config(
    'app.state_reason',
    COALESCE(p_reason, 'transition_dealer_state'),
    true
  );

  -- Execute transition + reset worked_minutes when entering non-working states
  UPDATE dealer_attendance
  SET
    current_state = p_new_state,
    worked_minutes_since_last_break = CASE
      WHEN p_new_state IN ('on_break', 'available', 'checked_out') THEN 0
      ELSE worked_minutes_since_last_break
    END
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object('ok', true, 'from', v_old_state, 'to', p_new_state);
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. perform_swing RPC: thêm worked_minutes reset ở branch p_send_to_break
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id       UUID,
  p_duration_minutes    INT DEFAULT 30,
  p_send_to_break       BOOLEAN DEFAULT FALSE,
  p_compensatory_minutes INT DEFAULT 0,
  p_enforce_next_swing  INT DEFAULT 75,
  p_minimum_worked      INT DEFAULT 15
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
  v_shift_id UUID;
  v_old_attendance_id UUID;
  v_old_dealer_id UUID;
  v_next_dealer_id UUID;
  v_next_attendance_id UUID;
  v_next_dealer_was_pre_assigned BOOLEAN;
  v_actual_minutes INT;
  v_ot_minutes INT;
  v_comp_break INT;
  v_outcome TEXT;
  v_message TEXT;
  v_old_state TEXT;
  v_new_assignment_id UUID;
  v_actual_version INT;
  v_was_priority_break BOOLEAN;
  v_old_started_at TIMESTAMPTZ;
  v_swing_due_at TIMESTAMPTZ;
BEGIN
  -- ════════════════════════════════════════════════════════════════════
  -- STEP 1: LOCK & LOAD assignment
  -- ════════════════════════════════════════════════════════════════════
  SELECT
    a.id, a.table_id, a.dealer_id, a.attendance_id, a.started_at,
    a.version, a.expected_duration_minutes,
    t.club_id, t.id AS tbl_id, t.shift_id,
    a.pre_assigned_attendance_id
  INTO v_assignment
  FROM dealer_assignments a
  JOIN game_tables t ON t.id = a.table_id
  WHERE a.id = p_assignment_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'message', 'Assignment not found');
  END IF;

  v_table_id            := v_assignment.table_id;
  v_club_id             := v_assignment.club_id;
  v_shift_id            := v_assignment.shift_id;
  v_old_attendance_id   := v_assignment.attendance_id;
  v_old_dealer_id       := v_assignment.dealer_id;
  v_old_started_at      := v_assignment.started_at;
  v_actual_version      := v_assignment.version;
  v_old_state           := v_assignment.current_state;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 2: Check if current_state is still 'assigned' (skip if dealer already released)
  -- ════════════════════════════════════════════════════════════════════
  IF v_old_state IS DISTINCT FROM 'assigned' THEN
    RETURN jsonb_build_object(
      'outcome', 'state_mismatch',
      'message', format('Dealer state is %s, expected assigned', v_old_state),
      'table_id', v_table_id
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 3: Compute actual & OT minutes
  -- ════════════════════════════════════════════════════════════════════
  v_actual_minutes := GREATEST(0, EXTRACT(EPOCH FROM NOW() - v_old_started_at) / 60)::INT;
  v_ot_minutes     := GREATEST(0, v_actual_minutes - COALESCE(p_duration_minutes, 30));

  -- Compensatory break: use provided value or actual OT minutes
  v_comp_break := GREATEST(0, COALESCE(p_compensatory_minutes, v_ot_minutes));

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 4: Pick next dealer from pool (or pre-assigned)
  -- ════════════════════════════════════════════════════════════════════
  -- Try pre-assigned first
  IF v_assignment.pre_assigned_attendance_id IS NOT NULL THEN
    SELECT da.id, da.dealer_id
    INTO v_next_attendance_id, v_next_dealer_id
    FROM dealer_attendance da
    WHERE da.id = v_assignment.pre_assigned_attendance_id
      AND da.current_state = 'pre_assigned'
      AND da.status = 'checked_in'
    LIMIT 1;

    IF FOUND THEN
      v_next_dealer_was_pre_assigned := true;
    END IF;
  END IF;

  -- Fallback: pick from pool (available, least worked)
  IF v_next_attendance_id IS NULL THEN
    SELECT da.id, da.dealer_id
    INTO v_next_attendance_id, v_next_dealer_id
    FROM dealer_attendance da
    WHERE da.current_state = 'available'
      AND da.status = 'checked_in'
      AND da.shift_id = v_shift_id
    ORDER BY da.worked_minutes_since_last_break ASC, RANDOM()
    LIMIT 1;

    IF FOUND THEN
      v_next_dealer_was_pre_assigned := false;

      -- Enforce next swing if next dealer in pool has worked >= threshold
      IF v_enforce_next_swing > 0
         AND EXISTS (
           SELECT 1 FROM dealer_attendance
           WHERE id = v_next_attendance_id
             AND worked_minutes_since_last_break >= v_enforce_next_swing
         )
      THEN
        RETURN jsonb_build_object(
          'outcome', 'enforce_next_swing',
          'message', format(
            'Next dealer worked %s min >= %s, enforce swing',
            (SELECT worked_minutes_since_last_break FROM dealer_attendance WHERE id = v_next_attendance_id),
            v_enforce_next_swing
          ),
          'table_id', v_table_id
        );
      END IF;
    END IF;
  END IF;

  -- No dealer available at all
  IF v_next_attendance_id IS NULL THEN
    UPDATE dealer_attendance
    SET current_state = 'assigned', updated_at = NOW()
    WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object(
      'outcome', 'no_dealer_available',
      'message', 'No dealers in pool',
      'table_id', v_table_id
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 5: END OLD ASSIGNMENT
  -- ════════════════════════════════════════════════════════════════════
  UPDATE dealer_assignments
  SET
    status = 'completed',
    ended_at = NOW(),
    actual_duration_minutes = v_actual_minutes,
    overtime_minutes = v_ot_minutes,
    version = version + 1
  WHERE id = p_assignment_id;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 6: UPDATE OLD DEALER STATE
  -- ════════════════════════════════════════════════════════════════════
  IF p_send_to_break THEN
    PERFORM set_config(
      'app.state_reason',
      format('swing_to_break_ot_%s_break_%s', v_ot_minutes, v_comp_break),
      true
    );

    UPDATE dealer_attendance
    SET
      current_state = 'on_break',
      worked_minutes_since_last_break = 0,   -- 🔴 FIX: reset khi dealer nghỉ
      break_count = break_count + 1,
      priority_break_flag = FALSE,
      updated_at = NOW()
    WHERE id = v_old_attendance_id;

    INSERT INTO dealer_breaks (
      id, attendance_id, dealer_id, club_id, shift_id,
      started_at, duration_minutes, is_compensatory, overtime_minutes_earned
    ) VALUES (
      gen_random_uuid(), v_old_attendance_id, v_old_dealer_id, v_club_id, v_shift_id,
      NOW(), v_comp_break, v_ot_minutes > 0, v_ot_minutes
    );

    v_outcome := 'swung_to_break';
    v_message := format(
      'Dealer %s swung off table %s, break %s min (OT: %s min)',
      v_old_dealer_id, v_table_id, v_comp_break, v_ot_minutes
    );
  ELSE
    PERFORM set_config(
      'app.state_reason',
      format('swing_to_pool_ot_%s', v_ot_minutes),
      true
    );

    UPDATE dealer_attendance
    SET
      current_state = 'available',
      worked_minutes_since_last_break = 0,
      priority_break_flag = FALSE,
      updated_at = NOW()
    WHERE id = v_old_attendance_id;

    v_outcome := 'swung_to_pool';
    v_message := format(
      'Dealer %s returned to pool (OT: %s min)',
      v_old_dealer_id, v_ot_minutes
    );
  END IF;

  -- Accumulate OT for both branches
  UPDATE dealer_attendance
  SET
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    updated_at = NOW()
  WHERE id = v_old_attendance_id;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 7: CREATE NEW ASSIGNMENT
  -- ════════════════════════════════════════════════════════════════════
  v_new_assignment_id := gen_random_uuid();

  INSERT INTO dealer_assignments (
    id, club_id, shift_id, table_id, dealer_id, attendance_id,
    status, started_at, version, expected_duration_minutes, created_at
  ) VALUES (
    v_new_assignment_id, v_club_id, v_shift_id, v_table_id,
    v_next_dealer_id, v_next_attendance_id,
    'active', NOW(), 1, p_duration_minutes, NOW()
  );

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 8: UPDATE NEW DEALER STATE
  -- ════════════════════════════════════════════════════════════════════
  PERFORM set_config(
    'app.state_reason',
    format('swing_assign_new_dealer_table_%s_%s',
      v_table_id,
      CASE WHEN v_next_dealer_was_pre_assigned THEN 'pre_assigned' ELSE 'from_pool' END
    ),
    true
  );

  UPDATE dealer_attendance
  SET
    current_state = 'assigned',
    current_table_id = v_table_id,
    pre_assigned_table_id = NULL,
    pre_assigned_at = NULL,
    updated_at = NOW()
  WHERE id = v_next_attendance_id;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 9: CLEAR PRE-ASSIGNMENT LINK
  -- ════════════════════════════════════════════════════════════════════
  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = NULL,
    pre_assigned_at = NULL
  WHERE id = p_assignment_id;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 10: RETURN SUCCESS
  -- ════════════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'message', v_message,
    'old_assignment_id', p_assignment_id,
    'new_assignment_id', v_new_assignment_id,
    'old_dealer_id', v_old_dealer_id,
    'new_dealer_id', v_next_dealer_id,
    'table_id', v_table_id,
    'overtime_minutes', v_ot_minutes,
    'break_duration', CASE WHEN p_send_to_break THEN v_comp_break ELSE NULL END,
    'was_priority_break', v_was_priority_break,
    'actual_duration', v_actual_minutes,
    'version', v_actual_version + 1
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'outcome', 'error',
      'message', SQLERRM,
      'error_code', SQLSTATE
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. end_expired_breaks: thêm worked_minutes reset khi kết thúc break quá hạn
-- ──────────────────────────────────────────────────────────────────────────────
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
    worked_minutes_since_last_break = 0
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING
    da.id,
    expired.d_name,
    expired.br_start,
    expired.exp_min;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Verify
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'transition_dealer_state'
  ), 'transition_dealer_state function missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'perform_swing'
  ), 'perform_swing function missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'end_expired_breaks'
  ), 'end_expired_breaks function missing';

  RAISE NOTICE '✓ Migration 20260713000001 passed all assertions';
END;
$$;

COMMIT;
