-- ROLLBACK SNAPSHOT — public.complete_dealer_break BEFORE 20260904000000
-- Captured 2026-06-15 from live project orlesggcjamwuknxwcpk via Management API
-- (pg_get_functiondef). To roll back the harden migration, re-apply this exact body.

CREATE OR REPLACE FUNCTION public.complete_dealer_break(p_attendance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_break_id UUID;
  v_break_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT db.id, db.break_start
  INTO v_break_id, v_break_start
  FROM public.dealer_breaks db
  LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
  WHERE COALESCE(db.attendance_id, da.attendance_id) = p_attendance_id
    AND db.break_end IS NULL
  ORDER BY db.break_start DESC
  LIMIT 1
  FOR UPDATE OF db SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_open_break');
  END IF;

  UPDATE public.dealer_breaks
  SET break_end = v_now
  WHERE id = v_break_id;

  UPDATE public.dealer_attendance
  SET current_state = 'available',
      worked_minutes_since_last_break = 0,
      priority_break_flag = false,
      pool_entered_at = v_now,
      updated_at = v_now
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'break_id', v_break_id,
    'break_start', v_break_start
  );
END;
$function$;
