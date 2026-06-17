-- ════════════════════════════════════════════════════════════════════════════
-- 20260922000000_dealer_assignment_canonical_teardown.sql
--
-- PR 1 (source-only foundation) for the Dealer Swing orphaned-assignment freeze
-- class. Contract: VinPoker/docs/dealer-swing/ASSIGNMENT_TEARDOWN_ROOT_CAUSE.md
--
-- WHAT THIS DOES (3 objects):
--   1. NEW  release_dealer_assignments(...)  — canonical teardown helper (additive).
--   2. REPLACE reconcile_ghost_assignments   — add Pass A (checked-out orphans, the
--        freeze class) AND fix a latent bug: it read transition_dealer_state's result
--        as ->>'success' but that fn returns ->>'ok', so the live reconciler ALWAYS
--        skipped (never reconciled anything, even its intended live-ghost class).
--   3. REPLACE cleanup_stale_attendance      — also release on_break / pre_assigned
--        assignments (was 'assigned' only) and include on_break stale attendances.
--
-- WHAT THIS DOES NOT DO (later PRs / separate owner-gated apply):
--   - No change to perform_swing / execute_pre_assigned_swing (PR 3, overload bomb).
--   - No change to checkout-dealer edge fn / dealer_check_out RPC / pickNextDealer
--     Step 5b predicate (PR 2 call-sites + shared busy predicate).
--   - This migration is SOURCE-ONLY: do NOT supabase db push / deploy_db=true.
--     Controlled live apply is a separate owner-gated step (snapshot live bodies
--     first; rollback = re-apply the prior live bodies, captured in the PR).
--
-- IDEMPOTENT / SAFE: all three are CREATE OR REPLACE; no data migration here.
-- Slot 20260922000000 chosen as next free slot above live max applied (20260921000000).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Canonical teardown helper (NEW, additive)
--    Releases ALL active assignment rows for a dealer (or a specific attendance),
--    by dealer_id so orphans from OLD attendances are caught. The ONLY place fix
--    work should release assignments from now on — every teardown path calls this.
--    p_released_at lets callers pass the true end time (e.g. checkout time) so
--    worked-minutes / payroll are NOT inflated; defaults to now().
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_dealer_assignments(
  p_dealer_id     uuid DEFAULT NULL,
  p_attendance_id uuid DEFAULT NULL,
  p_released_at   timestamptz DEFAULT NULL,
  p_reason        text DEFAULT 'canonical_teardown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ts            timestamptz;
  v_released_ids  uuid[];
BEGIN
  -- Caller must scope by at least one of dealer_id / attendance_id.
  IF p_dealer_id IS NULL AND p_attendance_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_SCOPE',
      'detail', 'release_dealer_assignments requires p_dealer_id or p_attendance_id');
  END IF;

  v_ts := COALESCE(p_released_at, NOW());

  WITH upd AS (
    UPDATE dealer_assignments da
    SET status                     = 'completed',
        released_at                = v_ts,
        release_reason             = p_reason,
        pre_assigned_attendance_id = NULL,
        pre_assigned_at            = NULL,
        updated_at                 = NOW()
    WHERE da.released_at IS NULL
      AND da.status IN ('assigned', 'on_break', 'pre_assigned')
      AND (
        (p_dealer_id IS NOT NULL AND da.dealer_id = p_dealer_id)
        OR (p_attendance_id IS NOT NULL AND da.attendance_id = p_attendance_id)
      )
    RETURNING da.id
  )
  SELECT array_agg(id) INTO v_released_ids FROM upd;

  RETURN jsonb_build_object(
    'ok', true,
    'released_count', COALESCE(array_length(v_released_ids, 1), 0),
    'assignment_ids', COALESCE(to_jsonb(v_released_ids), '[]'::jsonb),
    'released_at', v_ts,
    'reason', p_reason
  );
END;
$function$;

-- Least-privilege: server-side callers only (cron / SECURITY DEFINER fns / service role).
REVOKE ALL ON FUNCTION public.release_dealer_assignments(uuid, uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_dealer_assignments(uuid, uuid, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.release_dealer_assignments(uuid, uuid, timestamptz, text) FROM authenticated;

COMMENT ON FUNCTION public.release_dealer_assignments(uuid, uuid, timestamptz, text) IS
  'Canonical Dealer Swing teardown: releases all active dealer_assignments (assigned/on_break/pre_assigned, released_at IS NULL) for a dealer or attendance. Set p_released_at to the true end time (e.g. checkout time) to avoid inflating worked-minutes. See docs/dealer-swing/ASSIGNMENT_TEARDOWN_ROOT_CAUSE.md';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. reconcile_ghost_assignments (REPLACE)
--    Pass A (NEW): release checked-out orphans (the freeze class) via the
--      canonical helper, using the attendance checkout time as released_at.
--    Pass B (existing live-ghost loop): UNCHANGED logic EXCEPT the latent
--      ->>'success' bug fixed to ->>'ok' (transition_dealer_state returns {ok}).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_ghost_assignments(p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ghost RECORD;
  v_orphan RECORD;
  v_fixed_count INT := 0;
  v_checkedout_fixed INT := 0;
  v_skipped_count INT := 0;
  v_current_result JSONB;
  v_preassigned_result JSONB;
  v_current_ok BOOLEAN;
  v_preassigned_ok BOOLEAN;
  v_errors JSONB := '[]'::jsonb;
BEGIN
  -- ── PASS A (NEW): checked-out orphans — the freeze class ──────────────────
  -- A non-released active assignment whose dealer has CHECKED OUT is a pure
  -- orphan (the dealer is gone). It poisons pickNextDealer Step 5b (matched by
  -- dealer_id) and froze club 22222222 for 3h on 2026-06-17. The old loop below
  -- never saw it: it filtered status='assigned' + swing_processed_at IS NOT NULL,
  -- but the orphan was status='on_break' with swing_processed_at NULL. Release it
  -- at the attendance checkout time (payroll-safe) via the canonical helper.
  FOR v_orphan IN
    SELECT DISTINCT da.attendance_id, att.check_out_time
    FROM dealer_assignments da
    JOIN dealer_attendance att ON att.id = da.attendance_id
    WHERE da.released_at IS NULL
      AND da.status IN ('assigned', 'on_break', 'pre_assigned')
      AND att.status = 'checked_out'
      AND da.attendance_id IS NOT NULL
      AND (p_club_id IS NULL OR da.club_id = p_club_id)
  LOOP
    BEGIN
      PERFORM public.release_dealer_assignments(
        p_dealer_id     := NULL,
        p_attendance_id := v_orphan.attendance_id,
        p_released_at   := v_orphan.check_out_time,
        p_reason        := 'reconcile_checked_out_orphan'
      );
      v_checkedout_fixed := v_checkedout_fixed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'attendance_id', v_orphan.attendance_id,
        'step', 'checked_out_orphan',
        'error', SQLERRM
      );
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;

  -- ── PASS B: live-dealer ghosts (stuck assigned, swing 60min overdue) ──────
  FOR v_ghost IN
    SELECT
      da.id,
      da.attendance_id,
      da.pre_assigned_attendance_id,
      da.table_id,
      da.club_id
    FROM dealer_assignments da
    WHERE da.status = 'assigned'
      AND da.released_at IS NULL
      AND da.swing_processed_at IS NOT NULL
      -- 60 min threshold (matches circuit breaker)
      AND da.swing_due_at < NOW() - INTERVAL '60 minutes'
      AND (p_club_id IS NULL OR da.club_id = p_club_id)
  LOOP
    BEGIN
      -- Pre-check: at least one dealer must exist
      IF v_ghost.attendance_id IS NULL AND v_ghost.pre_assigned_attendance_id IS NULL THEN
        v_errors := v_errors || jsonb_build_object(
          'assignment_id', v_ghost.id,
          'step', 'pre_check',
          'error', 'Both attendance_id and pre_assigned_attendance_id are NULL — data corruption'
        );
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      v_current_ok := TRUE;
      v_preassigned_ok := TRUE;

      -- Release current dealer
      IF v_ghost.attendance_id IS NOT NULL THEN
        SELECT transition_dealer_state(
          p_attendance_id := v_ghost.attendance_id,
          p_new_state := 'available',
          p_reason := 'reconcile_ghost_release_current'
        ) INTO v_current_result;

        -- FIX: transition_dealer_state returns {"ok": bool}, not {"success": ...}.
        -- The previous ->>'success' always yielded NULL -> COALESCE FALSE -> the
        -- reconciler skipped EVERYTHING. Read ->>'ok'.
        v_current_ok := COALESCE((v_current_result->>'ok')::boolean, FALSE);
        IF NOT v_current_ok THEN
          v_errors := v_errors || jsonb_build_object(
            'assignment_id', v_ghost.id,
            'step', 'release_current',
            'error', v_current_result->>'error'
          );
        END IF;
      END IF;

      -- Release pre-assigned dealer
      IF v_ghost.pre_assigned_attendance_id IS NOT NULL THEN
        SELECT transition_dealer_state(
          p_attendance_id := v_ghost.pre_assigned_attendance_id,
          p_new_state := 'available',
          p_reason := 'reconcile_ghost_release_preassigned'
        ) INTO v_preassigned_result;

        v_preassigned_ok := COALESCE((v_preassigned_result->>'ok')::boolean, FALSE);
        IF NOT v_preassigned_ok THEN
          v_errors := v_errors || jsonb_build_object(
            'assignment_id', v_ghost.id,
            'step', 'release_preassigned',
            'error', v_preassigned_result->>'error'
          );
        END IF;
      END IF;

      -- Only mark COMPLETED if BOTH releases succeeded (or not needed)
      IF v_current_ok AND v_preassigned_ok THEN
        UPDATE dealer_assignments
        SET
          status = 'completed',
          released_at = NOW(),
          release_reason = 'reconcile_ghost_cleanup',
          pre_assigned_attendance_id = NULL,
          pre_assigned_at = NULL,
          updated_at = NOW()
        WHERE id = v_ghost.id;

        v_fixed_count := v_fixed_count + 1;

        RAISE NOTICE 'Reconciled ghost assignment % on table %',
          v_ghost.id, v_ghost.table_id;
      ELSE
        v_errors := v_errors || jsonb_build_object(
          'assignment_id', v_ghost.id,
          'step', 'post_check',
          'error', 'One or more releases failed, NOT marking completed'
        );
        v_skipped_count := v_skipped_count + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'assignment_id', v_ghost.id,
        'step', 'exception',
        'error', SQLERRM
      );
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'fixed_count', v_fixed_count,
    'checked_out_fixed', v_checkedout_fixed,
    'skipped_count', v_skipped_count,
    'error_count', jsonb_array_length(v_errors),
    'errors', v_errors,
    'club_id', p_club_id,
    'timestamp', NOW()
  );
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. cleanup_stale_attendance (REPLACE)
--    Daily 6AM cron auto-checks-out dealers checked-in > p_stale_threshold_hours.
--    FIX: also release on_break / pre_assigned assignments (was 'assigned' only),
--    and include 'on_break' stale attendances so an on_break dealer stuck > 24h is
--    also cleaned. Otherwise this cron LEAVES on_break orphans that re-freeze
--    rotation. (reconcile Pass A above is the defense-in-depth net for any miss.)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_stale_attendance(p_club_id uuid DEFAULT NULL::uuid, p_stale_threshold_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff       TIMESTAMPTZ;
  v_cleaned      INT := 0;
  v_dealer_ids   UUID[];
BEGIN
  v_cutoff := NOW() - (p_stale_threshold_hours || ' hours')::INTERVAL;

  -- Collect affected dealer IDs for reporting
  SELECT ARRAY_AGG(DISTINCT da.dealer_id)
  INTO v_dealer_ids
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE (p_club_id IS NULL OR d.club_id = p_club_id)
    AND da.check_out_time IS NULL
    AND da.check_in_time < v_cutoff
    AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition', 'on_break');

  -- Release any dangling assignments attached to these stale attendances.
  -- FIX: release on_break / pre_assigned too (was status='assigned' only) so the
  -- auto-checkout does not leave orphans that poison pickNextDealer Step 5b.
  WITH released_assignments AS (
    UPDATE dealer_assignments da2
    SET
      status = 'completed',
      released_at = NOW(),
      release_reason = 'cleanup_stale_attendance',
      swing_processed_at = COALESCE(swing_processed_at, NOW()),
      pre_assigned_attendance_id = NULL,
      pre_assigned_at = NULL,
      updated_at = NOW()
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    WHERE da2.attendance_id = da.id
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
      AND da.check_out_time IS NULL
      AND da.check_in_time < v_cutoff
      AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition', 'on_break')
      AND da2.released_at IS NULL
      AND da2.status IN ('assigned', 'on_break', 'pre_assigned')
    RETURNING da2.id
  )
  SELECT COUNT(*) INTO v_cleaned FROM released_assignments;

  -- Mark stale attendances as 'checked_out' with estimated checkout
  UPDATE dealer_attendance
  SET
    current_state  = 'checked_out',
    status         = 'checked_out',
    check_out_time = check_in_time + INTERVAL '8 hours',
    updated_at     = NOW()
  FROM dealers d
  WHERE d.id = dealer_attendance.dealer_id
    AND (p_club_id IS NULL OR d.club_id = p_club_id)
    AND dealer_attendance.check_out_time IS NULL
    AND dealer_attendance.check_in_time < v_cutoff
    AND dealer_attendance.current_state IN ('assigned', 'pre_assigned', 'in_transition', 'on_break');

  RETURN jsonb_build_object(
    'ok', true,
    'cleaned', v_cleaned,
    'dealer_ids', v_dealer_ids
  );
END;
$function$;
