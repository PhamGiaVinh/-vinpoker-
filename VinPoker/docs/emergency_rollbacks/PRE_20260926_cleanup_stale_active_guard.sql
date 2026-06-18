-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK snapshot for migration 20260926000000_cleanup_stale_skip_active_dealer
--
-- The #299 (20260922000000) body of cleanup_stale_attendance, WITHOUT the
-- active-dealer guard. To roll back the PR apply: re-run this CREATE OR REPLACE —
-- restores the #299 state (on_break/pre_assigned release fix) but reinstates the
-- "reap an actively-rotating dealer on stale check-in" behaviour. Roll back only on
-- a regression.
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
