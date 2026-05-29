-- =============================================================================
-- Migration: Application-level batch swing duration (Hướng B)
-- Date: 2026-06-17
--
-- Key changes:
-- 1. DISABLE per-row trigger trg_dealer_assignment_due_at
--    (duration computed once per batch at application level)
-- 2. CREATE get_dealer_pool_snapshot() RPC for atomic pre-batch snapshot
-- 3. UPDATE perform_swing to accept optional p_swing_due_at param
--    (pre-calculated from app, bypasses per-row calculation)
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 1: Disable per-row trigger
-- ═══════════════════════════════════════════════════════════════════════════════
-- Hướng B: duration computed once at application level (calculateBatchSwingDuration.ts)
-- using a pool snapshot taken BEFORE the batch. Per-row trigger caused variable
-- durations when multiple INSERTs happened in the same batch (each INSERT sees
-- a shrinking available pool → ratio decreases → different durations).
--
-- Pass 1 (fillEmptyTables) now passes p_swing_due_at to assign_dealer_to_table.
-- The trigger passthrough (IF NEW.swing_due_at IS NOT NULL THEN RETURN NEW)
-- would have handled this, but disabling the trigger entirely is cleaner —
-- it eliminates the trigger overhead and makes the data flow explicit.
ALTER TABLE dealer_assignments DISABLE TRIGGER trg_dealer_assignment_due_at;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 2: Pool snapshot RPC — TOCTOU-safe read
-- ═══════════════════════════════════════════════════════════════════════════════
-- Returns the count of active tables and weighted dealer pool at call time.
-- Used by calculateBatchSwingDuration() to compute a SINGLE duration for all
-- assignments in the current cycle. Because it's STABLE + SECURITY DEFINER,
-- all reads happen in a single snapshot (no phantom reads between SELECTs).
CREATE OR REPLACE FUNCTION get_dealer_pool_snapshot(
  p_club_id    UUID,
  p_table_type TEXT DEFAULT 'tournament'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_tables INT;
  v_available     INT;
  v_pre_assigned  INT;
  v_weighted_pool NUMERIC;
BEGIN
  -- Active tables count
  SELECT COUNT(*) INTO v_active_tables
  FROM game_tables
  WHERE club_id = p_club_id AND status = 'active';

  -- Available dealers (weight 1.0)
  SELECT COUNT(*) INTO v_available
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.status = 'checked_in'
    AND da.shift_date = CURRENT_DATE
    AND da.current_state = 'available';

  -- Pre-assigned dealers (weight 0.5)
  SELECT COUNT(*) INTO v_pre_assigned
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.status = 'checked_in'
    AND da.shift_date = CURRENT_DATE
    AND da.current_state = 'pre_assigned';

  v_weighted_pool := v_available::NUMERIC + v_pre_assigned::NUMERIC * 0.5;

  RETURN jsonb_build_object(
    'active_tables',   v_active_tables,
    'available',       v_available,
    'pre_assigned',    v_pre_assigned,
    'weighted_pool',   v_weighted_pool
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_dealer_pool_snapshot(UUID, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 3: Update perform_swing to accept optional p_swing_due_at
-- ═══════════════════════════════════════════════════════════════════════════════
-- When p_swing_due_at IS NOT NULL, use it directly for the new assignment's
-- swing_due_at instead of computing from p_swing_duration_minutes.
-- This ensures all assignments in a batch get the SAME swing_due_at
-- when the app pre-calculates it from a pool snapshot.
DROP FUNCTION IF EXISTS perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT);

CREATE FUNCTION perform_swing(
  p_assignment_id          UUID,
  p_version                INT,
  p_next_attendance_id     UUID DEFAULT NULL,
  p_send_to_break          BOOLEAN DEFAULT FALSE,
  p_break_duration_minutes INT DEFAULT NULL,
  p_swing_duration_minutes INT DEFAULT 90,
  p_swing_due_at           TIMESTAMPTZ DEFAULT NULL   -- NEW: pre-calculated from application
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
  v_ot_started_at      TIMESTAMPTZ;
  v_is_new_ot          BOOLEAN;
  v_new_assignment_id  UUID;
  v_ot_minutes         INT;
  v_comp_break         INT;
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
    da.overtime_started_at,
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
    v_is_new_ot := (v_ot_started_at IS NULL);

    UPDATE dealer_assignments
    SET overtime_started_at     = COALESCE(overtime_started_at, v_now),
        swing_retry_count       = 0,
        last_swing_attempted_at = v_now,
        swing_due_at            = v_now + INTERVAL '55 seconds',
        version                 = version + 1
    WHERE id = p_assignment_id;

    UPDATE dealer_attendance
    SET priority_break_flag = true
    WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object(
      'outcome',         'no_dealer',
      'is_new_overtime',  v_is_new_ot,
      'overtime_started_at', COALESCE(v_ot_started_at, v_now)
    );
  END IF;

  -- ── DEALER FOUND: execute swing with compensatory break if OT ────────────
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0,
      EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60
    );
    v_comp_break := LEAST(
      p_break_duration_minutes + (v_ot_minutes / 2),
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
      overtime_started_at = NULL,
      version            = version + 1
  WHERE id = p_assignment_id;

  -- Update old dealer: accumulate OT + clear priority flag
  UPDATE dealer_attendance
  SET overtime_minutes    = overtime_minutes + v_ot_minutes,
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

  -- INVARIANT: Use v_swing_due_at (batch-consistent pre-calculated value)
  -- instead of per-row calculation. This is the core of Hướng B fix.
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, swing_due_at, version
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned',
    v_now, v_swing_due_at, 1
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
      'was_overtime', v_ot_started_at IS NOT NULL,
      'swing_due_at', v_swing_due_at
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

GRANT EXECUTE ON FUNCTION perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ)
  TO service_role;
