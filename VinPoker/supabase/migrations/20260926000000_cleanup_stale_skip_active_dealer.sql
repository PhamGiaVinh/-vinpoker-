-- ════════════════════════════════════════════════════════════════════════════
-- 20260926000000_cleanup_stale_skip_active_dealer.sql
--
-- Fixes cleanup_stale_attendance so it does NOT auto-checkout a dealer who is
-- ACTIVELY in rotation. Builds on the #299 body (migration 20260922000000, the
-- on_break/pre_assigned release fix) — this is that body + an "active dealer" guard.
--
-- INCIDENT (2026-06-18, club 22222222, dealer pgv): the daily cron (0 6 * * * UTC =
-- 13:00 +07) reaps dealers with check_in_time > 24h ago AND current_state IN
-- (assigned/pre_assigned/in_transition/on_break). pgv had been checked in since
-- 06-17 06:27 (a long continuous session) and was SWUNG INTO Bàn 8 at 06-18 12:54 —
-- a perfectly healthy active assignment. Six minutes later the 13:00 cron matched
-- pgv (stale CHECK-IN >24h + current_state='assigned') and auto-checked-out pgv,
-- backstamping check_out_time = check_in + 8h = 06-17 14:27. Result: a dealer who was
-- demonstrably dealing at 12:54 today is recorded as "checked out yesterday 14:27"
-- (false audit + payroll undercount) and was yanked mid-table → Bàn 8 backfilled by
-- fillEmptyTables. The cron conflated "stale check-in" with "stuck assignment": pgv's
-- CHECK-IN was old (30h) but the ASSIGNMENT was fresh (6 min).
--
-- FIX (owner decision: "skip actively-working dealers; do not change payroll for
-- normal cases"): add a guard that EXCLUDES from the reap any attendance that has a
-- HEALTHY active assignment — released_at IS NULL, status IN
-- (assigned/pre_assigned/on_break/in_transition), and not long-overdue
-- (COALESCE(swing_due_at, assigned_at) > now() - 2h). A genuinely-forgotten checkout
-- has no fresh active assignment (their table was swung to someone else), so it is
-- still reaped with the existing check_in+8h cap (payroll safety preserved). A
-- truly-STUCK assignment (>2h overdue) is left to reconcile_ghost_assignments (the
-- net fixed by #299) and remains reapable here as a backstop.
--
-- SCOPE: only re-replaces cleanup_stale_attendance (same signature/SECURITY DEFINER/
-- search_path). No payroll-formula change; check_out_time backstamp unchanged for the
-- genuinely-stale rows. SOURCE-ONLY — no apply, no db push, no deploy_db. Apply with
-- the rest of the Dealer Swing batch in a controlled owner-gated window (after #299).
-- Rollback (to the #299 body): docs/emergency_rollbacks/PRE_20260926_cleanup_stale_active_guard.sql
-- ════════════════════════════════════════════════════════════════════════════

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
    AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition', 'on_break')
    -- GUARD: skip dealers who are actively rotating (a fresh, not-2h-overdue active
    -- assignment). Stale CHECK-IN alone must not reap a healthy active assignment.
    AND NOT EXISTS (
      SELECT 1 FROM dealer_assignments fa
      WHERE fa.attendance_id = da.id
        AND fa.released_at IS NULL
        AND fa.status IN ('assigned', 'pre_assigned', 'on_break', 'in_transition')
        AND COALESCE(fa.swing_due_at, fa.assigned_at) > NOW() - INTERVAL '2 hours'
    );

  -- Release any dangling assignments attached to these stale attendances.
  -- (#299) release on_break / pre_assigned too so the auto-checkout does not leave
  -- orphans that poison pickNextDealer Step 5b.
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
      -- GUARD: do not release the assignments of an actively-rotating dealer.
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments fa
        WHERE fa.attendance_id = da.id
          AND fa.released_at IS NULL
          AND fa.status IN ('assigned', 'pre_assigned', 'on_break', 'in_transition')
          AND COALESCE(fa.swing_due_at, fa.assigned_at) > NOW() - INTERVAL '2 hours'
      )
    RETURNING da2.id
  )
  SELECT COUNT(*) INTO v_cleaned FROM released_assignments;

  -- Mark stale attendances as 'checked_out' with estimated checkout (check_in + 8h
  -- cap preserved for genuinely-forgotten checkouts — payroll safety).
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
    AND dealer_attendance.current_state IN ('assigned', 'pre_assigned', 'in_transition', 'on_break')
    -- GUARD: do not check out an actively-rotating dealer.
    AND NOT EXISTS (
      SELECT 1 FROM dealer_assignments fa
      WHERE fa.attendance_id = dealer_attendance.id
        AND fa.released_at IS NULL
        AND fa.status IN ('assigned', 'pre_assigned', 'on_break', 'in_transition')
        AND COALESCE(fa.swing_due_at, fa.assigned_at) > NOW() - INTERVAL '2 hours'
    );

  RETURN jsonb_build_object(
    'ok', true,
    'cleaned', v_cleaned,
    'dealer_ids', v_dealer_ids
  );
END;
$function$;
