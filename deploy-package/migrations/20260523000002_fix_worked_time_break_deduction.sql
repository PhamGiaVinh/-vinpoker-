-- Fix get_dealer_worked_times to deduct break durations from total worked time.
-- Previously: total = check_out - check_in (ignored breaks)
-- Now: total = (check_out - check_in) - SUM(break durations) per attendance

CREATE OR REPLACE FUNCTION public.get_dealer_worked_times(p_shift_date DATE)
RETURNS TABLE(dealer_id UUID, total_minutes BIGINT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    da.dealer_id,
    COALESCE(SUM(
      EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, now()) - da.check_in_time)) / 60
      - COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(db.break_end, now()) - db.break_start)) / 60)
        FROM public.dealer_breaks db
        JOIN public.dealer_assignments dass ON dass.id = db.assignment_id
        WHERE dass.attendance_id = da.id
      ), 0)
    )::BIGINT, 0) AS total_minutes
  FROM public.dealer_attendance da
  WHERE da.shift_date = p_shift_date
    AND da.check_in_time IS NOT NULL
  GROUP BY da.dealer_id
$$;
