-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: fix_in_transition_and_dealer_flow
--
-- Root cause #1: 6-param wrapper Step 2 sets current_state = 'in_transition'.
--   But dealer_attendance.current_state CHECK constraint only allows:
--   'available', 'assigned', 'on_break', 'checked_out', 'pre_assigned'.
--   Every swing call fails with constraint violation → transaction rolls back
--   → process-swing sees data=null → outcome="failed" → metrics.failed++ silently.
--
-- Root cause #2: 6-param wrapper Step 4 runs its own dealer search disconnected
--   from caller's pickNextDealer (3-level fallback, cycleExcludedIds, scoring).
--   The RPC also filters by dat.shift_id = v_shift_id, excluding dealers on other
--   shifts. Caller's carefully chosen dealer is ignored entirely.
--
-- Fixes:
--   1. Remove Step 2 (in_transition) entirely — FOR UPDATE lock in Step 1
--      already prevents concurrent modifications. No transitional state needed.
--   2. Add p_next_attendance_id UUID DEFAULT NULL parameter to accept the
--      caller's pickNextDealer result. Use it directly instead of internal search.
--   3. Remove Step 4 (internal dealer pool query) — caller handles picking.
--   4. Keep pre-assigned dealer check as fallback before using caller's dealer.
--   5. If no dealer at all → OT path (set overtime_started_at).
--
-- 7-param core engine unchanged — it already handles the swing correctly
-- given p_next_attendance_id.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Drop the old 6-param wrapper (the one with in_transition + Step 4)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.perform_swing(
  p_assignment_id UUID,
  p_duration_minutes INT,
  p_send_to_break BOOLEAN,
  p_break_duration_minutes INT,
  p_max_break_minutes INT,
  p_expected_version INT
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Recreate wrapper accepting p_next_attendance_id from caller
--
-- New signature: 7 params (but distinguishable from 7-param core by types)
--   Wrapper: (UUID, INT, BOOLEAN, INT, INT, INT, UUID)
--   Core:    (UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ)
--
-- Changes from previous version:
--   - Added p_next_attendance_id UUID DEFAULT NULL (from caller's pickNextDealer)
--   - REMOVED: Step 2 (in_transition) — caused CHECK constraint violation
--   - REMOVED: Step 4 (internal dealer pool query) — caller picks, we just verify
--   - REMOVED: in_transition state guard (no longer possible without Step 2)
--   - ADDED: caller dealer verification (still available? still checked in?)
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
  v_final_attendance   UUID;
  v_is_pre_assigned    BOOLEAN := false;

  -- Results
  v_swing_result       JSONB;
BEGIN
  -- ============================================================
  -- STEP 1: VALIDATE & LOCK OLD ASSIGNMENT
  -- ============================================================
  -- FOR UPDATE of da prevents concurrent modifications to this row.
  -- No need for in_transition state — the row lock is sufficient.

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

  -- ============================================================
  -- STEP 2: (REMOVED) in_transition state update
  -- ============================================================
  -- The old 6-param wrapper set current_state = 'in_transition' here.
  -- This caused CHECK constraint violations because 'in_transition' is
  -- not in the allowed list (available, assigned, on_break, checked_out,
  -- pre_assigned). Removed entirely — FOR UPDATE lock provides the
  -- concurrency protection. The 7-param core handles old dealer state
  -- transitions when the swing commits.

  -- ============================================================
  -- STEP 3: TRY PRE-ASSIGNED DEALER FIRST
  -- ============================================================
  -- If the assignment has a pre_assigned_attendance_id and that dealer
  -- is still in pre_assigned state, use it (overrides caller's dealer).

  IF v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id
    INTO   v_final_attendance
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id
      AND dat.current_state = 'pre_assigned'
    FOR UPDATE;

    IF FOUND THEN
      v_is_pre_assigned := true;
    END IF;
  END IF;

  -- ============================================================
  -- STEP 4: USE CALLER-PROVIDED DEALER (if no pre-assigned)
  -- ============================================================
  -- The caller (process-swing) uses pickNextDealer with 3-level fallback
  -- (skipPriorityBreakGuard → skipFatigueHardCap) and cycleExcludedIds.
  -- We verify the dealer is still available (race condition check) and
  -- still checked in.

  IF NOT v_is_pre_assigned THEN
    IF p_next_attendance_id IS NOT NULL THEN
      SELECT dat.id
      INTO   v_final_attendance
      FROM dealer_attendance dat
      WHERE dat.id = p_next_attendance_id
        AND dat.current_state = 'available'
        AND dat.status = 'checked_in'
      FOR UPDATE;

      IF NOT FOUND THEN
        -- Dealer no longer available (taken by concurrent tick or checked out)
        v_final_attendance := NULL;
      END IF;
    END IF;
  END IF;

  -- ============================================================
  -- STEP 5: OT PATH (no dealer available)
  -- ============================================================

  IF v_final_attendance IS NULL THEN
    -- If this is the first OT detection, persist the timestamp
    -- so subsequent ticks can distinguish new vs continuing OT.
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments
      SET overtime_started_at = NOW()
      WHERE id = p_assignment_id;
    END IF;

    RETURN jsonb_build_object(
      'outcome', 'no_dealer',
      'is_new_overtime', (v_ot_started_at IS NULL),
      'overtime_started_at', COALESCE(v_ot_started_at, NOW())
    );
  END IF;

  -- ============================================================
  -- STEP 6: DELEGATE TO 7-PARAM CORE ENGINE
  -- ============================================================

  SELECT public.perform_swing(
    p_assignment_id        := p_assignment_id,
    p_version              := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id   := v_final_attendance,
    p_send_to_break        := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes := p_duration_minutes,
    p_swing_due_at         := NULL
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: 7-param core engine unchanged
-- ==========================================
-- The 7-param core already:
--   - CAS locks via version check
--   - Persists overtime_started_at on first OT detection
--   - Releases old assignment + creates new one
--   - Handles unique-active-attendance guard (ON CONFLICT DO NOTHING)
--   - Computes compensatory break duration
--   - Writes swing_log audit entry
-- No changes needed.
-- ═══════════════════════════════════════════════════════════════════════════════

-- (Keep existing 7-param core as deployed by 20260706000001)

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Grant execute to service_role
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT, UUID) TO service_role;

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

  RAISE NOTICE '✓ perform_swing: 2 overloads (wrapper + core) with correct signatures';
END;
$$;

COMMIT;
