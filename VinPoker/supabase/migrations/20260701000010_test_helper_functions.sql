-- Test helper functions (SECURITY DEFINER so test pg direct connection can read data)

-- Find first available attendance for a club
CREATE OR REPLACE FUNCTION get_available_attendance(p_club_id uuid)
RETURNS TABLE (id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT da.id FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.current_state = 'available'
    AND da.status = 'checked_in'
    AND d.club_id = p_club_id
  LIMIT 1;
$$;

-- Count audit logs for a club
CREATE OR REPLACE FUNCTION get_audit_log_count(p_club_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM swing_audit_logs WHERE club_id = p_club_id;
$$;
