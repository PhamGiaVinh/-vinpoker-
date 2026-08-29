-- Fix: PostgREST cannot resolve execute_pre_assigned_swing overloads by named args.
-- Add a single-name wrapper RPC with a unique signature and route Edge Functions to it.

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing_rpc(
  p_old_assignment_id UUID,
  p_next_attendance_id UUID,
  p_swing_due_at TIMESTAMPTZ,
  p_duration_minutes INTEGER,
  p_send_to_break BOOLEAN DEFAULT false,
  p_break_duration_minutes INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.execute_pre_assigned_swing(
    p_old_assignment_id,
    p_next_attendance_id,
    p_swing_due_at,
    p_duration_minutes,
    p_send_to_break,
    p_break_duration_minutes
  );
$$;

GRANT EXECUTE ON FUNCTION public.execute_pre_assigned_swing_rpc(
  UUID, UUID, TIMESTAMPTZ, INTEGER, BOOLEAN, INTEGER
) TO service_role;

COMMENT ON FUNCTION public.execute_pre_assigned_swing_rpc(UUID, UUID, TIMESTAMPTZ, INTEGER, BOOLEAN, INTEGER) IS
  'Unique-name wrapper for execute_pre_assigned_swing overload 1. Avoids PostgREST PGRST203 ambiguity on named-arg RPC calls.';
