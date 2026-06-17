-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK snapshot for migration 20260922000000_dealer_assignment_canonical_teardown
--
-- These are the EXACT live function bodies captured (pg_get_functiondef) BEFORE the
-- migration, on 2026-06-17. To roll back the controlled apply:
--   1. DROP FUNCTION public.release_dealer_assignments(uuid, uuid, timestamptz, text);  -- new fn, just remove it
--   2. Re-run the two CREATE OR REPLACE blocks below (restores prior reconcile + cleanup).
--
-- NOTE: the prior reconcile_ghost_assignments had a latent bug (read ->>'success'
-- instead of ->>'ok' from transition_dealer_state, so it never reconciled anything)
-- and did NOT handle the checked-out orphan class. Rolling back reinstates that
-- behaviour — only do so if the new version causes a regression.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PRIOR reconcile_ghost_assignments (live before 20260922000000) ──────────────
CREATE OR REPLACE FUNCTION public.reconcile_ghost_assignments(p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ghost RECORD;
  v_fixed_count INT := 0;
  v_skipped_count INT := 0;
  v_current_result JSONB;
  v_preassigned_result JSONB;
  v_current_ok BOOLEAN;
  v_preassigned_ok BOOLEAN;
  v_errors JSONB := '[]'::jsonb;
BEGIN
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
      AND da.swing_due_at < NOW() - INTERVAL '60 minutes'
      AND (p_club_id IS NULL OR da.club_id = p_club_id)
  LOOP
    BEGIN
      IF v_ghost.attendance_id IS NULL AND v_ghost.pre_assigned_attendance_id IS NULL THEN
        v_errors := v_errors || jsonb_build_object('assignment_id', v_ghost.id, 'step', 'pre_check',
          'error', 'Both attendance_id and pre_assigned_attendance_id are NULL — data corruption');
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;
      v_current_ok := TRUE;
      v_preassigned_ok := TRUE;
      IF v_ghost.attendance_id IS NOT NULL THEN
        SELECT transition_dealer_state(p_attendance_id := v_ghost.attendance_id,
          p_new_state := 'available', p_reason := 'reconcile_ghost_release_current') INTO v_current_result;
        v_current_ok := COALESCE((v_current_result->>'success')::boolean, FALSE);
        IF NOT v_current_ok THEN
          v_errors := v_errors || jsonb_build_object('assignment_id', v_ghost.id, 'step', 'release_current',
            'error', v_current_result->>'error');
        END IF;
      END IF;
      IF v_ghost.pre_assigned_attendance_id IS NOT NULL THEN
        SELECT transition_dealer_state(p_attendance_id := v_ghost.pre_assigned_attendance_id,
          p_new_state := 'available', p_reason := 'reconcile_ghost_release_preassigned') INTO v_preassigned_result;
        v_preassigned_ok := COALESCE((v_preassigned_result->>'success')::boolean, FALSE);
        IF NOT v_preassigned_ok THEN
          v_errors := v_errors || jsonb_build_object('assignment_id', v_ghost.id, 'step', 'release_preassigned',
            'error', v_preassigned_result->>'error');
        END IF;
      END IF;
      IF v_current_ok AND v_preassigned_ok THEN
        UPDATE dealer_assignments
        SET status = 'completed', released_at = NOW(), release_reason = 'reconcile_ghost_cleanup',
            pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = NOW()
        WHERE id = v_ghost.id;
        v_fixed_count := v_fixed_count + 1;
        RAISE NOTICE 'Reconciled ghost assignment % on table %', v_ghost.id, v_ghost.table_id;
      ELSE
        v_errors := v_errors || jsonb_build_object('assignment_id', v_ghost.id, 'step', 'post_check',
          'error', 'One or more releases failed, NOT marking completed');
        v_skipped_count := v_skipped_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('assignment_id', v_ghost.id, 'step', 'exception', 'error', SQLERRM);
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('fixed_count', v_fixed_count, 'skipped_count', v_skipped_count,
    'error_count', jsonb_array_length(v_errors), 'errors', v_errors, 'club_id', p_club_id, 'timestamp', NOW());
END;
$function$;

-- ── PRIOR cleanup_stale_attendance (live before 20260922000000) ─────────────────
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
  v_result       JSONB;
BEGIN
  v_cutoff := NOW() - (p_stale_threshold_hours || ' hours')::INTERVAL;
  SELECT ARRAY_AGG(DISTINCT da.dealer_id) INTO v_dealer_ids
  FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id
  WHERE (p_club_id IS NULL OR d.club_id = p_club_id)
    AND da.check_out_time IS NULL AND da.check_in_time < v_cutoff
    AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition');
  WITH released_assignments AS (
    UPDATE dealer_assignments da2
    SET status = 'completed', released_at = NOW(),
        swing_processed_at = COALESCE(swing_processed_at, NOW()), updated_at = NOW()
    FROM dealer_attendance da JOIN dealers d ON d.id = da.dealer_id
    WHERE da2.attendance_id = da.id AND (p_club_id IS NULL OR d.club_id = p_club_id)
      AND da.check_out_time IS NULL AND da.check_in_time < v_cutoff
      AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition')
      AND da2.released_at IS NULL AND da2.status = 'assigned'
    RETURNING da2.id
  )
  SELECT COUNT(*) INTO v_cleaned FROM released_assignments;
  UPDATE dealer_attendance
  SET current_state = 'checked_out', status = 'checked_out',
      check_out_time = check_in_time + INTERVAL '8 hours', updated_at = NOW()
  FROM dealers d
  WHERE d.id = dealer_attendance.dealer_id AND (p_club_id IS NULL OR d.club_id = p_club_id)
    AND dealer_attendance.check_out_time IS NULL AND dealer_attendance.check_in_time < v_cutoff
    AND dealer_attendance.current_state IN ('assigned', 'pre_assigned', 'in_transition');
  RETURN jsonb_build_object('ok', true, 'cleaned', v_cleaned, 'dealer_ids', v_dealer_ids);
END;
$function$;
