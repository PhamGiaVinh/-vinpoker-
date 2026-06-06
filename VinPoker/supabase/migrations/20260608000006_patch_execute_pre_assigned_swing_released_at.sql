-- ════════════════════════════════════════════════════════════════════════════
-- Migration 20260608000006_patch_execute_pre_assigned_swing_released_at.sql
--
-- BUG FIX (part 2 of 2): Bàn 10 fix is not enforcing 10-min rest in production.
--
-- Root cause: migration 20260801000003_rpc_pre_assign_cleanup.sql rewrote
--   execute_pre_assigned_swing [6] UPDATE without setting `released_at`.
--   Both pre_assign_next_dealer_for_table (RPC) and dealer_shift_metrics (view)
--   query dealer_assignments.released_at to compute rest time. With that
--   column permanently NULL, the 10-min guard never fires.
--
-- Fix: DROP + CREATE the function with `released_at = v_now` and
--   `version = version + 1` added to the [6] UPDATE.
--
-- Companion migration: 20260608000005_backfill_released_at_from_swing_processed
--   (data backfill of historical rows).
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.execute_pre_assigned_swing(
  p_old_assignment_id uuid,
  p_next_attendance_id uuid,
  p_swing_due_at timestamptz,
  p_duration_minutes integer,
  p_send_to_break boolean,
  p_break_duration_minutes integer
);

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id uuid,
  p_next_attendance_id uuid,
  p_swing_due_at timestamptz,
  p_duration_minutes integer,
  p_send_to_break boolean,
  p_break_duration_minutes integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now               TIMESTAMPTZ := NOW();
  v_club_id           UUID;
  v_table_id          UUID;
  v_old_attendance_id UUID;
  v_new_assignment_id UUID;
  v_rows_updated      INT;
  v_actual_worked_min INT;
  v_last_break_end    TIMESTAMPTZ;
  v_check_in_time     TIMESTAMPTZ;
  v_incoming_name     TEXT;
  v_old_overtime_min  INT;
  v_ot_minutes        INT;
  v_overtime_started  TIMESTAMPTZ;
  v_comp_break        INT;
  v_base_break        INT;
  v_pre_assigned_at   TIMESTAMPTZ;
  v_pre_announce_min  INT;
  v_short_notice_bonus INT;
  v_compensated_due_at TIMESTAMPTZ;
BEGIN
  RAISE DEBUG '[execute_pre_assigned_swing] invoked: p_next=% p_old_assign=%',
    p_next_attendance_id, p_old_assignment_id;

  IF p_old_assignment_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_old_assignment_id is null');
  END IF;
  IF p_next_attendance_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_next_attendance_id is null');
  END IF;
  IF p_swing_due_at IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_swing_due_at is null');
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_duration_minutes must be > 0');
  END IF;

  SELECT gt.club_id, da.table_id, da.attendance_id, da.overtime_started_at, da.pre_assigned_at
  INTO v_club_id, v_table_id, v_old_attendance_id, v_overtime_started, v_pre_assigned_at
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_old_assignment_id AND da.status = 'assigned';

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED', 'detail', p_old_assignment_id);
  END IF;

  SELECT COALESCE(pre_announce_minutes, 5) INTO v_pre_announce_min
  FROM swing_config WHERE club_id = v_club_id LIMIT 1;

  v_short_notice_bonus := public.compute_short_notice_bonus_min(
    v_pre_assigned_at, p_swing_due_at, v_pre_announce_min
  );

  SELECT d.full_name INTO v_incoming_name
  FROM dealer_attendance datt JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  UPDATE dealer_attendance
  SET current_state = 'assigned', pre_assigned_table_id = NULL, pre_assigned_at = NULL
  WHERE id = p_next_attendance_id AND current_state = 'pre_assigned' AND status = 'checked_in';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
    WHERE id = p_old_assignment_id;
    UPDATE dealer_attendance
    SET current_state = 'available', pre_assigned_table_id = NULL, pre_assigned_at = NULL
    WHERE id = p_next_attendance_id AND current_state = 'pre_assigned';
    RETURN jsonb_build_object('status', 'race_lost', 'detail', 'Dealer ' || p_next_attendance_id || ' no longer pre_assigned or checked out', 'incoming_name', COALESCE(v_incoming_name, 'Unknown'));
  END IF;

  v_base_break := COALESCE(p_break_duration_minutes, 15);

  IF v_overtime_started IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_overtime_started))::INT / 60);
    SELECT overtime_minutes INTO v_old_overtime_min FROM dealer_attendance WHERE id = v_old_attendance_id;
    v_comp_break := LEAST(v_base_break + (v_ot_minutes / 2), GREATEST(v_base_break * 2, 30));
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  v_compensated_due_at := public.compute_compensated_swing_due_at(
    v_now, p_duration_minutes, v_ot_minutes
  );

  IF v_ot_minutes > 0 THEN
    INSERT INTO diagnostic_logs (club_id, diagnostic_type, result, metadata)
    VALUES (
      v_club_id, 'drift_compensation_applied',
      jsonb_build_object(
        'ot_minutes', v_ot_minutes,
        'compensation_minutes', v_ot_minutes / 2,
        'original_due_at', p_swing_due_at,
        'compensated_due_at', v_compensated_due_at
      ),
      jsonb_build_object(
        'old_assignment_id', p_old_assignment_id,
        'next_attendance_id', p_next_attendance_id
      )
    );
  END IF;

  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time FROM dealer_attendance WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  -- ════════════════════════════════════════════════════════════════════
  -- [6] Close old assignment
  -- BUG FIX 2026-06-06: add `released_at = v_now` and `version = version + 1`.
  --   The pre_assign_next_dealer_for_table RPC and dealer_shift_metrics view
  --   both query released_at to compute rest time. Without it, the 10-min
  --   soft rest guard is permanently bypassed (rest = NOW - check_in_time).
  -- ════════════════════════════════════════════════════════════════════
  UPDATE dealer_assignments
  SET status              = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
      version             = version + 1,
      released_at         = v_now,
      swing_processed_at  = v_now,
      overtime_started_at = NULL,
      updated_at          = v_now
  WHERE id = p_old_assignment_id;

  UPDATE dealer_attendance
  SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
      worked_minutes_since_last_break = 0,
      overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes + v_short_notice_bonus,
      priority_break_flag = false,
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at, idempotency_key
  ) VALUES (
    p_next_attendance_id, v_table_id, v_club_id, 'assigned', v_now, 1, v_compensated_due_at,
    'pre_assign_' || p_old_assignment_id
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET status = 'assigned', released_at = NULL, swing_processed_at = NULL, overtime_started_at = v_overtime_started, updated_at = v_now
    WHERE id = p_old_assignment_id;
    UPDATE dealer_attendance
    SET current_state = 'assigned',
        overtime_minutes = COALESCE(overtime_minutes, 0) - v_ot_minutes - v_short_notice_bonus,
        priority_break_flag = true,
        worked_minutes_since_last_break = 0,
        total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
    WHERE id = v_old_attendance_id;
    UPDATE dealer_attendance
    SET current_state = 'available', pre_assigned_table_id = NULL, pre_assigned_at = NULL
    WHERE id = p_next_attendance_id;
    RETURN jsonb_build_object('status', 'race_lost', 'detail', 'New dealer ' || p_next_attendance_id || ' was already assigned elsewhere', 'incoming_name', COALESCE(v_incoming_name, 'Unknown'), 'rollback', true);
  END IF;

  UPDATE dealer_attendance
  SET current_state = 'assigned', pre_assigned_table_id = NULL, pre_assigned_at = NULL,
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = p_next_attendance_id;

  INSERT INTO swing_log (assignment_id, outcome, club_id, table_id, triggered_by, metadata)
  VALUES (
    p_old_assignment_id, 'swung', v_club_id, v_table_id, 'system',
    jsonb_build_object(
      'type', 'pre_assigned_swing',
      'new_assignment_id', v_new_assignment_id,
      'incoming_attendance_id', p_next_attendance_id,
      'outgoing_attendance_id', v_old_attendance_id,
      'incoming_name', v_incoming_name,
      'ot_minutes', v_ot_minutes,
      'short_notice_bonus_min', v_short_notice_bonus,
      'pre_assigned_at', v_pre_assigned_at,
      'swing_due_at', p_swing_due_at,
      'pre_announce_min', v_pre_announce_min,
      'comp_break_minutes', v_comp_break,
      'old_dealer_on_break', p_send_to_break,
      'compensated_swing_due_at', v_compensated_due_at
    ));

  RETURN jsonb_build_object(
    'status', 'success',
    'new_assignment_id', v_new_assignment_id,
    'incoming_name', v_incoming_name,
    'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes', v_comp_break,
    'ot_minutes', v_ot_minutes,
    'short_notice_bonus_min', v_short_notice_bonus,
    'compensated_swing_due_at', v_compensated_due_at
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id uuid,
  p_next_attendance_id uuid,
  p_swing_due_at timestamptz,
  p_duration_minutes integer,
  p_send_to_break boolean,
  p_break_duration_minutes integer
) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- Verify: confirm released_at = v_now is in the new function source
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_src TEXT;
  v_has_released BOOLEAN;
  v_has_version  BOOLEAN;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'execute_pre_assigned_swing'
  LIMIT 1;

  v_has_released := v_src LIKE '%released_at% = v_now%';
  v_has_version  := v_src LIKE '%version% = version + 1%';

  IF NOT v_has_released THEN
    RAISE EXCEPTION 'Patch verification FAILED: released_at = v_now not found in function body';
  END IF;
  IF NOT v_has_version THEN
    RAISE EXCEPTION 'Patch verification FAILED: version = version + 1 not found in function body';
  END IF;

  RAISE NOTICE 'Patch verification OK: released_at = v_now and version = version + 1 present';
END $$;
