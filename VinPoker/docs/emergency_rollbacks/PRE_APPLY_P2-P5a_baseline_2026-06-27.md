# Pre-apply baseline — dealer feature/final P2→P5a controlled apply

> Read-only `pg_get_functiondef` + grants snapshot captured BEFORE the owner-gated apply (LIVE_DB_RULES P1-B). Live ref `orlesggcjamwuknxwcpk`. Rollback target if the apply must be undone.

- **as_of:** 2026-06-27T14:49:42.517437+07:00
- **feature objects present (must be all absent pre-apply):** `{"dealer_table_profiles": false, "dealer_override_claims": false, "trigger": false, "kill_switch": null}`
- **dealer_assignments grants (the no-REVOKE baseline — apply must NOT change these):**
  - `anon` = DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
  - `authenticated` = DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
  - `postgres` = DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
  - `service_role` = DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

## Rollback target — `assign_dealer_to_table` (current live 7-param; restore this body if rolling back P4/P5a)

### `assign_dealer_to_table(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,text,boolean)`
```sql
CREATE OR REPLACE FUNCTION public.assign_dealer_to_table(p_attendance_id uuid, p_table_id uuid, p_assigned_at timestamp with time zone DEFAULT now(), p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_force_replace boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_assignment_id    UUID;
  v_orphan_count     INT := 0;
  v_now              TIMESTAMPTZ := NOW();
  v_resolved_club_id UUID;
BEGIN
  -- STEP 0: Idempotency check â€” BEFORE any side effects
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_assignment_id
    FROM dealer_assignments
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_assignment_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'outcome', 'ok',
        'assignment_id', v_assignment_id,
        'orphan_count', 0,
        'idempotent', true
      );
    END IF;
  END IF;

  -- STEP 1: Lock attendance row (dealer must be available and checked in)
  PERFORM id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'detail', 'Dealer not available or locked');
  END IF;

  -- STEP 2: Check table is not already occupied (skip if p_force_replace)
  IF NOT p_force_replace AND EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'table_occupied', 'detail', 'Table already has an active dealer');
  END IF;

  -- STEP 3: Release existing assignment at target table
  -- (has effect when p_force_replace bypassed Step 2, or for stale data cleanup)
  WITH released AS (
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'displaced_by_new_assignment'
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
    RETURNING attendance_id
  )
  UPDATE dealer_attendance
  SET current_state = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
  WHERE id IN (SELECT attendance_id FROM released)
    AND current_state IN ('assigned', 'on_break');

  -- STEP 4: Release orphan assignments for this dealer at OTHER tables
  SELECT COUNT(*) INTO v_orphan_count
  FROM dealer_assignments
  WHERE attendance_id = p_attendance_id
    AND status IN ('assigned', 'on_break')
    AND table_id != p_table_id
    AND released_at IS NULL;

  IF v_orphan_count > 0 THEN
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'force_release_before_reassign'
    WHERE attendance_id = p_attendance_id
      AND status IN ('assigned', 'on_break')
      AND table_id != p_table_id
      AND released_at IS NULL;

    RAISE NOTICE '[assign_dealer_to_table] Released % orphan assignment(s) for attendance %',
      v_orphan_count, p_attendance_id;
  END IF;

  -- STEP 5: Clear stale needs_replacement flag
  UPDATE dealer_assignments
  SET needs_replacement = false
  WHERE table_id = p_table_id
    AND needs_replacement = true;

  -- STEP 6: Resolve club_id
  IF p_club_id IS NOT NULL THEN
    v_resolved_club_id := p_club_id;
  ELSE
    SELECT club_id INTO v_resolved_club_id
    FROM game_tables
    WHERE id = p_table_id;
  END IF;

  -- STEP 7: Insert new assignment
  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status,
    assigned_at, swing_due_at, idempotency_key
  ) VALUES (
    p_attendance_id, p_table_id, v_resolved_club_id, 'assigned',
    p_assigned_at, p_swing_due_at, p_idempotency_key
  ) RETURNING id INTO v_assignment_id;

  -- STEP 8: Update dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'assignment_id', v_assignment_id,
    'orphan_count', v_orphan_count
  );
END;
$function$

```

## Behavioral baseline — seat-writers the trigger runs alongside (NOT modified by the apply)

### `perform_swing(uuid,uuid,boolean,integer,text)`
```sql
CREATE OR REPLACE FUNCTION public.perform_swing(p_assignment_id uuid, p_next_attendance_id uuid, p_send_to_break boolean DEFAULT false, p_break_duration_minutes integer DEFAULT NULL::integer, p_reason text DEFAULT 'auto_swing'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment RECORD;
  v_table_id UUID;
  v_club_id UUID;
  v_old_attendance_id UUID;
  v_old_dealer_id UUID;
  v_old_dealer_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_actual_worked_min INT := 0;
  v_ot_minutes INT := 0;
  v_comp_break INT;
  v_swing_duration_min INT := 45;
  v_next_swing_due_at TIMESTAMPTZ;
  v_next_assignment_id UUID;
BEGIN
  SELECT a.id, a.table_id, a.club_id, a.attendance_id,
      a.dealer_id, a.duration_minutes, a.overtime_started_at,
      da.dealers->>'full_name' AS dealer_name
  INTO v_assignment
  FROM dealer_assignments a
  JOIN dealer_attendance da ON da.id = a.attendance_id
  WHERE a.id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assignment_not_found');
  END IF;

  v_table_id := v_assignment.table_id;
  v_club_id := v_assignment.club_id;
  v_old_attendance_id := v_assignment.attendance_id;
  v_old_dealer_id := v_assignment.dealer_id;
  v_old_dealer_name := v_assignment.dealer_name;

  v_actual_worked_min := COALESCE(
    EXTRACT(EPOCH FROM (v_now - v_assignment.assigned_at)) / 60, 0
  )::INT;

  IF v_assignment.overtime_started_at IS NOT NULL THEN
    v_ot_minutes := COALESCE(
      EXTRACT(EPOCH FROM (v_now - v_assignment.overtime_started_at)) / 60, 0
    )::INT;
  END IF;

  UPDATE dealer_assignments
  SET status = 'completed',
    released_at = v_now,
    swing_processed_at = v_now,
    overtime_started_at = NULL,
    updated_at = v_now
  WHERE id = p_assignment_id;

  UPDATE dealer_attendance
  SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag = false,
    total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    last_released_at = v_now,
    pool_entered_at = v_now,
    updated_at = v_now
  WHERE id = v_old_attendance_id;

  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  SELECT COALESCE(swing_duration_minutes, 45),
    COALESCE(min_duration_minutes, 20),
    COALESCE(max_duration_minutes, 60),
    COALESCE(base_duration_minutes, 30),
    COALESCE(auto_adjust_duration, false),
    COALESCE(target_ratio::NUMERIC, 1.2)
  INTO v_swing_duration_min, v_comp_break, v_comp_break, v_comp_break, v_comp_break, v_comp_break
  FROM swing_config
  WHERE club_id = v_club_id AND table_type = 'tournament'
  LIMIT 1;

  v_swing_duration_min := COALESCE(v_swing_duration_min, 45);
  v_next_swing_due_at := v_now + (v_swing_duration_min || ' minutes')::INTERVAL;

  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status, assigned_at, version, swing_due_at
  ) VALUES (
    p_next_attendance_id,
    v_table_id,
    v_club_id,
    'assigned',
    v_now,
    1,
    v_next_swing_due_at
  ) RETURNING id INTO v_next_assignment_id;

  UPDATE dealer_attendance
  SET current_state = 'assigned',
    updated_at = v_now
  WHERE id = p_next_attendance_id;

  RETURN jsonb_build_object(
    'ok', true,
    'old_attendance_id', v_old_attendance_id,
    'new_assignment_id', v_next_assignment_id,
    'worked_minutes', v_actual_worked_min,
    'ot_minutes', v_ot_minutes,
    'sent_to_break', p_send_to_break
  );
END;
$function$

```

### `perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)`
```sql
CREATE OR REPLACE FUNCTION public.perform_swing(p_assignment_id uuid, p_duration_minutes integer DEFAULT 30, p_send_to_break boolean DEFAULT false, p_break_duration_minutes integer DEFAULT 15, p_max_break_minutes integer DEFAULT 60, p_expected_version integer DEFAULT NULL::integer, p_next_attendance_id uuid DEFAULT NULL::uuid, p_rest_deficit_minutes integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF p_next_attendance_id IS NOT NULL THEN
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
    FOR UPDATE OF dat;

    IF NOT FOUND THEN
      v_next_attendance_id := NULL;
    END IF;
  END IF;

  IF v_next_attendance_id IS NULL AND v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id INTO v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id AND dat.current_state = 'pre_assigned'
    FOR UPDATE OF dat;
    IF NOT FOUND THEN v_next_attendance_id := NULL;
    END IF;
  END IF;

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
    FOR UPDATE OF dat SKIP LOCKED;

    IF NOT FOUND THEN
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

  SELECT current_state INTO v_next_dealer_state
  FROM dealer_attendance WHERE id = v_next_attendance_id;

  IF v_next_dealer_state = 'on_break' THEN
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

    UPDATE dealer_breaks
    SET break_end = NOW()
    WHERE assignment_id IN (
      SELECT id FROM dealer_assignments
      WHERE attendance_id = v_next_attendance_id
    )
    AND break_end IS NULL;
  END IF;

  SELECT public.perform_swing(
    p_assignment_id        := p_assignment_id,
    p_version              := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id   := v_next_attendance_id,
    p_send_to_break        := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes  := p_duration_minutes,
    p_swing_due_at         := NULL,
    p_rest_deficit_minutes := p_rest_deficit_minutes
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$function$

```

### `perform_swing(uuid,integer,uuid,boolean,integer,integer,timestamp with time zone,integer)`
```sql
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

    -- â”€â”€ PATCH I (C) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    -- Create the break tracking row (mirrors execute_pre_assigned_swing [7b]).
    -- Without it the dealer is on_break with NO dealer_breaks row, invisible to
    -- end_expired_breaks AND detect_stuck_breaks (both are driven by open rows),
    -- so the break never auto-ends.
    -- PR3-D: capture the new row id so a race-lost rollback can delete exactly it.
    -- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  -- â”€â”€ PATCH I (A) â€” port of PATCH G Fix A â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  -- Release any stale ACTIVE on_break row of the incoming dealer before INSERT.
  -- These rows are produced when a dealer is sent to break (assignment kept
  -- on_break without released_at) and later returns to the pool via
  -- end_expired_breaks, which flips attendance only. The row sits inside
  -- idx_one_active_per_dealer and would collide with the INSERT below.
  -- 0-row UPDATE when no stale row exists (non-destructive).
  -- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  -- â”€â”€ PATCH I (B) â€” port of PATCH G Fix B â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  -- Predicate now exactly matches idx_one_active_per_dealer, so a residual
  -- 'on_break' conflict routes through DO NOTHING (â†’ clean race_lost rollback
  -- below) instead of raising duplicate-key.
  -- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    -- overtime arithmetic â€” missed last_released_at + worked_minutes_since_last_break,
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
    -- Scoped by the captured id â†’ only this row; NULL id (no break created) â†’ 0 rows;
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

-- â”€â”€ PATCH I (D) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Structured error outcome instead of a raw DB error. Preserves this function's
-- existing 'outcome'-keyed return shape; the edge function already handles any
-- outcome != 'swung' without crashing (logs + metrics).
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'outcome',  'error',
    'detail',   SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$function$

```

### `execute_pre_assigned_swing(uuid,uuid,timestamp with time zone,integer,boolean,integer)`
```sql
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(p_old_assignment_id uuid, p_next_attendance_id uuid, p_swing_due_at timestamp with time zone, p_duration_minutes integer, p_send_to_break boolean, p_break_duration_minutes integer)
 RETURNS jsonb
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
  -- IDLE FIX: prior values of the outgoing dealer's release markers, captured
  -- so the race_lost rollback in [8b] can restore them exactly.
  v_prev_last_released TIMESTAMPTZ;
  v_prev_pool_entered  TIMESTAMPTZ;
BEGIN

  -- [1] Fetch old assignment + club/table/OT info.
  SELECT
    gt.club_id,
    da.table_id,
    da.attendance_id,
    da.overtime_started_at
  INTO
    v_club_id,
    v_table_id,
    v_old_attendance_id,
    v_overtime_started
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_old_assignment_id
    AND da.status = 'assigned';

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error',  'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED',
      'detail', p_old_assignment_id
    );
  END IF;

  -- [2] Resolve incoming dealer name.
  SELECT d.full_name
  INTO   v_incoming_name
  FROM   dealer_attendance datt
  JOIN   dealers d ON d.id = datt.dealer_id
  WHERE  datt.id = p_next_attendance_id;

  -- [3] CAS: transition incoming dealer attendance pre_assigned -> assigned.
  --     Returns 0 rows if dealer checked out or no longer pre_assigned.
  UPDATE dealer_attendance
  SET
    current_state         = 'assigned',
    pre_assigned_table_id = NULL,
    pre_assigned_at       = NULL
  WHERE id            = p_next_attendance_id
    AND current_state = 'pre_assigned'
    AND status        = 'checked_in';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL,
        pre_assigned_at            = NULL,
        updated_at                 = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET
      current_state         = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at       = NULL
    WHERE id            = p_next_attendance_id
      AND current_state = 'pre_assigned';

    RETURN jsonb_build_object(
      'status',        'race_lost',
      'detail',        'Dealer ' || p_next_attendance_id || ' no longer pre_assigned or checked out',
      'incoming_name', COALESCE(v_incoming_name, 'Unknown')
    );
  END IF;

  -- [4] Compute OT minutes + compensatory break duration.
  v_base_break := COALESCE(p_break_duration_minutes, 15);

  IF v_overtime_started IS NOT NULL THEN
    v_ot_minutes := GREATEST(
      0,
      EXTRACT(EPOCH FROM (v_now - v_overtime_started))::INT / 60
    );
    SELECT overtime_minutes INTO v_old_overtime_min
    FROM   dealer_attendance
    WHERE  id = v_old_attendance_id;
    v_comp_break := LEAST(
      v_base_break + (v_ot_minutes / 2),
      GREATEST(v_base_break * 2, 30)
    );
  ELSE
    v_ot_minutes := 0;
    v_comp_break := v_base_break;
  END IF;

  -- [5] Compute actual worked minutes for outgoing dealer.
  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM   dealer_breaks db
  JOIN   dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE  da2.attendance_id = v_old_attendance_id
    AND  db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time
  FROM   dealer_attendance
  WHERE  id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(
    0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  -- IDLE FIX: capture the outgoing dealer's current release markers for the
  -- [8b] rollback path before [6]/[7] overwrite them.
  SELECT last_released_at, pool_entered_at
  INTO   v_prev_last_released, v_prev_pool_entered
  FROM   dealer_attendance
  WHERE  id = v_old_attendance_id;

  -- [6] Close old assignment.
  -- IDLE FIX: released_at is now stamped here. This is the timestamp
  -- buildRotationSupply uses as the R1 rest anchor and the R3 prev-session
  -- boundary. It also drops the row out of idx_one_active_per_dealer
  -- (released_at IS NULL predicate), which prevents the stale on_break row
  -- problem that PATCH G Fix A ([7c] below) was written to clean up.
  UPDATE dealer_assignments
  SET
    status                     = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
    released_at                = v_now,
    pre_assigned_attendance_id = NULL,
    pre_assigned_at            = NULL,
    swing_processed_at         = v_now,
    overtime_started_at        = NULL,
    updated_at                 = v_now
  WHERE id = p_old_assignment_id;

  -- [7] Release outgoing dealer attendance + accumulate OT.
  -- IDLE FIX: last_released_at feeds the legacy inter-swing rest OR-gate in
  -- buildDealerCandidates; pool_entered_at feeds the 1-minute pool cooldown
  -- (both documented in pickNextDealer.ts but never written by this path).
  UPDATE dealer_attendance
  SET
    current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag         = false,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    last_released_at            = v_now,
    pool_entered_at             = v_now
  WHERE id = v_old_attendance_id;

  -- [7b] Open break record for outgoing dealer if going to break.
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (
      assignment_id,
      break_start,
      expected_duration_minutes,
      reason,
      created_at
    ) VALUES (
      p_old_assignment_id,
      v_now,
      v_comp_break,
      'auto_break_on_swing',
      v_now
    );
  END IF;

  -- -- PATCH G Fix A -----------------------------------------------------------
  -- [7c] Release stale on_break dealer_assignments row for the incoming dealer.
  --
  -- Historical context: before this migration, step [6] did NOT set
  -- released_at, so on_break rows lingered inside idx_one_active_per_dealer
  -- and conflicted with the step [8] INSERT the next time the dealer swung in.
  -- Step [6] now stamps released_at, so no NEW stale rows can form; this
  -- UPDATE remains as a backstop for rows created before this migration and
  -- for any future path that bypasses step [6]. Affects 0 rows when there is
  -- no stale row (non-destructive).
  -- ---------------------------------------------------------------------------
  UPDATE dealer_assignments
  SET
    status      = 'completed',
    released_at = v_now,
    updated_at  = v_now
  WHERE attendance_id = p_next_attendance_id
    AND status        = 'on_break'
    AND released_at   IS NULL;

  -- [8] Create new assignment for incoming dealer.
  -- -- PATCH G Fix B -----------------------------------------------------------
  -- ON CONFLICT predicate exactly matches idx_one_active_per_dealer:
  --   WHERE (released_at IS NULL AND status IN ('assigned', 'on_break'))
  -- Defence-in-depth backstop for any residual race that bypasses Fix A.
  -- ---------------------------------------------------------------------------
  INSERT INTO dealer_assignments (
    attendance_id,
    table_id,
    club_id,
    status,
    assigned_at,
    version,
    swing_due_at,
    idempotency_key
  ) VALUES (
    p_next_attendance_id,
    v_table_id,
    v_club_id,
    'assigned',
    v_now,
    1,
    p_swing_due_at,
    'pre_assign_' || p_old_assignment_id
  )
  ON CONFLICT (attendance_id)
    WHERE (released_at IS NULL AND status IN ('assigned', 'on_break'))
  DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  -- [8b] If INSERT was skipped by DO NOTHING: a concurrent swing beat us.
  --      Roll back all changes in this call and return race_lost so the caller
  --      can pick a different dealer.
  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET
      status              = 'assigned',
      released_at         = NULL,
      swing_processed_at  = NULL,
      overtime_started_at = v_overtime_started,
      updated_at          = v_now
    WHERE id = p_old_assignment_id;

    UPDATE dealer_attendance
    SET
      current_state               = 'assigned',
      overtime_minutes            = COALESCE(overtime_minutes, 0) - v_ot_minutes,
      priority_break_flag         = true,
      worked_minutes_since_last_break = 0,
      total_worked_minutes_today  = GREATEST(
        0,
        COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min
      ),
      last_released_at            = v_prev_last_released,
      pool_entered_at             = v_prev_pool_entered
    WHERE id = v_old_attendance_id;

    UPDATE dealer_attendance
    SET
      current_state         = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at       = NULL
    WHERE id = p_next_attendance_id;

    RETURN jsonb_build_object(
      'status',        'race_lost',
      'detail',        'New dealer ' || p_next_attendance_id || ' was already assigned elsewhere',
      'incoming_name', COALESCE(v_incoming_name, 'Unknown'),
      'rollback',      true
    );
  END IF;

  -- [9] Finalise incoming dealer attendance state.
  -- STEP-9 FIX (this migration): the previous version also added
  -- v_actual_worked_min (the OUTGOING dealer's worked minutes from step [5])
  -- to the INCOMING dealer's total_worked_minutes_today â€” inflating the
  -- incoming dealer's fairness counter and double-counting once they are
  -- later released by step [7] of their own swing. Their worked minutes
  -- accumulate at their OWN release; no credit belongs at assignment start.
  UPDATE dealer_attendance
  SET
    current_state               = 'assigned',
    pre_assigned_table_id       = NULL,
    pre_assigned_at             = NULL
  WHERE id = p_next_attendance_id;

  -- [10] Audit log.
  INSERT INTO swing_log (
    assignment_id,
    outcome,
    club_id,
    table_id,
    triggered_by,
    metadata
  ) VALUES (
    p_old_assignment_id,
    'swung',
    v_club_id,
    v_table_id,
    'system',
    jsonb_build_object(
      'type',                   'pre_assigned_swing',
      'new_assignment_id',      v_new_assignment_id,
      'incoming_attendance_id', p_next_attendance_id,
      'outgoing_attendance_id', v_old_attendance_id,
      'incoming_name',          v_incoming_name,
      'ot_minutes',             v_ot_minutes,
      'comp_break_minutes',     v_comp_break,
      'old_dealer_on_break',    p_send_to_break
    )
  );

  RETURN jsonb_build_object(
    'status',              'success',
    'new_assignment_id',   v_new_assignment_id,
    'incoming_name',       v_incoming_name,
    'old_dealer_on_break', p_send_to_break,
    'comp_break_minutes',  v_comp_break
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status',   'error',
    'error',    'UNHANDLED_EXCEPTION',
    'detail',   SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$function$

```
