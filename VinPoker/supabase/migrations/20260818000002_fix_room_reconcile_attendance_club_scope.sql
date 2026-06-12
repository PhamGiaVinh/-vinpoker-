-- ============================================================================
-- ROOM RECONCILE FIX: dealer_attendance club scope (P0 checked-in validation)
--
-- Bug found during the 33B controlled live apply of 20260817000002
-- (2026-06-13): the P0 "actual dealer must be checked in" check referenced
-- att.club_id, but the LIVE dealer_attendance table has no club_id column
-- (its ADD COLUMN lives in the never-applied 20260801..20260813 chain).
-- Every call that passes an actual_attendance_id failed with SQLSTATE 42703
-- (caught by the WHEN OTHERS handler -> outcome 'error', zero writes --
-- verified live: 0 corrections rows, 0 audit rows, assignment versions
-- unchanged).
--
-- Fix: scope the club check through dealers.club_id (verified live), via
-- JOIN dealers d ON d.id = att.dealer_id. Everything else is byte-identical
-- to the function body applied from 20260817000002.
--
-- SOURCE-ONLY: do NOT apply live without owner approval (manual-gated).
-- ACLs are preserved by CREATE OR REPLACE (REVOKE/GRANT from 20260817000002
-- remain in force: EXECUTE for authenticated + service_role only).
-- Rollback: re-run the function block of 20260817000002 (restores the buggy
-- but inert v1), or the full rollback in
-- docs/emergency_rollbacks/PRE_APPLY_20260817000002_room_reconcile.md.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reconcile_dealer_room_state(
  p_club_id        uuid,
  p_corrections    jsonb,
  p_effective_at   timestamptz,
  p_reason         text,
  p_displaced      jsonb   DEFAULT '[]'::jsonb,
  p_dry_run        boolean DEFAULT true,
  p_admin_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_is_admin        boolean;
  v_entry           jsonb;
  v_table_ids       uuid[] := '{}';
  v_actual_ids      uuid[] := '{}';
  v_all_att_ids     uuid[] := '{}';
  v_dealer_ids      uuid[] := '{}';
  v_tid             uuid;
  v_aid             uuid;
  v_before          jsonb;
  v_after           jsonb;
  v_plan            jsonb := '[]'::jsonb;
  v_conflicts       jsonb := '[]'::jsonb;
  v_displaced_out   jsonb := '[]'::jsonb;
  v_payroll_recon   jsonb := '[]'::jsonb;
  v_diff_tables     jsonb := '[]'::jsonb;
  v_cur             record;
  v_row             record;
  v_tbl             record;
  v_resolution      text;
  v_res_reason      text;
  v_correction_id   uuid := gen_random_uuid();
  v_now             timestamptz := now();
  v_rel_at          timestamptz;
  v_credit          int;
  v_duration        int;
  v_break_minutes   int;
  v_new_assignment  uuid;
  v_rowcount        int;
  v_released        int := 0;
  v_moved           int := 0;
  v_assigned        int := 0;
  v_superseded      int := 0;
  v_action          text;
  v_exp_assignment  uuid;
  v_exp_version     int;
  v_all_correct     boolean := true;
BEGIN
  -- ══ P0: gate + payload validation (NO locks taken yet) ════════════════════

  -- [0.1] Staff gate — convention copied verbatim from set_rotation_slot_dealer
  --       (service_role has auth.uid() IS NULL and passes via the grant).
  IF auth.uid() IS NOT NULL
     AND NOT public.is_club_dealer_control(auth.uid(), p_club_id)
     AND NOT public.is_club_admin(auth.uid(), p_club_id)
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role)
  THEN
    RETURN jsonb_build_object('outcome','forbidden');
  END IF;

  -- [0.2] Admin override requires club_admin or super_admin (dealer_control
  --       alone may not override). service_role (auth.uid() NULL) may.
  v_is_admin := auth.uid() IS NULL
    OR public.is_club_admin(auth.uid(), p_club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role);
  IF p_admin_override AND NOT v_is_admin THEN
    RETURN jsonb_build_object('outcome','override_forbidden');
  END IF;

  -- [0.3] Payload validation.
  IF p_corrections IS NULL OR jsonb_typeof(p_corrections) != 'array'
     OR jsonb_array_length(p_corrections) = 0 THEN
    RETURN jsonb_build_object('outcome','invalid_input',
      'detail','p_corrections must be a non-empty array');
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('outcome','invalid_input',
      'detail','reason is required (>= 5 chars)');
  END IF;
  IF p_displaced IS NULL OR jsonb_typeof(p_displaced) != 'array' THEN
    RETURN jsonb_build_object('outcome','invalid_input',
      'detail','p_displaced must be a jsonb array (may be empty)');
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_corrections) LOOP
    v_tid := (v_entry->>'table_id')::uuid;
    IF v_tid IS NULL THEN
      RETURN jsonb_build_object('outcome','invalid_input','detail','entry missing table_id');
    END IF;
    IF v_tid = ANY(v_table_ids) THEN
      RETURN jsonb_build_object('outcome','invalid_input',
        'detail','duplicate table_id in payload','table_id',v_tid);
    END IF;
    -- Table must belong to this club and be active.
    PERFORM 1 FROM game_tables gt
    WHERE gt.id = v_tid AND gt.club_id = p_club_id AND gt.status = 'active';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome','invalid_input',
        'detail','table not found, not active, or not in this club','table_id',v_tid);
    END IF;
    v_table_ids := v_table_ids || v_tid;

    v_aid := NULLIF(v_entry->>'actual_attendance_id','')::uuid;
    IF v_aid IS NOT NULL THEN
      IF v_aid = ANY(v_actual_ids) THEN
        RETURN jsonb_build_object('outcome','dealer_duplicate_in_payload',
          'attendance_id', v_aid,
          'detail','same dealer listed as actual at two tables');
      END IF;
      -- Actual dealer must be checked in to this club.
      -- FIX (20260818000002): dealer_attendance has NO club_id column live
      -- (its ADD COLUMN sits in the never-applied 20260801..20260813 chain) --
      -- scope through dealers.club_id instead.
      PERFORM 1 FROM dealer_attendance att
      JOIN dealers d ON d.id = att.dealer_id
      WHERE att.id = v_aid AND d.club_id = p_club_id AND att.status = 'checked_in';
      IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome','dealer_not_checked_in',
          'attendance_id', v_aid,
          'detail','actual dealer is not checked in to this club');
      END IF;
      v_actual_ids := v_actual_ids || v_aid;
    END IF;
  END LOOP;

  -- [0.4] effective_at payload-only gates. NOTE: effective_at_before_assignment
  --       is checked in P3 against actual assignment rows (under locks in
  --       apply mode) — NOT here from a stale no-lock read.
  IF p_effective_at IS NULL THEN
    RETURN jsonb_build_object('outcome','invalid_input','detail','effective_at is required');
  END IF;
  IF p_effective_at > v_now + interval '1 minute' THEN
    RETURN jsonb_build_object('outcome','effective_at_future');
  END IF;
  IF p_effective_at < v_now - interval '120 minutes' AND NOT p_admin_override THEN
    RETURN jsonb_build_object('outcome','effective_at_too_old','threshold_minutes',120);
  END IF;

  -- ══ P1: serialize + lock (APPLY ONLY — dry-run takes no locks) ════════════
  IF NOT p_dry_run THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('room_reconcile_' || p_club_id::text, 0));

    -- Lock order (family convention): schedule → assignments → attendance.
    PERFORM 1 FROM dealer_rotation_schedule
    WHERE table_id = ANY(v_table_ids) AND status IN ('predicted','announced')
    ORDER BY id FOR UPDATE;

    PERFORM 1 FROM dealer_assignments
    WHERE released_at IS NULL AND status IN ('assigned','on_break')
      AND (table_id = ANY(v_table_ids)
           OR attendance_id = ANY(v_actual_ids)
           OR pre_assigned_attendance_id = ANY(v_actual_ids))
    ORDER BY id FOR UPDATE;

    PERFORM 1 FROM dealer_attendance
    WHERE id IN (
      SELECT unnest(v_actual_ids)
      UNION
      SELECT a.attendance_id FROM dealer_assignments a
      WHERE a.released_at IS NULL AND a.status IN ('assigned','on_break')
        AND a.table_id = ANY(v_table_ids)
    )
    ORDER BY id FOR UPDATE;
  END IF;

  -- ══ P2: before-snapshot (payroll fields captured, NEVER written) ══════════
  SELECT array_agg(DISTINCT x) INTO v_all_att_ids FROM (
    SELECT unnest(v_actual_ids) AS x
    UNION
    SELECT a.attendance_id FROM dealer_assignments a
    WHERE a.released_at IS NULL AND a.status IN ('assigned','on_break')
      AND a.table_id = ANY(v_table_ids)
  ) s;
  v_all_att_ids := COALESCE(v_all_att_ids, '{}');

  v_before := jsonb_build_object(
    'assignments', COALESCE((
      SELECT jsonb_agg(to_jsonb(a)) FROM dealer_assignments a
      WHERE a.released_at IS NULL AND a.status IN ('assigned','on_break')
        AND (a.table_id = ANY(v_table_ids) OR a.attendance_id = ANY(v_all_att_ids))
    ), '[]'::jsonb),
    'attendance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', att.id, 'dealer_id', att.dealer_id, 'status', att.status,
        'current_state', att.current_state,
        'worked_minutes_since_last_break', att.worked_minutes_since_last_break,
        'total_worked_minutes_today', att.total_worked_minutes_today,
        'overtime_minutes', att.overtime_minutes,
        'last_released_at', att.last_released_at,
        'pool_entered_at', att.pool_entered_at,
        'pre_assigned_table_id', att.pre_assigned_table_id,
        'check_in_time', att.check_in_time, 'check_out_time', att.check_out_time
      )) FROM dealer_attendance att WHERE att.id = ANY(v_all_att_ids)
    ), '[]'::jsonb),
    'rotation_slots', COALESCE((
      SELECT jsonb_agg(to_jsonb(r)) FROM dealer_rotation_schedule r
      WHERE r.table_id = ANY(v_table_ids) AND r.status IN ('predicted','announced')
    ), '[]'::jsonb)
  );

  -- ══ P3: plan computation (pure reads; identical dry-run/apply) ════════════
  -- Per actual dealer X for table T:
  --   X active at T                      → already_correct
  --   X active at another SELECTED table → move (UPDATE table_id)
  --   X active at a NON-selected table   → BLOCKING dealer_active_elsewhere
  --   X not active anywhere              → assign (new row at effective_at)
  -- Every active row at a selected table whose dealer is not an actual
  -- anywhere → release; its dealer is displaced and needs a resolution.

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_corrections) LOOP
    v_tid := (v_entry->>'table_id')::uuid;
    v_aid := NULLIF(v_entry->>'actual_attendance_id','')::uuid;
    v_exp_assignment := NULLIF(v_entry->>'expected_assignment_id','')::uuid;
    v_exp_version    := NULLIF(v_entry->>'expected_version','')::int;

    -- Current active assignment at T (most recent if state is corrupt).
    SELECT a.*, gt.table_name INTO v_cur
    FROM dealer_assignments a JOIN game_tables gt ON gt.id = a.table_id
    WHERE a.table_id = v_tid AND a.released_at IS NULL
      AND a.status IN ('assigned','on_break')
    ORDER BY a.assigned_at DESC LIMIT 1;

    -- CAS echo from dry-run (optional, validated when provided).
    IF v_exp_assignment IS NOT NULL THEN
      IF v_cur.id IS DISTINCT FROM v_exp_assignment
         OR (v_exp_version IS NOT NULL AND v_cur.version IS DISTINCT FROM v_exp_version) THEN
        RETURN jsonb_build_object('outcome','race_lost',
          'detail','room state changed since preview','table_id',v_tid);
      END IF;
    END IF;

    IF v_aid IS NOT NULL AND v_cur.id IS NOT NULL AND v_cur.attendance_id = v_aid THEN
      v_action := 'already_correct';
    ELSIF v_aid IS NULL THEN
      IF v_cur.id IS NULL THEN
        v_action := 'already_correct';
      ELSIF COALESCE((v_entry->>'confirm_empty')::boolean, false) THEN
        v_action := 'release_only';
      ELSE
        v_conflicts := v_conflicts || jsonb_build_object(
          'type','empty_not_confirmed','table_id',v_tid);
        v_action := 'blocked';
      END IF;
    ELSE
      -- Where is X actually active right now (per system)?
      SELECT a.*, gt.table_name INTO v_row
      FROM dealer_assignments a JOIN game_tables gt ON gt.id = a.table_id
      WHERE a.attendance_id = v_aid AND a.released_at IS NULL
        AND a.status IN ('assigned','on_break')
      ORDER BY a.assigned_at DESC LIMIT 1;

      IF v_row.id IS NOT NULL AND v_row.table_id = ANY(v_table_ids) THEN
        v_action := 'move';
        -- effective_at sanity for the moved row is irrelevant (assigned_at
        -- preserved); nothing released here.
      ELSIF v_row.id IS NOT NULL THEN
        v_conflicts := v_conflicts || jsonb_build_object(
          'type','dealer_active_elsewhere','table_id',v_tid,
          'attendance_id',v_aid,'other_table_id',v_row.table_id,
          'other_table_name',v_row.table_name,
          'hint','add that table to the correction to move the dealer');
        v_action := 'blocked';
      ELSE
        v_action := 'assign';
      END IF;
    END IF;

    IF v_action NOT IN ('already_correct') THEN
      v_all_correct := false;
    END IF;

    v_plan := v_plan || jsonb_build_object(
      'table_id', v_tid,
      'action', v_action,
      'actual_attendance_id', v_aid,
      'current_assignment_id', v_cur.id,
      'current_attendance_id', v_cur.attendance_id,
      'expected_assignment_id', v_cur.id,      -- CAS echo for apply call
      'expected_version', v_cur.version
    );
  END LOOP;

  -- Displaced dealers = dealers of active rows at selected tables whose
  -- dealer is not an actual anywhere in this payload.
  FOR v_row IN
    SELECT a.id AS assignment_id, a.attendance_id, a.table_id, a.assigned_at,
           a.overtime_started_at, gt.table_name
    FROM dealer_assignments a JOIN game_tables gt ON gt.id = a.table_id
    WHERE a.released_at IS NULL AND a.status IN ('assigned','on_break')
      AND a.table_id = ANY(v_table_ids)
      AND NOT (a.attendance_id = ANY(v_actual_ids))
  LOOP
    v_all_correct := false;

    -- effective_at must not predate the assignment being released (owner
    -- guard; checked here in P3 against the actual row — under locks when
    -- applying). Admin override proceeds with the timestamp clamped later.
    IF p_effective_at < v_row.assigned_at AND NOT p_admin_override THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'type','effective_at_before_assignment',
        'table_id',v_row.table_id,'assignment_id',v_row.assignment_id,
        'assigned_at',v_row.assigned_at);
    END IF;

    v_resolution := (
      SELECT d.value->>'resolution' FROM jsonb_array_elements(p_displaced) d
      WHERE (d.value->>'attendance_id')::uuid = v_row.attendance_id LIMIT 1);
    v_res_reason := (
      SELECT d.value->>'reason' FROM jsonb_array_elements(p_displaced) d
      WHERE (d.value->>'attendance_id')::uuid = v_row.attendance_id LIMIT 1);

    IF v_resolution IS NULL THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'type','displaced_unresolved','attendance_id',v_row.attendance_id,
        'from_table_id',v_row.table_id,'from_table_name',v_row.table_name,
        'default_resolution','pool_available');
    ELSIF v_resolution = 'still_working_other_table' THEN
      -- Then they are not displaced: they must be an actual somewhere in this
      -- payload (which would have made their row a 'move', not a release).
      v_conflicts := v_conflicts || jsonb_build_object(
        'type','displaced_resolution_invalid','attendance_id',v_row.attendance_id,
        'detail','still_working_other_table requires the dealer to be the actual dealer of a table in this correction');
    ELSIF v_resolution NOT IN ('pool_available','on_break','unknown_needs_floor_check','no_show') THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'type','displaced_resolution_invalid','attendance_id',v_row.attendance_id,
        'detail','unknown resolution: ' || v_resolution);
    END IF;

    v_displaced_out := v_displaced_out || jsonb_build_object(
      'attendance_id', v_row.attendance_id,
      'from_table_id', v_row.table_id,
      'from_table_name', v_row.table_name,
      'assignment_id', v_row.assignment_id,
      'resolution', COALESCE(v_resolution,'pool_available'),
      'reason', v_res_reason,
      'resolved', v_resolution IS NOT NULL);
  END LOOP;

  -- Global final-state invariants on the PLANNED mapping: by construction
  -- each actual appears at exactly one selected table and each selected table
  -- ends with at most one dealer; an actual active at a non-selected table is
  -- blocked above. The authoritative re-check runs post-write in P5.5.

  -- ══ P4: dry-run / blocked exit (ZERO writes) ══════════════════════════════
  IF p_dry_run OR jsonb_array_length(v_conflicts) > 0 THEN
    RETURN jsonb_build_object(
      'outcome','dry_run',
      'can_apply', jsonb_array_length(v_conflicts) = 0 AND NOT v_all_correct,
      'plan', v_plan,
      'conflicts', v_conflicts,
      'displaced', v_displaced_out,
      'effective_at', p_effective_at,
      'before_snapshot', v_before);
  END IF;

  IF v_all_correct THEN
    RETURN jsonb_build_object('outcome','noop',
      'detail','system state already matches the entered reality');
  END IF;

  -- ══ P5: writes (releases → moves → assigns → supersede) ═══════════════════

  -- [5.1] RELEASES — displaced rows (release bookkeeping variant of the
  -- canonical executor steps [6]/[7]; released_at = effective_at is the
  -- reality-based R1 rest anchor).
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_displaced_out) LOOP
    v_aid := (v_entry->>'attendance_id')::uuid;
    v_resolution := v_entry->>'resolution';

    SELECT a.* INTO v_row FROM dealer_assignments a
    WHERE a.id = (v_entry->>'assignment_id')::uuid
      AND a.released_at IS NULL;                      -- double-credit guard
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'reconcile: displaced assignment % no longer active',
        v_entry->>'assignment_id';
    END IF;

    -- Per-row release timestamp: clamp to assigned_at under admin override
    -- (without override, effective_at < assigned_at was blocked in P3).
    v_rel_at := GREATEST(p_effective_at, v_row.assigned_at);
    -- Credit worked minutes for THIS assignment only; never negative,
    -- never written to payroll fields.
    v_credit := GREATEST(0,
      FLOOR(EXTRACT(EPOCH FROM (v_rel_at - v_row.assigned_at)) / 60))::int;

    -- Would-be OT recorded for future payroll reconciliation — NOT written.
    IF v_row.overtime_started_at IS NOT NULL THEN
      v_payroll_recon := v_payroll_recon || jsonb_build_object(
        'attendance_id', v_aid,
        'assignment_id', v_row.id,
        'overtime_started_at', v_row.overtime_started_at,
        'skipped_ot_minutes_system', GREATEST(0,
          FLOOR(EXTRACT(EPOCH FROM (v_now - v_row.overtime_started_at)) / 60))::int,
        'skipped_ot_minutes_effective', GREATEST(0,
          FLOOR(EXTRACT(EPOCH FROM (v_rel_at - v_row.overtime_started_at)) / 60))::int);
    END IF;

    UPDATE dealer_assignments SET
      status                     = 'completed',
      released_at                = v_rel_at,
      swing_processed_at         = v_now,
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      planned_relief_at          = NULL,
      overtime_started_at        = NULL,
      release_reason             = 'room_reconcile',
      version                    = version + 1,
      updated_at                 = v_now
    WHERE id = v_row.id AND released_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reconcile: release CAS failed on assignment %', v_row.id;
    END IF;

    -- Attendance per displaced resolution. Payroll fields untouched.
    IF v_resolution = 'pool_available' THEN
      UPDATE dealer_attendance SET
        current_state                   = 'available',
        worked_minutes_since_last_break = 0,
        priority_break_flag             = false,
        total_worked_minutes_today      = COALESCE(total_worked_minutes_today,0) + v_credit,
        last_released_at                = v_rel_at,
        pool_entered_at                 = v_rel_at,
        pre_assigned_table_id           = NULL,
        pre_assigned_at                 = NULL
      WHERE id = v_aid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'reconcile: attendance update failed for %', v_aid;
      END IF;
    ELSE
      -- on_break | unknown_needs_floor_check | no_show → on_break hold
      -- (valid current_state; keeps the dealer out of the scheduler pool and
      -- visible in the break pool UI; reversible by ending the break).
      SELECT COALESCE(sc.break_duration_minutes, 20) INTO v_break_minutes
      FROM swing_config sc
      WHERE sc.club_id = p_club_id AND sc.table_type = 'tournament' LIMIT 1;
      v_break_minutes := COALESCE(v_break_minutes, 20);

      UPDATE dealer_attendance SET
        current_state                   = 'on_break',
        worked_minutes_since_last_break = 0,
        priority_break_flag             = false,
        total_worked_minutes_today      = COALESCE(total_worked_minutes_today,0) + v_credit,
        last_released_at                = v_rel_at,
        pool_entered_at                 = v_rel_at,
        pre_assigned_table_id           = NULL,
        pre_assigned_at                 = NULL
      WHERE id = v_aid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'reconcile: attendance update failed for %', v_aid;
      END IF;

      INSERT INTO dealer_breaks
        (assignment_id, attendance_id, club_id, break_start,
         expected_duration_minutes, reason)
      VALUES
        (v_row.id, v_aid, p_club_id, v_rel_at, v_break_minutes,
         CASE v_resolution
           WHEN 'on_break'                 THEN 'room_reconcile'
           WHEN 'unknown_needs_floor_check' THEN 'reconcile_hold_floor_check'
           WHEN 'no_show'                  THEN 'reconcile_no_show_hold'
         END);
    END IF;

    v_released := v_released + 1;
    v_diff_tables := v_diff_tables || jsonb_build_object(
      'table_id', v_row.table_id, 'action', 'release',
      'old_attendance_id', v_aid, 'new_attendance_id', NULL,
      'old_assignment_id', v_row.id, 'new_assignment_id', NULL,
      'released_at', v_rel_at, 'worked_minutes_credited', v_credit,
      'displaced_resolution', v_resolution);
  END LOOP;

  -- [5.2] MOVES — right dealer, wrong table. assigned_at / swing_due_at
  -- preserved; NO worked-minute credit; attendance untouched.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_plan)
                 WHERE value->>'action' = 'move' LOOP
    v_tid := (v_entry->>'table_id')::uuid;
    v_aid := (v_entry->>'actual_attendance_id')::uuid;

    SELECT a.* INTO v_row FROM dealer_assignments a
    WHERE a.attendance_id = v_aid AND a.released_at IS NULL
      AND a.status IN ('assigned','on_break')
    ORDER BY a.assigned_at DESC LIMIT 1;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'reconcile: move source for dealer % vanished', v_aid;
    END IF;

    UPDATE dealer_assignments SET
      table_id                   = v_tid,
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      planned_relief_at          = NULL,
      version                    = version + 1,
      updated_at                 = v_now
    WHERE id = v_row.id AND released_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reconcile: move CAS failed on assignment %', v_row.id;
    END IF;

    v_moved := v_moved + 1;
    v_diff_tables := v_diff_tables || jsonb_build_object(
      'table_id', v_tid, 'action', 'move',
      'old_table_id', v_row.table_id,
      'old_attendance_id', v_aid, 'new_attendance_id', v_aid,
      'old_assignment_id', v_row.id, 'new_assignment_id', v_row.id,
      'worked_minutes_credited', 0);
  END LOOP;

  -- [5.3] ASSIGNS — dealer from the pool onto the table at effective_at.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_plan)
                 WHERE value->>'action' = 'assign' LOOP
    v_tid := (v_entry->>'table_id')::uuid;
    v_aid := (v_entry->>'actual_attendance_id')::uuid;

    -- Close any open break (they are in fact dealing).
    UPDATE dealer_breaks SET break_end = GREATEST(break_start, p_effective_at)
    WHERE break_end IS NULL
      AND (attendance_id = v_aid
           OR assignment_id IN (SELECT id FROM dealer_assignments
                                WHERE attendance_id = v_aid));

    -- If the dealer was CHOT (pre_assigned) for some table, clear that
    -- planning-only lock: the slot supersede below handles selected tables;
    -- a lock on a NON-selected table is also cleared here (planning state
    -- only — recorded via diff and slot reason).
    UPDATE dealer_assignments SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      planned_relief_at          = NULL,
      version                    = version + 1,
      updated_at                 = v_now
    WHERE pre_assigned_attendance_id = v_aid AND released_at IS NULL;

    UPDATE dealer_rotation_schedule SET
      status = 'superseded', version = version + 1, updated_at = v_now,
      reason = COALESCE(reason,'{}'::jsonb)
               || jsonb_build_object('superseded_by_correction', v_correction_id)
    WHERE in_attendance_id = v_aid AND status IN ('predicted','announced');
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_superseded := v_superseded + COALESCE(v_rowcount,0);

    -- swing_due_at recomputed from config (table override > tournament
    -- fallback > 45). Past-due result is acceptable.
    SELECT gt.table_type INTO v_tbl FROM game_tables gt WHERE gt.id = v_tid;
    SELECT COALESCE(
      (SELECT sc.swing_duration_minutes FROM swing_config sc
        WHERE sc.club_id = p_club_id AND sc.table_type = v_tbl.table_type LIMIT 1),
      (SELECT sc.swing_duration_minutes FROM swing_config sc
        WHERE sc.club_id = p_club_id AND sc.table_type = 'tournament' LIMIT 1),
      45) INTO v_duration;
    v_duration := GREATEST(1, v_duration);

    INSERT INTO dealer_assignments
      (attendance_id, table_id, club_id, status, assigned_at, swing_due_at,
       idempotency_key)
    VALUES
      (v_aid, v_tid, p_club_id, 'assigned', p_effective_at,
       p_effective_at + make_interval(mins => v_duration),
       'reconcile_' || v_correction_id::text || '_' || v_tid::text)
    RETURNING id INTO v_new_assignment;
    -- No ON CONFLICT: a unique_violation here means the plan was beaten by a
    -- race → dedicated handler returns 'race_lost', whole tx rolls back.

    UPDATE dealer_attendance SET
      current_state         = 'assigned',
      pre_assigned_table_id = NULL,
      pre_assigned_at       = NULL
    WHERE id = v_aid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reconcile: attendance update failed for %', v_aid;
    END IF;

    v_assigned := v_assigned + 1;
    v_diff_tables := v_diff_tables || jsonb_build_object(
      'table_id', v_tid, 'action', 'assign',
      'old_attendance_id', NULL, 'new_attendance_id', v_aid,
      'old_assignment_id', NULL, 'new_assignment_id', v_new_assignment,
      'assigned_at', p_effective_at,
      'swing_due_at', p_effective_at + make_interval(mins => v_duration),
      'worked_minutes_credited', 0);
  END LOOP;

  -- [5.4] ROTATION SUPERSEDE for all selected tables (data-level only;
  -- the planner replans these tables from corrected truth on its next tick).
  -- First release dealers still CHOT-held for these tables (guarded; 0 rows
  -- tolerated — Pass R owns residual drift). Skips dealers we just assigned
  -- (their current_state is no longer 'pre_assigned').
  UPDATE dealer_attendance SET
    current_state         = 'available',
    pre_assigned_table_id = NULL,
    pre_assigned_at       = NULL
  WHERE current_state = 'pre_assigned'
    AND pre_assigned_table_id = ANY(v_table_ids);

  UPDATE dealer_assignments SET
    pre_assigned_attendance_id = NULL,
    pre_assigned_at            = NULL,
    planned_relief_at          = NULL,
    version                    = version + 1,
    updated_at                 = v_now
  WHERE table_id = ANY(v_table_ids) AND released_at IS NULL
    AND (pre_assigned_attendance_id IS NOT NULL OR planned_relief_at IS NOT NULL);

  UPDATE dealer_rotation_schedule SET
    status = 'superseded', version = version + 1, updated_at = v_now,
    reason = COALESCE(reason,'{}'::jsonb)
             || jsonb_build_object('superseded_by_correction', v_correction_id)
  WHERE table_id = ANY(v_table_ids) AND status IN ('predicted','announced');
  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_superseded := v_superseded + COALESCE(v_rowcount,0);

  -- [5.5] FINAL INVARIANT RE-CHECK on real post-write state.
  -- (a) one dealer ↔ at most one active table (idx_one_active_per_dealer is
  --     the DB backstop; this surfaces violations deterministically);
  -- (b) one table ↔ at most one active dealer (NO db unique index exists on
  --     table_id — this procedural check is mandatory).
  PERFORM 1 FROM dealer_assignments a
  WHERE a.released_at IS NULL AND a.status IN ('assigned','on_break')
    AND (a.club_id = p_club_id OR a.table_id = ANY(v_table_ids)
         OR a.attendance_id = ANY(v_all_att_ids))
  GROUP BY a.attendance_id HAVING COUNT(*) > 1;
  IF FOUND THEN
    RAISE EXCEPTION 'reconcile: invariant violation — dealer active at two tables';
  END IF;

  PERFORM 1 FROM dealer_assignments a
  WHERE a.released_at IS NULL AND a.status IN ('assigned','on_break')
    AND (a.club_id = p_club_id OR a.table_id = ANY(v_table_ids)
         OR a.attendance_id = ANY(v_all_att_ids))
  GROUP BY a.table_id HAVING COUNT(*) > 1;
  IF FOUND THEN
    RAISE EXCEPTION 'reconcile: invariant violation — table has two active dealers';
  END IF;

  -- [5.6] AFTER-SNAPSHOT + AUDIT.
  v_after := jsonb_build_object(
    'assignments', COALESCE((
      SELECT jsonb_agg(to_jsonb(a)) FROM dealer_assignments a
      WHERE a.released_at IS NULL AND a.status IN ('assigned','on_break')
        AND (a.table_id = ANY(v_table_ids) OR a.attendance_id = ANY(v_all_att_ids))
    ), '[]'::jsonb),
    'attendance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', att.id, 'dealer_id', att.dealer_id, 'status', att.status,
        'current_state', att.current_state,
        'worked_minutes_since_last_break', att.worked_minutes_since_last_break,
        'total_worked_minutes_today', att.total_worked_minutes_today,
        'overtime_minutes', att.overtime_minutes,
        'last_released_at', att.last_released_at,
        'pool_entered_at', att.pool_entered_at,
        'pre_assigned_table_id', att.pre_assigned_table_id,
        'check_in_time', att.check_in_time, 'check_out_time', att.check_out_time
      )) FROM dealer_attendance att WHERE att.id = ANY(v_all_att_ids)
    ), '[]'::jsonb),
    'rotation_slots', COALESCE((
      SELECT jsonb_agg(to_jsonb(r)) FROM dealer_rotation_schedule r
      WHERE r.table_id = ANY(v_table_ids)
        AND r.status IN ('predicted','announced','superseded')
        AND r.updated_at >= v_now - interval '1 minute'
    ), '[]'::jsonb)
  );

  SELECT array_agg(DISTINCT att.dealer_id) INTO v_dealer_ids
  FROM dealer_attendance att WHERE att.id = ANY(v_all_att_ids);

  INSERT INTO dealer_assignment_corrections
    (id, club_id, affected_table_ids, affected_attendance_ids,
     affected_dealer_ids, effective_at, reason, created_by, admin_override,
     before_snapshot, after_snapshot, diff)
  VALUES
    (v_correction_id, p_club_id, v_table_ids, v_all_att_ids,
     COALESCE(v_dealer_ids,'{}'), p_effective_at, btrim(p_reason), auth.uid(),
     p_admin_override, v_before, v_after,
     jsonb_build_object(
       'tables', v_diff_tables,
       'displaced_dealers', v_displaced_out,
       'payroll_reconciliation', v_payroll_recon,
       'slots_superseded', v_superseded));

  INSERT INTO audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  VALUES (p_club_id, auth.uid(), 'room_reconcile',
          'dealer_assignment_correction', v_correction_id,
          jsonb_build_object(
            'tables', v_table_ids,
            'released', v_released, 'moved', v_moved, 'assigned', v_assigned,
            'slots_superseded', v_superseded,
            'effective_at', p_effective_at,
            'reason', btrim(p_reason),
            'admin_override', p_admin_override));

  RETURN jsonb_build_object(
    'outcome','applied',
    'correction_id', v_correction_id,
    'plan', v_plan,
    'summary', jsonb_build_object(
      'released', v_released, 'moved', v_moved, 'assigned', v_assigned,
      'displaced', jsonb_array_length(v_displaced_out),
      'slots_superseded', v_superseded));

EXCEPTION
  WHEN unique_violation THEN
    -- idx_one_active_per_dealer / idempotency backstop: plan beaten by a race.
    RETURN jsonb_build_object('outcome','race_lost','detail',SQLERRM);
  WHEN OTHERS THEN
    RETURN jsonb_build_object('outcome','error','detail',SQLERRM,'sqlstate',SQLSTATE);
END;
$function$;
