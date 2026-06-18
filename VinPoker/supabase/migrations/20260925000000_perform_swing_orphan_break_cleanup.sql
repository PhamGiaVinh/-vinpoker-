-- ════════════════════════════════════════════════════════════════════════════
-- 20260925000000_perform_swing_orphan_break_cleanup.sql
--
-- PR3-D (source-only). Completes PR3-C (#312, migration 20260924000000) by closing
-- the orphan-break gap on the SAME internal overload [oid 199044]:
--   perform_swing(p_assignment_id, p_version, p_next_attendance_id, p_send_to_break,
--     p_break_duration_minutes, p_swing_duration_minutes, p_swing_due_at,
--     p_rest_deficit_minutes)
--
-- BASE: this is the post-#312 body (rollback-identity fix included) + the orphan-break
-- cleanup. Authored from the source on main after #312 — NOT from stale migrations.
--
-- PROBLEM (pre-existing, surfaced in #312 review): when p_send_to_break=true the forward
-- path INSERTs a dealer_breaks row BEFORE the incoming-assignment INSERT. On a lost
-- INSERT race (v_new_assignment_id IS NULL), the rollback restores the outgoing dealer
-- to current_state='assigned' but the just-created OPEN break row was left behind →
-- false detect_stuck_breaks, break-equity skew, and (until end_expired_breaks closes it)
-- a phantom open-break subtraction at checkout. PR3-C made the dealer available-again
-- immediately, so this gap is now more exposed — fix it before applying either.
--
-- FIX (minimal): capture the inserted break id (RETURNING id INTO v_created_break_id)
-- and, on the race-lost rollback, DELETE only that row (by id, open only). NULL id
-- (no break created, e.g. p_send_to_break=false) → 0 rows. Never touches historical
-- breaks; success path unchanged.
--
-- SCOPE GUARDRAILS (same as #312):
--   - Patches ONLY oid 199044. No new overload (1 CREATE OR REPLACE of the exact
--     signature). Wrapper (199042) + 5-arg (257642) untouched.
--   - No check_in_time / payroll change, no PR3-B / pool_entered_at clamp, no
--     break duration/reason/status/incoming-selection/dealer_assignments-rollback change.
--   - SOURCE-ONLY: do NOT supabase db push / deploy_db=true. Apply #312 + PR3-D together
--     in one controlled owner-gated window. Rollback (to the #312 body):
--     docs/emergency_rollbacks/PRE_20260925_perform_swing_orphan_break.sql
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.perform_swing(p_assignment_id uuid, p_version integer, p_next_attendance_id uuid, p_send_to_break boolean DEFAULT false, p_break_duration_minutes integer DEFAULT NULL::integer, p_swing_duration_minutes integer DEFAULT 90, p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rest_deficit_minutes integer DEFAULT 0)
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
  v_next_dealer_state  TEXT;
  v_compensated_due_at TIMESTAMPTZ;
  v_rest_deficit_min   INTEGER;
  -- PR3-C: snapshot of the OUTGOING dealer's pre-release markers so the race-lost
  -- rollback restores them EXACTLY (mirrors execute_pre_assigned_swing). Only the
  -- columns this overload's forward path mutates are captured.
  v_prev_last_released     TIMESTAMPTZ;
  v_prev_worked_since_break INTEGER;
  v_prev_priority_break    BOOLEAN;
  v_prev_overtime_minutes  INTEGER;
  -- PR3-D: id of the dealer_breaks row this transaction creates on the send-to-break
  -- path, so the race-lost rollback can delete exactly that row (no orphan break).
  v_created_break_id       UUID;
BEGIN
  v_rest_deficit_min := GREATEST(0, COALESCE(p_rest_deficit_minutes, 0));
  v_swing_due_at := COALESCE(p_swing_due_at, v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL);

  SELECT da.attendance_id, da.table_id, da.version, da.overtime_started_at, gt.club_id
  INTO v_old_attendance_id, v_table_id, v_current_version, v_ot_started_at, v_club_id
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

  IF p_next_attendance_id IS NULL THEN
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments SET overtime_started_at = v_now WHERE id = p_assignment_id;
      v_ot_started_at := v_now;
    END IF;
    UPDATE dealer_attendance SET priority_break_flag = true WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'no_dealer', 'is_new_overtime', v_is_new_ot,
      'overtime_started_at', v_ot_started_at);
  END IF;

  SELECT current_state INTO v_next_dealer_state
  FROM dealer_attendance
  WHERE id = p_next_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_dealer', 'message', 'Next dealer not found');
  END IF;

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

    UPDATE dealer_breaks
    SET break_end = v_now
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = p_next_attendance_id
    )
    AND break_end IS NULL;
  END IF;

  v_base_break := COALESCE(p_break_duration_minutes, 15);
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60);
    v_comp_break := LEAST(v_base_break + (v_ot_minutes / 2), GREATEST(v_base_break * 2, 30));
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  v_compensated_due_at := public.compute_compensated_swing_due_at(
    v_now, p_swing_duration_minutes, v_ot_minutes
  );

  IF v_rest_deficit_min > 0 THEN
    v_compensated_due_at := v_compensated_due_at + (v_rest_deficit_min || ' minutes')::INTERVAL;
    INSERT INTO diagnostic_logs (club_id, diagnostic_type, result, metadata)
    VALUES (
      v_club_id, 'rest_deficit_applied',
      jsonb_build_object('rest_deficit_minutes', v_rest_deficit_min, 'compensated_due_at', v_compensated_due_at),
      jsonb_build_object('assignment_id', p_assignment_id, 'next_attendance_id', p_next_attendance_id)
    );
  END IF;

  IF v_ot_minutes > 0 THEN
    INSERT INTO diagnostic_logs (club_id, diagnostic_type, result, metadata)
    VALUES (
      v_club_id, 'drift_compensation_applied',
      jsonb_build_object('ot_minutes', v_ot_minutes, 'compensation_minutes', v_ot_minutes / 2, 'compensated_due_at', v_compensated_due_at),
      jsonb_build_object('assignment_id', p_assignment_id, 'next_attendance_id', p_next_attendance_id)
    );
  END IF;

  -- PR3-C: capture the outgoing dealer's pre-release markers BEFORE the forward
  -- release overwrites them, so the race-lost rollback can restore them exactly.
  SELECT last_released_at, worked_minutes_since_last_break, priority_break_flag, COALESCE(overtime_minutes, 0)
  INTO v_prev_last_released, v_prev_worked_since_break, v_prev_priority_break, v_prev_overtime_minutes
  FROM dealer_attendance
  WHERE id = v_old_attendance_id;

  UPDATE dealer_assignments
  SET status = 'completed', version = version + 1, released_at = v_now,
      swing_processed_at = v_now, overtime_started_at = NULL, updated_at = v_now
  WHERE id = p_assignment_id;

  UPDATE dealer_attendance
  SET overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
      priority_break_flag = false,
      last_released_at = v_now
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    UPDATE dealer_attendance SET current_state = 'on_break', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;

    -- ── PATCH I (C) ─────────────────────────────────────────────────────────
    -- Create the break tracking row (mirrors execute_pre_assigned_swing [7b]).
    -- Without it the dealer is on_break with NO dealer_breaks row, invisible to
    -- end_expired_breaks AND detect_stuck_breaks (both are driven by open rows),
    -- so the break never auto-ends.
    -- PR3-D: capture the new row id so a race-lost rollback can delete exactly it.
    -- ────────────────────────────────────────────────────────────────────────
    INSERT INTO dealer_breaks (
      assignment_id, break_start, expected_duration_minutes, reason, created_at
    ) VALUES (
      p_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now
    )
    RETURNING id INTO v_created_break_id;
  ELSE
    UPDATE dealer_attendance SET current_state = 'available', worked_minutes_since_last_break = 0
    WHERE id = v_old_attendance_id;
  END IF;

  -- ── PATCH I (A) — port of PATCH G Fix A ───────────────────────────────────
  -- Release any stale ACTIVE on_break row of the incoming dealer before INSERT.
  -- These rows are produced when a dealer is sent to break (assignment kept
  -- on_break without released_at) and later returns to the pool via
  -- end_expired_breaks, which flips attendance only. The row sits inside
  -- idx_one_active_per_dealer and would collide with the INSERT below.
  -- 0-row UPDATE when no stale row exists (non-destructive).
  -- ───────────────────────────────────────────────────────────────────────────
  UPDATE dealer_assignments
  SET
    status      = 'completed',
    released_at = v_now,
    updated_at  = v_now
  WHERE attendance_id = p_next_attendance_id
    AND status        = 'on_break'
    AND released_at   IS NULL;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id, v_table_id, v_club_id, 'assigned', v_now, 1, v_compensated_due_at
  )
  -- ── PATCH I (B) — port of PATCH G Fix B ───────────────────────────────────
  -- Predicate now exactly matches idx_one_active_per_dealer, so a residual
  -- 'on_break' conflict routes through DO NOTHING (→ clean race_lost rollback
  -- below) instead of raising duplicate-key.
  -- ───────────────────────────────────────────────────────────────────────────
  ON CONFLICT (attendance_id)
  WHERE (released_at IS NULL AND status IN ('assigned', 'on_break'))
  DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments SET status = 'assigned', version = version + 1, released_at = NULL,
      swing_processed_at = NULL, updated_at = v_now
    WHERE id = p_assignment_id;
    -- PR3-C: restore the OUTGOING dealer's attendance markers to the captured
    -- pre-release snapshot (was: only current_state/priority_break_flag-guess/
    -- overtime arithmetic — missed last_released_at + worked_minutes_since_last_break,
    -- wrongly resting the dealer for 13 min). check_in_time / pool_entered_at /
    -- total_worked_minutes_today are NOT touched by this overload, so not restored.
    UPDATE dealer_attendance
    SET current_state                   = 'assigned',
        last_released_at                = v_prev_last_released,
        worked_minutes_since_last_break = v_prev_worked_since_break,
        priority_break_flag             = v_prev_priority_break,
        overtime_minutes                = v_prev_overtime_minutes
    WHERE id = v_old_attendance_id;
    -- PR3-D: delete the break row this transaction just created (send-to-break path)
    -- so the rolled-back swing leaves no open break for a dealer restored to 'assigned'.
    -- Scoped by the captured id → only this row; NULL id (no break created) → 0 rows;
    -- break_end IS NULL guard never matches a historical/closed break.
    DELETE FROM dealer_breaks WHERE id = v_created_break_id AND break_end IS NULL;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  UPDATE dealer_attendance SET current_state = 'assigned',
    total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0)
  WHERE id = p_next_attendance_id;

  RETURN jsonb_build_object('outcome', 'swung', 'new_assignment_id', v_new_assignment_id,
    'ot_minutes', v_ot_minutes, 'comp_break_minutes', v_comp_break,
    'old_dealer_on_break', p_send_to_break,
    'next_dealer_was_on_break', (v_next_dealer_state = 'on_break'),
    'compensated_swing_due_at', v_compensated_due_at,
    'rest_deficit_minutes', v_rest_deficit_min);

-- ── PATCH I (D) ───────────────────────────────────────────────────────────────
-- Structured error outcome instead of a raw DB error. Preserves this function's
-- existing 'outcome'-keyed return shape; the edge function already handles any
-- outcome != 'swung' without crashing (logs + metrics).
-- ──────────────────────────────────────────────────────────────────────────────
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'outcome',  'error',
    'detail',   SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$function$;
