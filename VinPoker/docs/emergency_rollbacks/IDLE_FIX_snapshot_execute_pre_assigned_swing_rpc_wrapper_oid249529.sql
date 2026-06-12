-- Live snapshot 2026-06-12 09:37 before idle-dealer fix. OID 249529.
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing_rpc(p_old_assignment_id uuid, p_next_attendance_id uuid, p_swing_due_at timestamp with time zone, p_duration_minutes integer, p_send_to_break boolean DEFAULT false, p_break_duration_minutes integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.execute_pre_assigned_swing(
    p_old_assignment_id,
    p_next_attendance_id,
    p_swing_due_at,
    p_duration_minutes,
    p_send_to_break,
    p_break_duration_minutes
  );
$function$

