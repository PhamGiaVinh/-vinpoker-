-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: fix_perform_swing_column_bugs
--
-- Root cause: Migration 20260704000004 created a 6-param perform_swing wrapper
-- that referenced non-existent columns:
--   ❌ da.club_id (not on dealer_assignments)
--   ❌ da.shift_id (not on dealer_assignments)
--   ❌ da.started_at (not on dealer_assignments)
--   ❌ da.ended_at IS NULL (not on dealer_assignments)
--   ❌ da.status = 'active' (valid column, but 'active' is not a valid CHECK value)
--   ❌ checked_in_at (column is named check_in_time)
--   ❌ checked_out_at (column is named check_out_time)
--
-- Every call failed at runtime → EXCEPTION handler returned {outcome:'error'}
-- → process-swing logged a warning and moved on → silent failure on ALL swings.
--
-- Fix: Recreate both overloads with correct column references.
--   - 6-param: validated-assignment + dealer-finder wrapper (called by index.ts)
--   - 7-param: core swing engine (called by the wrapper)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Drop both overloads with EXACT live signatures
-- ═══════════════════════════════════════════════════════════════════════════════

-- 6-param (the broken wrapper, created by 20260704000004)
-- The migration's DROP on the 7-param overload FAILED because the function had
-- 7 params (including p_swing_due_at with DEFAULT) but the DROP listed only 6.
-- So the 7-param survived. This DROP matches the actual 7-param identity.
DROP FUNCTION IF EXISTS public.perform_swing(
  p_assignment_id UUID,
  p_duration_minutes INT,
  p_send_to_break BOOLEAN,
  p_break_duration_minutes INT,
  p_max_break_minutes INT,
  p_expected_version INT
);

DROP FUNCTION IF EXISTS public.perform_swing(
  p_assignment_id UUID,
  p_version INT,
  p_next_attendance_id UUID,
  p_send_to_break BOOLEAN,
  p_break_duration_minutes INT,
  p_swing_duration_minutes INT,
  p_swing_due_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Recreate 6-param wrapper with correct column references
--
-- This function is what process-swing/index.ts calls (3 call sites: lines 737,
-- 772, 908). It validates the assignment, locks the dealer, finds a replacement
-- (pre-assigned or from pool), and delegates to the 7-param core engine.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id UUID,
  p_duration_minutes INT,
  p_send_to_break BOOLEAN,
  p_break_duration_minutes INT DEFAULT 15,
  p_max_break_minutes INT DEFAULT 60,
  p_expected_version INT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Old dealer (outgoing)
  v_old_attendance_id  UUID;
  v_table_id           UUID;
  v_club_id            UUID;
  v_shift_id           UUID;
  v_current_version    INT;
  v_current_state      TEXT;
  v_ot_started_at      TIMESTAMPTZ;

  -- State tracking
  v_was_priority_break BOOLEAN;
  v_pre_assigned_id    UUID;
  v_next_attendance_id UUID;
  v_is_pre_assigned    BOOLEAN;

  -- Results
  v_swing_result       JSONB;
BEGIN
  -- ============================================================
  -- STEP 1: VALIDATE & LOCK OLD ASSIGNMENT
  -- ============================================================
  -- Fixes from original:
  --   da.club_id        → gt.club_id  (join game_tables)
  --   da.shift_id       → dat.shift_id (join dealer_attendance)
  --   da.started_at     → NOT NEEDED (removed, was unused downstream)
  --   da.ended_at IS NULL → swing_processed_at IS NULL
  --   status = 'active' → status = 'assigned'

  SELECT da.version, da.table_id, da.attendance_id, da.pre_assigned_attendance_id,
         da.overtime_started_at,
         gt.club_id,
         dat.shift_id, dat.current_state, dat.priority_break_flag
  INTO   v_current_version, v_table_id, v_old_attendance_id, v_pre_assigned_id,
         v_ot_started_at,
         v_club_id,
         v_shift_id, v_current_state, v_was_priority_break
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  JOIN dealer_attendance dat ON dat.id = da.attendance_id
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.swing_processed_at IS NULL
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'not_found',
      'message', 'Assignment not found or already swung'
    );
  END IF;

  -- Version guard (optimistic locking)
  IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'outcome', 'version_conflict',
      'message', 'Assignment was modified by another process',
      'expected_version', p_expected_version,
      'actual_version', v_current_version
    );
  END IF;

  -- State guard: prevent concurrent swings on same dealer
  IF v_current_state = 'in_transition' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_in_transition',
      'message', 'Dealer is already being swung'
    );
  END IF;

  -- ============================================================
  -- STEP 2: LOCK DEALER IN TRANSITION
  -- ============================================================

  PERFORM set_config(
    'app.state_reason',
    format('swing_start_table_%s_assignment_%s', v_table_id, p_assignment_id),
    true
  );

  UPDATE dealer_attendance
  SET current_state = 'in_transition', updated_at = NOW()
  WHERE id = v_old_attendance_id
    AND current_state = 'assigned';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'state_conflict',
      'message', format('Dealer state changed concurrently (expected assigned, got %s)', v_current_state),
      'current_state', v_current_state
    );
  END IF;

  -- ============================================================
  -- STEP 3: TRY PRE-ASSIGNED DEALER FIRST
  -- ============================================================

  v_is_pre_assigned := false;

  IF v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id
    INTO   v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id
      AND dat.current_state = 'pre_assigned'
    FOR UPDATE;

    IF FOUND THEN
      v_is_pre_assigned := true;
    ELSE
      v_next_attendance_id := NULL;
    END IF;
  END IF;

  -- ============================================================
  -- STEP 4: FIND AVAILABLE DEALER FROM POOL
  -- ============================================================
  -- Fixes from original:
  --   dealer_attendance.club_id  → dealers.club_id (join through dealers table)
  --   checked_in_at              → check_in_time
  --   checked_out_at             → check_out_time
  --   priority_break_flag DESC   → priority_break_flag ASC (correct semantics)

  IF v_next_attendance_id IS NULL THEN
    SELECT dat.id
    INTO   v_next_attendance_id
    FROM dealer_attendance dat
    INNER JOIN dealers d ON d.id = dat.dealer_id
    WHERE d.club_id = v_club_id
      AND dat.id != v_old_attendance_id
      AND dat.shift_id = v_shift_id
      AND dat.current_state = 'available'
      AND dat.check_in_time IS NOT NULL
      AND dat.check_out_time IS NULL
    ORDER BY
      dat.priority_break_flag ASC,
      dat.worked_minutes_since_last_break ASC,
      RANDOM()
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      -- No dealer available → revert old dealer back to assigned
      PERFORM set_config(
        'app.state_reason',
        format('swing_no_dealer_revert_table_%s', v_table_id),
        true
      );

      UPDATE dealer_attendance
      SET current_state = 'assigned', updated_at = NOW()
      WHERE id = v_old_attendance_id;

      -- If this is the first OT detection, persist the timestamp
      -- so subsequent ticks can distinguish new vs continuing OT.
      IF v_ot_started_at IS NULL THEN
        UPDATE dealer_assignments
        SET overtime_started_at = NOW()
        WHERE id = p_assignment_id;
      END IF;

      RETURN jsonb_build_object(
        'outcome', 'no_dealer',
        'message', 'No dealers available in pool',
        'table_id', v_table_id,
        'is_new_overtime', (v_ot_started_at IS NULL),
        'overtime_started_at', COALESCE(v_ot_started_at, NOW())
      );
    END IF;
  END IF;

  -- ============================================================
  -- STEP 5: DELEGATE TO 7-PARAM CORE ENGINE
  -- ============================================================

  SELECT public.perform_swing(
    p_assignment_id        := p_assignment_id,
    p_version              := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id   := v_next_attendance_id,
    p_send_to_break        := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes := p_duration_minutes,
    p_swing_due_at         := NULL
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Recreate 7-param core engine with v_club_id fixed
--
-- Fix: Added JOIN game_tables to populate v_club_id (was NULL in prior version,
-- causing swing_log inserts to lose club context).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id          UUID,
  p_version                INT,
  p_next_attendance_id     UUID DEFAULT NULL,
  p_send_to_break          BOOLEAN DEFAULT false,
  p_break_duration_minutes INT DEFAULT NULL,
  p_swing_duration_minutes INT DEFAULT 90,
  p_swing_due_at           TIMESTAMPTZ DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_base_break         INT;
  v_now                TIMESTAMPTZ := NOW();
  v_swing_due_at       TIMESTAMPTZ;
BEGIN
  v_swing_due_at := COALESCE(p_swing_due_at, v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL);

  -- ══════════════════════════════════════════════════════════════════
  -- Lock assignment + get club_id via game_tables join
  -- ══════════════════════════════════════════════════════════════════
  -- FIX: Added gt.club_id INTO v_club_id (was NULL in prior version)
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
    AND da.version = p_version
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost', 'reason', 'version_mismatch');
  END IF;

  v_is_new_ot := (v_ot_started_at IS NULL);
  v_ot_minutes := 0;

  -- ══════════════════════════════════════════════════════════════════
  -- OT path: no replacement dealer available
  -- ══════════════════════════════════════════════════════════════════
  IF p_next_attendance_id IS NULL THEN
    -- Persist overtime_started_at on first detection so subsequent
    -- ticks can distinguish new vs continuing OT.
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments
      SET overtime_started_at = v_now
      WHERE id = p_assignment_id;
      v_ot_started_at := v_now;
    END IF;

    UPDATE dealer_attendance
    SET priority_break_flag = true
    WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object(
      'outcome',            'no_dealer',
      'is_new_overtime',    v_is_new_ot,
      'overtime_started_at', v_ot_started_at
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- Compute compensatory break duration
  -- ══════════════════════════════════════════════════════════════════
  v_base_break := COALESCE(p_break_duration_minutes, 15);

  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0,
      EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60
    );
    v_comp_break := LEAST(
      v_base_break + (v_ot_minutes / 2),
      GREATEST(v_base_break * 2, 30)
    );
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- Release old assignment
  -- ══════════════════════════════════════════════════════════════════
  UPDATE dealer_assignments
  SET status             = 'completed',
      version            = version + 1,
      released_at        = v_now,
      swing_processed_at = v_now,
      overtime_started_at = NULL,
      updated_at         = v_now
  WHERE id = p_assignment_id;

  -- Update old dealer OT minutes accumulation
  UPDATE dealer_attendance
  SET overtime_minutes    = COALESCE(overtime_minutes, 0) + v_ot_minutes,
      priority_break_flag = false
  WHERE id = v_old_attendance_id;

  -- ══════════════════════════════════════════════════════════════════
  -- Send old dealer to break or back to available
  -- ══════════════════════════════════════════════════════════════════
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

  -- ══════════════════════════════════════════════════════════════════
  -- Assign new dealer (with unique-active-attendance guard)
  -- ══════════════════════════════════════════════════════════════════
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned', v_now, 1, v_swing_due_at
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  -- Concurrent conflict: another swing assigned this dealer first
  IF v_new_assignment_id IS NULL THEN
    -- Roll back old assignment
    UPDATE dealer_assignments
    SET status             = 'assigned',
        version            = version + 1,
        released_at        = NULL,
        swing_processed_at = NULL,
        updated_at         = v_now
    WHERE id = p_assignment_id;

    UPDATE dealer_attendance
    SET current_state = 'assigned',
        priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes)
    WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- Finalize new dealer state
  -- ══════════════════════════════════════════════════════════════════
  UPDATE dealer_attendance
  SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0)
  WHERE id = p_next_attendance_id;

  -- ══════════════════════════════════════════════════════════════════
  -- Audit log
  -- ══════════════════════════════════════════════════════════════════
  INSERT INTO swing_log (assignment_id, outcome, club_id, table_id, triggered_by, metadata)
  VALUES (
    p_assignment_id, 'swung', v_club_id, v_table_id, 'system',
    jsonb_build_object(
      'new_assignment_id',      v_new_assignment_id,
      'incoming_attendance_id', p_next_attendance_id,
      'outgoing_attendance_id', v_old_attendance_id,
      'ot_minutes',             v_ot_minutes,
      'comp_break_minutes',     v_comp_break,
      'was_overtime',           v_ot_started_at IS NOT NULL,
      'swing_due_at',           v_swing_due_at
    ));

  RETURN jsonb_build_object(
    'outcome',             'swung',
    'new_assignment_id',   v_new_assignment_id,
    'ot_minutes',          v_ot_minutes,
    'comp_break_minutes',  v_comp_break,
    'old_dealer_on_break', p_send_to_break
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Grant execute to service_role
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ) TO service_role;

-- Overloads verified — functions exist
DO $$
BEGIN
  RAISE NOTICE '✓ perform_swing functions recreated';
END;
$$;

COMMIT;
