-- ═══════════════════════════════════════════════════════════════════════════════
-- PATCH I: Port PATCH G active-dealer conflict safety into perform_swing
--
-- Target: OID 199044 (the INNER overload — the one that performs the swing)
--   perform_swing(p_assignment_id uuid, p_version integer, p_next_attendance_id uuid,
--                 p_send_to_break boolean, p_break_duration_minutes integer,
--                 p_swing_duration_minutes integer, p_swing_due_at timestamptz,
--                 p_rest_deficit_minutes integer)
--   Call chain: process-swing edge fn → perform_swing(p_duration_minutes,…) OID 199042
--   (dispatcher) → THIS overload. Overload 257642 is not reachable from the edge fn.
--
-- Why: PATCH G fixed the duplicate-key race on idx_one_active_per_dealer inside
--   execute_pre_assigned_swing (OID 167555) only. perform_swing — the fallback
--   path used for race_lost recovery, force-release replacement, and no-show
--   re-assignment — still had the full pre-G bug class:
--     Bug A: ON CONFLICT (attendance_id) WHERE (status = 'assigned') does not
--            match idx_one_active_per_dealer
--            (released_at IS NULL AND status IN ('assigned','on_break')),
--            so an 'on_break' conflict raises duplicate-key instead of DO NOTHING.
--     Bug B: no release of the incoming dealer's stale on_break row before INSERT.
--            end_expired_breaks flips attendance to 'available' without releasing
--            the dealer_assignments row, so stale rows recur continuously.
--     Plus: NO EXCEPTION handler — the duplicate-key propagated as a raw RPC
--            error to the edge function (swing lost, no structured outcome).
--   Audit 2026-06-11 found a live stale row (dealer "28", 44 min old) that would
--   have crashed this exact path; it was since cleared by 167555 step [7c].
--
-- Changes vs live body (the ONLY functional changes — see rollback snapshot
-- docs/emergency_rollbacks/PATCH_I_rollback_perform_swing_oid_199044.sql):
--   A. New step before the INSERT: release stale active on_break rows of
--      p_next_attendance_id (mirrors PATCH G Fix A / 167555 step [7c]).
--   B. ON CONFLICT predicate corrected to exactly match idx_one_active_per_dealer
--      (mirrors PATCH G Fix B).
--   C. When p_send_to_break = true: INSERT a dealer_breaks row (mirrors 167555
--      step [7b]) so end_expired_breaks / detect_stuck_breaks can see the break.
--      Previously the dealer went on_break with no tracking row → invisible to
--      both RPCs, stuck until manual intervention.
--   D. EXCEPTION WHEN OTHERS handler returning the function's existing
--      'outcome'-keyed JSON shape ({outcome:'error', detail, sqlstate}) so no
--      raw DB error ever propagates. Edge fn already treats outcome != 'swung'
--      as a non-success without crashing.
--
-- Not changed: signature, return keys on existing paths, dispatcher OID 199042,
--   wrapper, edge function, force-release block, no-show condition,
--   reconcile_dealer_states, any index/schema.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

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
    -- ────────────────────────────────────────────────────────────────────────
    INSERT INTO dealer_breaks (
      assignment_id, break_start, expected_duration_minutes, reason, created_at
    ) VALUES (
      p_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now
    );
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
    UPDATE dealer_attendance SET current_state = 'assigned',
        priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes)
    WHERE id = v_old_attendance_id;
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

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN
--   CREATE OR REPLACE FUNCTION only — no irreversible DDL, no grant changes.
--   To revert: run docs/emergency_rollbacks/PATCH_I_rollback_perform_swing_oid_199044.sql
--   (verbatim pre-apply live body) via the Management API. Do NOT edit this file.
-- ═══════════════════════════════════════════════════════════════════════════════
