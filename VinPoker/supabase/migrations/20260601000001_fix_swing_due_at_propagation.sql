-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: fix 6-param perform_swing swing_due_at propagation
--
-- Problem: The 6-param wrapper loads swing_due_at from the OLD assignment and
-- passes it to the 7-param function. This means every new assignment inherits
-- the stale due time (e.g. 01:57 for Bàn 4), making it immediately overdue
-- and causing a re-swing every cron cycle.
--
-- Fix: Pass NULL for p_swing_due_at. The 7-param function's COALESCE then
-- computes a fresh due time: v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

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
  v_next_attendance_id UUID;
  v_swing_result JSONB;
  v_current_version INT;
  v_table_id UUID;
  v_club_id UUID;
  v_assignment_status TEXT;
  v_is_pre_assigned BOOLEAN;
  v_pre_assigned_id UUID;
BEGIN
  SELECT da.version, da.table_id, da.status, da.pre_assigned_attendance_id
  INTO v_current_version, v_table_id, v_assignment_status, v_pre_assigned_id
  FROM dealer_assignments da
  WHERE da.id = p_assignment_id
    AND da.status IN ('assigned', 'active')
    AND da.released_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found', 'message', 'Assignment not found or already released');
  END IF;

  IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
    RETURN jsonb_build_object('outcome', 'version_conflict', 'message', 'Version mismatch', 'expected_version', p_expected_version, 'actual_version', v_current_version);
  END IF;

  v_is_pre_assigned := false;
  IF v_pre_assigned_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_attendance WHERE id = v_pre_assigned_id AND current_state = 'pre_assigned') THEN
      v_next_attendance_id := v_pre_assigned_id;
      v_is_pre_assigned := true;
    END IF;
  END IF;

  IF v_next_attendance_id IS NULL THEN
    SELECT gt.club_id INTO v_club_id
    FROM game_tables gt WHERE gt.id = v_table_id;

    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    INNER JOIN dealers d ON d.id = dat.dealer_id
    WHERE d.club_id = v_club_id
      AND dat.current_state = 'available'
      AND dat.check_in_time IS NOT NULL AND dat.check_out_time IS NULL
    ORDER BY dat.priority_break_flag ASC, dat.worked_minutes_since_last_break ASC, RANDOM()
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  END IF;

  IF v_next_attendance_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_dealer', 'message', 'No available dealer found', 'assignment_id', p_assignment_id);
  END IF;

  -- NOTE: p_swing_due_at := NULL so the 7-param function computes a fresh due time
  -- from p_swing_duration_minutes. Passing the old assignment's swing_due_at would
  -- cause the new assignment to inherit a stale (potentially in-the-past) due time.
  SELECT public.perform_swing(
    p_assignment_id := p_assignment_id,
    p_version := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id := v_next_attendance_id,
    p_send_to_break := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes := p_duration_minutes,
    p_swing_due_at := NULL
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INT, BOOLEAN, INT, INT, INT) TO service_role;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'perform_swing'
  ), 'perform_swing function missing';
  RAISE NOTICE '✓ perform_swing 6-param: swing_due_at propagation fixed';
END;
$$;

COMMIT;
