-- Phase 5 PR #3: Add status='checked_in' filter to count_available_dealers
-- Consistent with Pass 0b query that also filters by status

CREATE OR REPLACE FUNCTION public.count_available_dealers(p_club_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.dealer_attendance da
  JOIN public.dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.current_state = 'available'
    AND da.status = 'checked_in'
    AND da.check_out_time IS NULL;
  
  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.count_available_dealers(uuid) IS
  'Phase 5 PR #3: Returns count of available dealers for a club.
   Joins dealer_attendance with dealers via dealer_id to get club_id.
   Filters by current_state=available AND status=checked_in AND check_out_time IS NULL.
   Used by Pass 3 shortage escalation for time-based recount.';