-- =============================================================================
-- Migration: Fix perform_swing — on_break pool query + bypass pool when
--            p_next_attendance_id provided + atomic dealer_breaks close
--
-- Bugs fixed:
--   A. Pool query used worked_minutes_since_last_break (always 0 for on_break)
--      instead of dealer_shift_metrics.minutes_since_rest. On_break dealers
--      were NEVER eligible → always "no_dealer".
--   B. 6-param wrapper did NOT accept p_next_attendance_id. When process-swing
--      (TS) called with that param, PostgREST silently dropped it → wrapper
--      ran its own pool query (broken by Bug A) → no_dealer.
--      Fix: add p_next_attendance_id param. When provided, SKIP pool query
--      entirely and pass straight to 7-param core (Direction B).
--   C. When an on_break dealer is selected, the wrapper must close their
--      open dealer_breaks record (SET break_end = NOW()) IN THE SAME
--      TRANSACTION before transitioning state. Avoids orphaned break records
--      and data corruption.
--
-- Key design decisions:
--   - Direction B: when p_next_attendance_id provided, bypass pool query.
--     TS layer (pickNextDealer) already selected the best dealer.
--   - Atomic break closure: inline UPDATE dealer_breaks, not nested RPC.
--   - dealer_shift_metrics is a live VIEW (relkind='v'), so minutes_since_rest
--     is always current — no staleness risk.
-- =============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DROP both overloads (must drop 6-param first, it depends on 7-param call)
-- ═══════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT);
DROP FUNCTION IF EXISTS public.perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7-PARAM CORE ENGINE (unchanged logic, signature restored)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id          UUID,
  p_version                INT,
  p_next_attendance_id     UUID,
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
  v_next_dealer_state  TEXT;
BEGIN
  v_swing_due_at := COALESCE(p_swing_due_at, v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL);

  SELECT
    da.attendance_id, da.table_id, da.version, da.overtime_started_at, gt.club_id
  INTO
    v_old_attendance_id, v_table_id, v_current_version, v_ot_started_at, v_club_id
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

  -- ── No replacement dealer: mark OT and return ──
  IF p_next_attendance_id IS NULL THEN
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments SET overtime_started_at = v_now WHERE id = p_assignment_id;
      v_ot_started_at := v_now;
    END IF;

    UPDATE dealer_attendance SET priority_break_flag = true WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object('outcome', 'no_dealer', 'is_new_overtime', v_is_new_ot,
      'overtime_started_at', v_ot_started_at);
  END IF;

  -- ── Verify next dealer exists and is in a valid state ──
  SELECT current_state INTO v_next_dealer_state
  FROM dealer_attendance
  WHERE id = p_next_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_dealer', 'message', 'Next dealer not found');
  END IF;

  -- ── Close open break record if next dealer is on_break (Fix C, atomic) ──
  IF v_next_dealer_state = 'on_break' THEN
    UPDATE dealer_breaks
    SET break_end = v_now
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = p_next_attendance_id
        AND status = 'completed'
      ORDER BY released_at DESC NULLS LAST
      LIMIT 1
    )
    AND break_end IS NULL;

    -- Also close any other open break records for this attendance (orphan safety)
    UPDATE dealer_breaks
    SET break_end = v_now
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = p_next_attendance_id
    )
    AND break_end IS NULL;
  END IF;

  -- ── Compute compensation break for outgoing dealer ──
  v_base_break := COALESCE(p_break_duration_minutes, 15);
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60);
    v_comp_break := LEAST(v_base_break + (v_ot_minutes / 2), GREATEST(v_base_break * 2, 30));
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  -- ── Complete old assignment ──
  UPDATE dealer_assignments
  SET status = 'completed', version = version + 1, released_at = v_now,
      swing_processed_at = v_now, overtime_started_at = NULL, updated_at = v_now
  WHERE id = p_assignment_id;

  -- ── Update outgoing dealer stats ──
  UPDATE dealer_attendance
  SET overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
      priority_break_flag = false
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    UPDATE dealer_attendance SET current_state = 'on_break', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;
  ELSE
    UPDATE dealer_attendance SET current_state = 'available', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;
  END IF;

  -- ── Create new assignment for incoming dealer ──
  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id, v_table_id, v_club_id, 'assigned', v_now, 1, v_swing_due_at
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  -- ── Race lost: incoming dealer was assigned elsewhere ──
  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments SET status = 'assigned', version = version + 1, released_at = NULL,
        swing_processed_at = NULL, updated_at = v_now
    WHERE id = p_assignment_id;
    UPDATE dealer_attendance SET current_state = 'assigned',
        priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes)
    WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  -- ── Transition incoming dealer ──
  UPDATE dealer_attendance SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0)
  WHERE id = p_next_attendance_id;

  RETURN jsonb_build_object('outcome', 'swung', 'new_assignment_id', v_new_assignment_id,
    'ot_minutes', v_ot_minutes, 'comp_break_minutes', v_comp_break,
    'old_dealer_on_break', p_send_to_break,
    'next_dealer_was_on_break', (v_next_dealer_state = 'on_break'));
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6-PARAM WRAPPER (called by frontend & process-swing)
--
-- Fix A: pool query uses dealer_shift_metrics.minutes_since_rest >= 10
--         instead of worked_minutes_since_last_break >= 10
-- Fix B: accepts p_next_attendance_id — when provided, skips pool query
--         entirely (Direction B: TS already selected dealer, no double-pick)
-- Fix C: closes open dealer_breaks record atomically for on_break dealers
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id        UUID,
  p_duration_minutes     INT DEFAULT 30,
  p_send_to_break        BOOLEAN DEFAULT false,
  p_break_duration_minutes INT DEFAULT 15,
  p_max_break_minutes    INT DEFAULT 60,
  p_expected_version     INT DEFAULT NULL,
  p_next_attendance_id   UUID DEFAULT NULL
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
  v_shift_id           UUID;
  v_current_version    INT;
  v_current_state      TEXT;
  v_ot_started_at      TIMESTAMPTZ;
  v_was_priority_break BOOLEAN;
  v_pre_assigned_id    UUID;
  v_next_attendance_id UUID;
  v_next_dealer_state  TEXT;
  v_swing_result       JSONB;
BEGIN
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
    RETURN jsonb_build_object('outcome', 'not_found', 'message', 'Assignment not found or already swung');
  END IF;

  IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'outcome', 'version_conflict',
      'message', 'Assignment was modified by another process',
      'expected_version', p_expected_version,
      'actual_version', v_current_version
    );
  END IF;

  IF v_current_state = 'in_transition' THEN
    RETURN jsonb_build_object('outcome', 'already_in_transition', 'message', 'Dealer is already being swung');
  END IF;

  -- ══ Atomically lock outgoing dealer state ══
  UPDATE dealer_attendance SET current_state = 'in_transition'
  WHERE id = v_old_attendance_id AND current_state = 'assigned';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'state_conflict',
      'message', format('Dealer state changed concurrently (expected assigned, got %s)', v_current_state),
      'current_state', v_current_state
    );
  END IF;

  v_next_attendance_id := NULL;

  -- ══ Priority 0: Caller-provided dealer (Fix B — bypass pool query) ══
  IF p_next_attendance_id IS NOT NULL THEN
    -- Verify the provided dealer exists and is in a selectable state
    SELECT dat.id, dat.current_state
    INTO   v_next_attendance_id, v_next_dealer_state
    FROM dealer_attendance dat
    WHERE dat.id = p_next_attendance_id
      AND dat.status = 'checked_in'
      AND dat.check_in_time IS NOT NULL
      AND dat.check_out_time IS NULL
      AND (
        dat.current_state = 'available'
        OR dat.current_state = 'on_break'
        OR dat.current_state = 'pre_assigned'
      )
    FOR UPDATE;

    IF NOT FOUND THEN
      v_next_attendance_id := NULL;
      -- Fall through to pre-assigned and pool query logic below
    END IF;
  END IF;

  -- ══ Priority 1: Pre-assigned dealer from Pass 2 ══
  IF v_next_attendance_id IS NULL AND v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id AND dat.current_state = 'pre_assigned'
    FOR UPDATE;
    IF NOT FOUND THEN v_next_attendance_id := NULL;
    END IF;
  END IF;

  -- ══ Priority 2: Pool query — Fix A: use minutes_since_rest ══
  IF v_next_attendance_id IS NULL THEN
    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    INNER JOIN dealers d ON d.id = dat.dealer_id
    LEFT JOIN dealer_shift_metrics dsm ON dsm.attendance_id = dat.id
    WHERE d.club_id = v_club_id
      AND dat.id != v_old_attendance_id
      AND (dat.shift_id = v_shift_id OR dat.shift_id IS NULL)
      AND (
        dat.current_state = 'available'
        OR (dat.current_state = 'on_break' AND COALESCE(dsm.minutes_since_rest, 0) >= 10)
      )
      AND dat.status = 'checked_in'
      AND dat.check_in_time IS NOT NULL
      AND dat.check_out_time IS NULL
    ORDER BY
      CASE WHEN dat.current_state = 'available' THEN 0 ELSE 1 END,
      dat.shift_id IS NULL,
      dat.priority_break_flag ASC,
      COALESCE(dsm.worked_minutes_since_last_break, 0) ASC,
      RANDOM()
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      -- Revert: put old dealer back to assigned
      UPDATE dealer_attendance SET current_state = 'assigned' WHERE id = v_old_attendance_id;

      IF v_ot_started_at IS NULL THEN
        UPDATE dealer_assignments SET overtime_started_at = NOW() WHERE id = p_assignment_id;
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

  -- ══ Fix C: Close open break records for on_break dealers (atomic) ══
  SELECT current_state INTO v_next_dealer_state
  FROM dealer_attendance WHERE id = v_next_attendance_id;

  IF v_next_dealer_state = 'on_break' THEN
    -- Close open break records for this dealer's last assignment
    UPDATE dealer_breaks
    SET break_end = NOW()
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = v_next_attendance_id
        AND status = 'completed'
      ORDER BY released_at DESC NULLS LAST
      LIMIT 1
    )
    AND break_end IS NULL;

    -- Also close any other orphaned open break records for this attendance
    UPDATE dealer_breaks
    SET break_end = NOW()
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = v_next_attendance_id
    )
    AND break_end IS NULL;
  END IF;

  -- ══ Delegate to 7-param core ══
  SELECT public.perform_swing(
    p_assignment_id        := p_assignment_id,
    p_version              := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id   := v_next_attendance_id,
    p_send_to_break        := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes  := p_duration_minutes,
    p_swing_due_at         := NULL
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Reload PostgREST schema cache so it picks up signature changes
-- ═══════════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'Reload schema';

COMMIT;