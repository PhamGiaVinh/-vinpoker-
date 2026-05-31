-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Clear priority_break_flag in two missing places
--
-- Root cause: priority_break_flag was only cleared when the OT dealer was
-- successfully swung out (inside perform_swing). Two places missed the clear:
--
--  1. endExpiredBreaks: after a dealer's break expires and they return to
--     'available', the priority_break_flag should be cleared. Without this,
--     a dealer who was sent on break with the flag set will carry it forever
--     and get excluded from normal pickNextDealer on every subsequent cycle.
--
--  2. perform_swing (incoming dealer): when a dealer with priority_break_flag
--     is assigned via desperate fallback (Level 2/3), the flag must be cleared
--     so they're not permanently stuck in "needs break" territory.
--
-- See also: process-swing index.ts three-level desperate fallback logic.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Fix 1: Clear flag when dealer returns from expired break ──────────────
CREATE OR REPLACE FUNCTION public.end_expired_breaks(p_club_id UUID DEFAULT NULL)
RETURNS TABLE(
  attendance_id UUID,
  dealer_name TEXT,
  break_start TIMESTAMPTZ,
  expected_duration_minutes INT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT DISTINCT ON (da.id)
      da.id AS att_id,
      d.full_name AS d_name,
      db.break_start AS br_start,
      db.expected_duration_minutes AS exp_min
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    JOIN dealer_assignments dass ON dass.attendance_id = da.id
    JOIN dealer_breaks db ON db.assignment_id = dass.id
    WHERE da.current_state = 'on_break'
      AND da.status = 'checked_in'
      AND db.break_end IS NULL
      AND NOW() > db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
    ORDER BY da.id, db.break_start DESC
  )
  UPDATE dealer_attendance da
  SET current_state = 'available',
      priority_break_flag = false,
      worked_minutes_since_last_break = 0
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING
    da.id,
    expired.d_name,
    expired.br_start,
    expired.exp_min;
END;
$$;

-- ── Fix 2: Clear flag on incoming dealer when assigned via desperate fallback ──
-- The existing perform_swing already clears priority_break_flag for the outgoing
-- (OT) dealer. This adds the clear for the incoming dealer too.
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
    v_assigned_at        TIMESTAMPTZ;
    v_actual_worked_min  INT;
    v_table_duration     INT;
BEGIN
    -- Resolve table-specific swing_duration BEFORE computing swing_due_at
    v_table_duration := get_table_swing_duration(
        (SELECT table_id FROM dealer_assignments WHERE id = p_assignment_id)
    );

    v_swing_due_at := COALESCE(
        v_now + (v_table_duration || ' minutes')::INTERVAL,
        p_swing_due_at,
        v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL
    );

    -- Load + lock assignment row in one shot
    SELECT
        da.attendance_id,
        da.table_id,
        da.version,
        da.overtime_started_at,
        da.assigned_at,
        gt.club_id
    INTO
        v_old_attendance_id,
        v_table_id,
        v_current_version,
        v_ot_started_at,
        v_assigned_at,
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

    -- No dealer available: start or continue OT tracking
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
            'outcome',           'no_dealer',
            'is_new_overtime',   v_is_new_ot,
            'overtime_started_at', COALESCE(v_ot_started_at, v_now)
        );
    END IF;

    -- Dealer found: execute swing with compensatory break if OT
    IF v_ot_started_at IS NOT NULL THEN
        v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60);
        v_comp_break := LEAST(p_break_duration_minutes + (v_ot_minutes / 2), 60);
    ELSE
        v_ot_minutes := 0;
        v_comp_break := p_break_duration_minutes;
    END IF;

    v_actual_worked_min := GREATEST(0, EXTRACT(EPOCH FROM (v_now - COALESCE(v_assigned_at, v_now)))::INT / 60);

    -- Release old assignment
    UPDATE dealer_assignments
    SET status             = 'completed',
        swing_processed_at = v_now,
        released_at        = v_now,
        overtime_started_at = NULL,
        version            = version + 1
    WHERE id = p_assignment_id;

    -- Update old dealer: accumulate OT + clear priority flag + total_worked
    UPDATE dealer_attendance
    SET overtime_minutes            = overtime_minutes + v_ot_minutes,
        priority_break_flag         = false,
        total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
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

    -- Create new assignment with table-specific swing_due_at
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
            overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes),
            total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
        WHERE id = v_old_attendance_id;
        RETURN jsonb_build_object('outcome', 'race_lost');
    END IF;

    -- Update new dealer state + total_worked tracking
    -- Clear priority_break_flag in case dealer was picked via desperate fallback
    UPDATE dealer_attendance
    SET current_state = 'assigned',
        priority_break_flag = false,
        total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
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
        'outcome',               'swung',
        'new_assignment_id',     v_new_assignment_id,
        'ot_minutes',            v_ot_minutes,
        'comp_break_minutes',    v_comp_break,
        'old_dealer_on_break',   p_send_to_break
    );
END;
$function$;

-- Step 3: Verify both functions exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'end_expired_breaks'
  ) THEN
    RAISE EXCEPTION 'end_expired_breaks function not found after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'perform_swing'
  ) THEN
    RAISE EXCEPTION 'perform_swing function not found after migration';
  END IF;
END $$;
