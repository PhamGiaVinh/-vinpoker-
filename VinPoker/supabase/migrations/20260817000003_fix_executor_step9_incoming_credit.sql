-- ============================================================================
-- DEALER SWING — EXECUTOR STEP [9] FIX: stop crediting the OUTGOING dealer's
-- worked minutes to the INCOMING dealer
--
-- Bug (confirmed in 20260814000000, step [9]):
--   total_worked_minutes_today = COALESCE(total_worked_minutes_today,0)
--                                + v_actual_worked_min
--   v_actual_worked_min is the OUTGOING dealer's worked minutes (computed in
--   step [5] from the OLD attendance's last break end / check-in). Step [7]
--   already credits it to the outgoing dealer (correct). Adding the same
--   value to the INCOMING dealer inflates that dealer's fairness counter
--   (total_worked_minutes_today feeds heavy-worker penalties in dealer
--   selection) and double-counts once the incoming dealer is later released
--   by a future step [7].
--
-- History / intent verification:
--   * 20260701000000 introduced total_worked_minutes_today with a documented
--     update policy ("new dealer assigned: += actual worked minutes (from
--     check-in/last break)") and step [9] computed v_new_worked from the
--     INCOMING dealer's OWN anchors (p_next_attendance_id).
--   * 20260715000002 collapsed that block and substituted the outgoing
--     dealer's v_actual_worked_min — the regression. Carried forward through
--     the live snapshots (oid167555) into the canonical 20260814000000.
--   * Fix: remove the credit entirely. The incoming dealer's worked minutes
--     accumulate at their OWN release (their future swing's step [7]),
--     matching how every other assignment-start path behaves (mass-assign /
--     assign_dealer_to_table / reconcile_dealer_room_state credit nothing at
--     assignment start). Restoring the 20260701000000 "own-anchor" credit was
--     deliberately NOT done: it counted pool-idle time as worked time.
--
-- Scope: recreates public.execute_pre_assigned_swing(uuid, uuid,
--   timestamptz, integer, boolean, integer) byte-identical to 20260814000000
--   EXCEPT step [9] no longer writes total_worked_minutes_today.
--   total_worked_minutes_today is an operational fairness field, NOT payroll
--   (payroll reads check_in_time / check_out_time / overtime_minutes only).
--
-- SOURCE-ONLY: do NOT apply live without owner approval (manual-gated).
-- Rollback: re-run section [B] of
--   20260814000000_idle_fix_canonical_executor_release_bookkeeping.sql
--   (or docs/emergency_rollbacks IDLE_FIX snapshots for the pre-canonical
--   definition).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id     uuid,
  p_next_attendance_id    uuid,
  p_swing_due_at          timestamp with time zone,
  p_duration_minutes      integer,
  p_send_to_break         boolean,
  p_break_duration_minutes integer
)
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
  -- to the INCOMING dealer's total_worked_minutes_today — inflating the
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
$function$;
