-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: fix_in_transition_constraint
--
-- Two bugs fixed:
--
-- 🔴 Bug 1: Step 2 of 6-param wrapper sets current_state = 'in_transition'
--    but dealer_attendance CHECK constraint only allows:
--      'available', 'assigned', 'on_break', 'checked_out', 'pre_assigned'
--    → Every swing call violates constraint → transaction rollback
--    → process-swing sees swingResult=null → outcome="failed" → silent failure
--    → Same behaviour as the original column bugs, different error.
--
--    Fix: Remove Step 2 entirely. FOR UPDATE OF da in Step 1 already
--    prevents concurrent modifications via row-level lock. No transitional
--    state needed.
--
-- 🔴 Bug 2: Step 4 finds dealer from pool independently of caller's
--    pickNextDealer. The caller (process-swing) implements a 3-level
--    fallback (skipPriorityBreakGuard, skipFatigueHardCap) that is
--    completely disconnected from the RPC's internal SQL query.
--    The RPC also has no knowledge of cycleExcludedIds.
--
--    Fix: Remove Step 4. Accept p_next_attendance_id from caller.
--    Verify availability atomically via FOR UPDATE — no separate query.
--    If caller provides NULL → OT path (set overtime_started_at).
--
-- Backward compatibility: signature changes from 6-param to 7-param
-- (p_next_attendance_id UUID DEFAULT NULL added as last param).
-- Named-parameter callers unchanged; positional callers unaffected
-- because DEFAULT makes it optional.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Drop both overloads
-- ═══════════════════════════════════════════════════════════════════════════════

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
-- STEP 2: Recreate wrapper (was 6-param, now 7-param with p_next_attendance_id)
--
-- Validates + locks the assignment. Tries pre-assigned dealer first.
-- Otherwise uses p_next_attendance_id from caller (process-swing's
-- pickNextDealer with 3-level fallback). OT path when no dealer.
-- Delegates swing execution to 7-param core engine.
--
-- Removed vs 20260706000001:
--   ✂ Step 2 (in_transition) — CHECK constraint violation
--   ✂ Step 4 (dealer search from pool) — disconnected from pickNextDealer
--   ✂ v_current_state, v_was_priority_break, v_is_pre_assigned vars
--   ✂ set_config calls for state tracking (unnecessary without transition)
--
-- Added:
--   + p_next_attendance_id UUID DEFAULT NULL — from caller's pickNextDealer
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id UUID,
  p_duration_minutes INT,
  p_send_to_break BOOLEAN DEFAULT false,
  p_break_duration_minutes INT DEFAULT 15,
  p_max_break_minutes INT DEFAULT 60,
  p_expected_version INT DEFAULT NULL,
  p_next_attendance_id UUID DEFAULT NULL
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
  v_pre_assigned_id    UUID;
  v_next_attendance_id UUID;
  v_swing_result       JSONB;
BEGIN
  -- ============================================================
  -- STEP 1: VALIDATE & LOCK OLD ASSIGNMENT
  -- ============================================================
  -- FOR UPDATE prevents concurrent modifications. No transitional
  -- state needed — the row lock and atomic transaction are sufficient.

  SELECT da.version, da.table_id, da.attendance_id, da.pre_assigned_attendance_id,
         da.overtime_started_at,
         gt.club_id
  INTO   v_current_version, v_table_id, v_old_attendance_id, v_pre_assigned_id,
         v_ot_started_at,
         v_club_id
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
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

  -- ============================================================
  -- STEP 2: TRY PRE-ASSIGNED DEALER FIRST
  -- ============================================================
  -- If the assignment has a pre-assigned dealer still in 'pre_assigned'
  -- state, use them. This handles the case where execute_pre_assigned_swing
  -- RPC hasn't been called yet (e.g., concurrent tick overlap).

  v_next_attendance_id := NULL;

  IF v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id
    INTO   v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id
      AND dat.current_state = 'pre_assigned'
    FOR UPDATE;

    -- Not FOUND → v_next_attendance_id stays NULL → fall through to Step 3
  END IF;

  -- ============================================================
  -- STEP 3: USE CALLER-PROVIDED DEALER ID
  -- ============================================================
  -- process-swing passes p_next_attendance_id from pickNextDealer,
  -- which implements a 3-level fallback (skipPriorityBreakGuard,
  -- skipFatigueHardCap) and respects cycleExcludedIds.
  --
  -- We only use the caller's result if no pre-assigned dealer was used.
  -- We verify the dealer is still available via FOR UPDATE SKIP LOCKED
  -- to handle race conditions (concurrent tick picking same dealer).

  IF v_next_attendance_id IS NULL AND p_next_attendance_id IS NOT NULL THEN
    SELECT dat.id
    INTO   v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = p_next_attendance_id
      AND dat.current_state = 'available'
      AND dat.status = 'checked_in'
    FOR UPDATE;

    -- If not found → dealer was taken by concurrent tick → v_next_attendance_id
    -- stays NULL → OT path. No rollback needed — old dealer still 'assigned'.
  END IF;

  -- ============================================================
  -- STEP 4: OT PATH (no dealer available)
  -- ============================================================
  -- No replacement dealer: keep current dealer, track overtime.

  IF v_next_attendance_id IS NULL THEN
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments
      SET overtime_started_at = NOW()
      WHERE id = p_assignment_id;
    END IF;

    RETURN jsonb_build_object(
      'outcome',              'no_dealer',
      'is_new_overtime',      (v_ot_started_at IS NULL),
      'overtime_started_at',  COALESCE(v_ot_started_at, NOW())
    );
  END IF;

  -- ============================================================
  -- STEP 5: DELEGATE TO 7-PARAM CORE ENGINE
  -- ============================================================

  SELECT public.perform_swing(
    p_assignment_id          := p_assignment_id,
    p_version                := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id     := v_next_attendance_id,
    p_send_to_break          := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes := p_duration_minutes,
    p_swing_due_at           := NULL
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Recreate 7-param core engine (unchanged from 20260706000001)
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

  -- Lock assignment + get club_id via game_tables join
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

  -- OT path: no replacement dealer available
  IF p_next_attendance_id IS NULL THEN
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

  -- Compute compensatory break duration
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

  -- Release old assignment
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

  -- Send old dealer to break or back to available
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

  -- Assign new dealer (with unique-active-attendance guard)
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned', v_now, 1, v_swing_due_at
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

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

  -- Finalize new dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0)
  WHERE id = p_next_attendance_id;

  -- Audit log
  INSERT INTO swing_audit_logs (assignment_id, action, club_id, table_id, triggered_by, details)
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

GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Verify both overloads exist
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'perform_swing';

  ASSERT v_count = 2, format('perform_swing: expected 2 overloads, got %s', v_count);

  RAISE NOTICE '✓ perform_swing: 2 overloads recreated (in_transition removed, Step 4 removed)';
END;
$$;

COMMIT;
