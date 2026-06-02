-- =============================================================================
-- Migration: perform_swing (7-param wrapper with p_max_break_minutes) — fix swing_due_at
--
-- Context:
--   The wrapper overload (with p_max_break_minutes, p_next_attendance_id) used
--   to call the 7-param core engine without computing swing_due_at locally,
--   relying on the core's COALESCE fallback. This meant callers like Pass 3
--   didn't see the real swing_due_at in the returned JSON, and the core's
--   default computation (NOW() + p_swing_duration_minutes) was a footgun if
--   the caller wanted a different schedule.
--
--   Fix: Compute swing_due_at here in the wrapper, pass it explicitly to core.
--
-- Signature: (p_assignment_id, p_duration_minutes, p_send_to_break,
--             p_break_duration_minutes, p_max_break_minutes, p_expected_version,
--             p_next_attendance_id)
-- =============================================================================

BEGIN;

-- Drop the specific 7-param wrapper overload (the one with p_max_break_minutes
-- and p_next_attendance_id as the last two params)
DROP FUNCTION IF EXISTS public.perform_swing(
  UUID, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID
);

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id          UUID,
  p_duration_minutes       INTEGER,
  p_send_to_break          BOOLEAN DEFAULT false,
  p_break_duration_minutes INTEGER DEFAULT 15,
  p_max_break_minutes      INTEGER DEFAULT 60,
  p_expected_version       INTEGER DEFAULT NULL,
  p_next_attendance_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_swing_due_at       TIMESTAMPTZ;
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
  v_next_attendance_id := NULL;

  IF v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id
    INTO   v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id
      AND dat.current_state = 'pre_assigned'
    FOR UPDATE;
  END IF;

  -- ============================================================
  -- STEP 3: USE CALLER-PROVIDED DEALER ID
  -- ============================================================
  IF v_next_attendance_id IS NULL AND p_next_attendance_id IS NOT NULL THEN
    SELECT dat.id
    INTO   v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = p_next_attendance_id
      AND dat.current_state = 'available'
      AND dat.status = 'checked_in'
    FOR UPDATE;
  END IF;

  -- ============================================================
  -- STEP 4: OT PATH (no dealer available)
  -- ============================================================
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
  -- Compute swing_due_at here so the new assignment gets a real
  -- timestamp immediately (not NULL relying on COALESCE in core).
  -- ============================================================
  v_swing_due_at := NOW() + (p_duration_minutes || ' minutes')::INTERVAL;

  SELECT public.perform_swing(
    p_assignment_id          := p_assignment_id,
    p_version                := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id     := v_next_attendance_id,
    p_send_to_break          := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes := p_duration_minutes,
    p_swing_due_at           := v_swing_due_at
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

COMMENT ON FUNCTION public.perform_swing(UUID, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID) IS
  'Wrapper 7-param swing with p_max_break_minutes. Phase 3 fix: computes swing_due_at locally so the new assignment gets a real timestamp, not a COALESCE fallback.';

COMMIT;
