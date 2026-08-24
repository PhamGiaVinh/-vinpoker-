-- Administrative stale-checkout cleanup for dealer test/legacy rows.
-- This path is intentionally separate from normal checkout: it never derives
-- worked minutes, overtime, or payroll amounts. It only closes rows when a
-- bounded, previously recorded end-of-work marker exists.
--
-- Rollback (owner-gated, do not run automatically):
-- DROP FUNCTION IF EXISTS public.administrative_close_stale_dealer_attendance(uuid[], uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.administrative_close_stale_dealer_attendance(
  p_attendance_ids UUID[],
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
  v_now TIMESTAMPTZ := clock_timestamp();
  v_club_id UUID;
  v_found_count INTEGER;
  v_club_count INTEGER;
  v_updated_count INTEGER;
  v_result JSONB := '[]'::JSONB;
  v_att RECORD;
  v_evidence_at TIMESTAMPTZ;
  v_evidence_source TEXT;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id is required';
  END IF;

  v_ids := ARRAY(
    SELECT DISTINCT id
    FROM unnest(COALESCE(p_attendance_ids, ARRAY[]::UUID[])) AS input(id)
    WHERE id IS NOT NULL
  );

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'at least one attendance id is required';
  END IF;
  IF array_length(v_ids, 1) > 100 THEN
    RAISE EXCEPTION 'at most 100 attendance ids may be cleaned at once';
  END IF;

  SELECT count(*), count(DISTINCT d.club_id), (array_agg(DISTINCT d.club_id))[1]
  INTO v_found_count, v_club_count, v_club_id
  FROM public.dealer_attendance att
  JOIN public.dealers d ON d.id = att.dealer_id
  WHERE att.id = ANY(v_ids);

  IF v_found_count <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'one or more attendance records were not found';
  END IF;
  IF v_club_count <> 1 OR v_club_id IS NULL THEN
    RAISE EXCEPTION 'mixed-club cleanup batches are not allowed';
  END IF;
  IF NOT public.is_club_dealer_control(p_actor_id, v_club_id) THEN
    RAISE EXCEPTION 'actor is not authorized for this club';
  END IF;

  FOR v_att IN
    SELECT
      att.id,
      att.status,
      att.check_in_time,
      att.check_out_time,
      att.current_state,
      att.last_released_at,
      d.club_id,
      (
        SELECT max(da.released_at)
        FROM public.dealer_assignments da
        WHERE da.attendance_id = att.id
          AND da.released_at IS NOT NULL
      ) AS assignment_released_at,
      (
        SELECT max(db.break_end)
        FROM public.dealer_breaks db
        LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
        WHERE db.break_end IS NOT NULL
          AND (db.attendance_id = att.id OR da.attendance_id = att.id)
      ) AS break_ended_at,
      EXISTS (
        SELECT 1
        FROM public.dealer_assignments da
        WHERE da.attendance_id = att.id
          AND da.released_at IS NULL
          AND da.status IN ('assigned', 'on_break', 'pre_assigned')
      ) AS has_active_assignment
    FROM public.dealer_attendance att
    JOIN public.dealers d ON d.id = att.dealer_id
    WHERE att.id = ANY(v_ids)
    ORDER BY array_position(v_ids, att.id)
    FOR UPDATE OF att
  LOOP
    IF v_att.status = 'checked_out' AND v_att.check_out_time IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'attendance_id', v_att.id,
        'success', true,
        'idempotent', true,
        'check_out_time', v_att.check_out_time
      );
      CONTINUE;
    END IF;

    IF v_att.status <> 'checked_in' OR v_att.check_out_time IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'attendance_id', v_att.id,
        'success', false,
        'error_code', 'NOT_CHECKED_IN',
        'error', 'Attendance is not an open checked-in shift'
      );
      CONTINUE;
    END IF;

    IF v_att.has_active_assignment THEN
      v_result := v_result || jsonb_build_object(
        'attendance_id', v_att.id,
        'success', false,
        'error_code', 'ACTIVE_ASSIGNMENT',
        'error', 'Active dealer assignment must be released before cleanup'
      );
      CONTINUE;
    END IF;

    v_evidence_at := NULL;
    v_evidence_source := NULL;

    IF v_att.last_released_at IS NOT NULL
       AND v_att.last_released_at >= COALESCE(v_att.check_in_time, '-infinity'::TIMESTAMPTZ)
       AND v_att.last_released_at <= v_now THEN
      v_evidence_at := v_att.last_released_at;
      v_evidence_source := 'attendance.last_released_at';
    END IF;
    IF v_att.assignment_released_at IS NOT NULL
       AND v_att.assignment_released_at >= COALESCE(v_att.check_in_time, '-infinity'::TIMESTAMPTZ)
       AND v_att.assignment_released_at <= v_now
       AND (v_evidence_at IS NULL OR v_att.assignment_released_at > v_evidence_at) THEN
      v_evidence_at := v_att.assignment_released_at;
      v_evidence_source := 'dealer_assignments.released_at';
    END IF;
    IF v_att.break_ended_at IS NOT NULL
       AND v_att.break_ended_at >= COALESCE(v_att.check_in_time, '-infinity'::TIMESTAMPTZ)
       AND v_att.break_ended_at <= v_now
       AND (v_evidence_at IS NULL OR v_att.break_ended_at > v_evidence_at) THEN
      v_evidence_at := v_att.break_ended_at;
      v_evidence_source := 'dealer_breaks.break_end';
    END IF;

    IF v_evidence_at IS NULL THEN
      v_result := v_result || jsonb_build_object(
        'attendance_id', v_att.id,
        'success', false,
        'error_code', 'NO_END_EVIDENCE',
        'error', 'No valid historical end-of-work evidence was found'
      );
      CONTINUE;
    END IF;

    UPDATE public.dealer_attendance
    SET status = 'checked_out',
        current_state = 'checked_out',
        check_out_time = v_evidence_at,
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL,
        updated_at = v_now
    WHERE id = v_att.id
      AND status = 'checked_in'
      AND check_out_time IS NULL;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 1 THEN
      v_result := v_result || jsonb_build_object(
        'attendance_id', v_att.id,
        'success', false,
        'error_code', 'UPDATE_CONFLICT',
        'error', 'Attendance changed before cleanup could close it'
      );
      CONTINUE;
    END IF;

    INSERT INTO public.audit_logs (
      club_id, actor_id, action, entity_type, entity_id, payload
    ) VALUES (
      v_att.club_id,
      p_actor_id,
      'administrative_stale_checkout',
      'dealer_attendance',
      v_att.id,
      jsonb_build_object(
        'mode', 'stale_cleanup',
        'evidence_source', v_evidence_source,
        'evidence_at', v_evidence_at,
        'payroll_recalculated', false,
        'overtime_recalculated', false,
        'historical_cleanup', true
      )
    );

    v_result := v_result || jsonb_build_object(
      'attendance_id', v_att.id,
      'success', true,
      'check_out_time', v_evidence_at,
      'evidence_source', v_evidence_source,
      'payroll_recalculated', false,
      'overtime_recalculated', false
    );
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.administrative_close_stale_dealer_attendance(UUID[], UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.administrative_close_stale_dealer_attendance(UUID[], UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.administrative_close_stale_dealer_attendance(UUID[], UUID) TO service_role;

COMMIT;
