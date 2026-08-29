-- ═══════════════════════════════════════════════════════════════════════════════
-- PATCH G: Fix execute_pre_assigned_swing duplicate-key race
--          on idx_one_active_per_dealer
--
-- Target: OID 167555
--   execute_pre_assigned_swing(
--     p_old_assignment_id      uuid,
--     p_next_attendance_id     uuid,
--     p_swing_due_at           timestamptz,
--     p_duration_minutes       integer,
--     p_send_to_break          boolean,          ← boolean 5th, integer 6th
--     p_break_duration_minutes integer
--   )
--   This is the only overload called by execute_pre_assigned_swing_rpc wrapper.
--   Migration 20260801000007 confirmed the wrapper routes to this exact signature.
--
-- Bug A — ON CONFLICT predicate mismatch
--   Unique index:
--     CREATE UNIQUE INDEX idx_one_active_per_dealer ON dealer_assignments (attendance_id)
--     WHERE (released_at IS NULL AND status IN ('assigned', 'on_break'));
--   Step [8] INSERT used:
--     ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
--   → Predicate mismatch: DO NOTHING did not fire for 'on_break' conflicts.
--   → EXCEPTION WHEN OTHERS caught the duplicate-key, returned {status:'error'}.
--   → Edge function default: branch fired → swing lost, no fallback.
--
-- Bug B — Stale on_break assignment row for incoming dealer
--   execute_pre_assigned_swing step [6] sets the outgoing dealer's assignment to
--   status='on_break' but does NOT set released_at. That row stays in the unique
--   index. When that dealer later returns from break, end_expired_breaks updates
--   dealer_attendance.current_state='available' but never releases the
--   dealer_assignments row. The next time this dealer is swung in as the incoming
--   dealer, step [8] INSERT conflicts with their own stale on_break row (Bug A fires).
--
-- Fix A (new step [7c]): Release incoming dealer's stale on_break assignment row
--   immediately before step [8] INSERT, after the CAS at step [3] has locked the
--   dealer's attendance state. Safe: 0-row UPDATE if no stale row exists.
--
-- Fix B (step [8] ON CONFLICT): Match the predicate exactly to the live index:
--   ON CONFLICT (attendance_id)
--     WHERE (released_at IS NULL AND status IN ('assigned', 'on_break'))
--   DO NOTHING
--
-- Not changed: schema, indexes, signature, _rpc wrapper, Overload 1, Overload 3,
--              perform_swing, any other function.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id      UUID,
  p_next_attendance_id     UUID,
  p_swing_due_at           TIMESTAMPTZ,
  p_duration_minutes       INTEGER,
  p_send_to_break          BOOLEAN,
  p_break_duration_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- [3] CAS: transition incoming dealer attendance pre_assigned → assigned.
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

  -- [6] Close old assignment.
  UPDATE dealer_assignments
  SET
    status                     = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
    pre_assigned_attendance_id = NULL,
    pre_assigned_at            = NULL,
    swing_processed_at         = v_now,
    overtime_started_at        = NULL,
    updated_at                 = v_now
  WHERE id = p_old_assignment_id;

  -- [7] Release outgoing dealer attendance + accumulate OT.
  UPDATE dealer_attendance
  SET
    current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag         = false,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
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

  -- ── PATCH G Fix A ─────────────────────────────────────────────────────────
  -- [7c] Release stale on_break dealer_assignments row for the incoming dealer.
  --
  -- Why this stale row exists:
  --   Step [6] above sets the OUTGOING dealer's assignment to status='on_break'
  --   but does NOT set released_at. When that dealer later returns from break,
  --   end_expired_breaks / complete_dealer_break update dealer_attendance.current_state
  --   to 'available' but never touch dealer_assignments. The row sits in the unique
  --   index (released_at IS NULL, status='on_break') indefinitely.
  --   The next time this dealer is swung in as the INCOMING dealer, the INSERT at
  --   step [8] conflicts with their own stale row → EXCEPTION → swing lost.
  --
  -- Why this UPDATE is safe here:
  --   Step [3] CAS above already transitioned the incoming dealer's attendance to
  --   'assigned' (holding a row lock). No concurrent swing can be executing for
  --   this dealer at the same moment. The UPDATE below affects 0 rows when there
  --   is no stale row (non-destructive).
  -- ──────────────────────────────────────────────────────────────────────────
  UPDATE dealer_assignments
  SET
    status      = 'completed',
    released_at = v_now,
    updated_at  = v_now
  WHERE attendance_id = p_next_attendance_id
    AND status        = 'on_break'
    AND released_at   IS NULL;

  -- [8] Create new assignment for incoming dealer.
  -- ── PATCH G Fix B ─────────────────────────────────────────────────────────
  -- ON CONFLICT predicate corrected to exactly match idx_one_active_per_dealer:
  --   WHERE (released_at IS NULL AND status IN ('assigned', 'on_break'))
  --
  -- Previous predicate was WHERE (status = 'assigned'), which is a strict subset
  -- of the index predicate. PostgreSQL could not route 'on_break' conflicts through
  -- DO NOTHING, so they surfaced as duplicate-key exceptions caught by EXCEPTION
  -- WHEN OTHERS → {status:'error'} → swing lost with no fallback.
  --
  -- With Fix A above the incoming dealer will never have an on_break stale row
  -- at this point. Fix B is a defence-in-depth backstop for any residual race
  -- or future code path that might bypass Fix A.
  -- ──────────────────────────────────────────────────────────────────────────
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
      )
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
  UPDATE dealer_attendance
  SET
    current_state               = 'assigned',
    pre_assigned_table_id       = NULL,
    pre_assigned_at             = NULL,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
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
$$;

GRANT EXECUTE ON FUNCTION public.execute_pre_assigned_swing(
  UUID, UUID, TIMESTAMPTZ, INTEGER, BOOLEAN, INTEGER
) TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN
--
-- This migration only uses CREATE OR REPLACE FUNCTION — no DDL is irreversible.
-- To revert, create a new migration (do not edit this file) and paste the
-- previous function body obtained from the pre-apply snapshot:
--
--   SELECT pg_get_functiondef(167555::oid);   -- run BEFORE applying this migration
--
-- Then wrap the output in BEGIN; ... COMMIT; and execute via the Management API.
-- ═══════════════════════════════════════════════════════════════════════════════
