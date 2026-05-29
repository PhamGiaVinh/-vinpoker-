-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Fix perform_swing ON CONFLICT clause
--
-- Bug: perform_swing used `ON CONFLICT ON CONSTRAINT idx_unique_active_attendance`
-- but idx_unique_active_attendance is a partial UNIQUE INDEX on
-- (attendance_id) WHERE (status = 'assigned'), NOT a pg_constraint entry.
-- This caused the INSERT to throw ERROR 42704 and the RPC to silently fail,
-- resulting in every swing attempt with an available dealer being counted as
-- "failed" instead of "swung".
--
-- Fix: Replace with `ON CONFLICT (attendance_id) WHERE (status = 'assigned')`
-- which correctly references a partial unique index as the conflict target
-- (PostgreSQL 15+ syntax).
--
-- Discovered during force_all smoke test after P0/P1/P2 deployment.
-- The bug was pre-existing and prevented ALL non-pre-assigned swings.
-- ═══════════════════════════════════════════════════════════════════════════════

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
  -- FIX: Use ON CONFLICT (column) WHERE (condition) instead of
  -- ON CONFLICT ON CONSTRAINT — idx_unique_active_attendance is a
  -- partial UNIQUE INDEX, not a pg_constraint entry.
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, swing_due_at, version
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned',
    v_now, v_swing_due_at, 1
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
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
$function$;

-- Verify function was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'perform_swing'
  ) THEN
    RAISE EXCEPTION 'perform_swing function not found after migration';
  END IF;
END $$;
