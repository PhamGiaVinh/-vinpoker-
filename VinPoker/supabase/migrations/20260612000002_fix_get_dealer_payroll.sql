-- =============================================================================
-- Fix get_dealer_payroll: proper fallback calculation + sane defaults
-- 
-- Changes:
--  1. Part-time: total_hours × hourly_rate_vnd (unchanged)
--  2. Full-time WITH base_rate_vnd: daily_rate × days_worked
--  3. Full-time WITHOUT base_rate_vnd: total_hours × hourly_rate_vnd
--  4. When both rates NULL: hourly_rate defaults based on employment_type
--  5. Cap check_out to last midnight to prevent runaway hours from open shifts
-- =============================================================================

CREATE OR REPLACE FUNCTION get_dealer_payroll(
  p_club_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  dealer_id UUID,
  full_name TEXT,
  tier TEXT,
  employment_type TEXT,
  hourly_rate_vnd INT,
  base_rate_vnd INT,
  total_hours NUMERIC,
  overtime_minutes INT,
  total_swings INT,
  base_pay NUMERIC,
  overtime_pay NUMERIC,
  total_pay NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_min_hourly_rate CONSTANT INT := 50000;
  v_min_base_rate CONSTANT INT := 200000;
  v_max_daily_hours CONSTANT NUMERIC := 16;  -- cap per day to prevent runaway
BEGIN
  RETURN QUERY
  WITH
    -- Step 1: Compute net hours per attendance (with break subtraction)
    attendance_hours AS (
      SELECT
        da.id AS attendance_id,
        da.dealer_id,
        da.shift_date,
        -- Use the earlier of check_out_time and end-of-day (midnight of next day)
        -- to prevent inflated hours from unclosed shifts
        LEAST(
          COALESCE(da.check_out_time, (da.shift_date + 1)::TIMESTAMPTZ),
          (da.shift_date + 1)::TIMESTAMPTZ
        ) AS effective_checkout,
        da.check_in_time,
        da.overtime_minutes,
        (SELECT COALESCE(SUM(
          LEAST(
            COALESCE(db.break_end, db.break_start + INTERVAL '20 minutes'),
            db.break_start + INTERVAL '20 minutes'
          ) - db.break_start
        ), INTERVAL '0 seconds')
        FROM dealer_breaks db
        JOIN dealer_assignments dass ON dass.id = db.assignment_id
        WHERE dass.attendance_id = da.id
        ) AS total_break_duration
      FROM dealer_attendance da
      WHERE da.dealer_id IS NOT NULL
        AND da.shift_date >= p_from_date
        AND da.shift_date <= p_to_date
        AND da.status IN ('checked_in', 'checked_out')
    ),
    -- Step 2: Compute hours per dealer per day (capped)
    dealer_daily_hours AS (
      SELECT
        ah.dealer_id,
        ah.shift_date,
        LEAST(
          EXTRACT(EPOCH FROM (ah.effective_checkout - ah.check_in_time)) / 3600
          - EXTRACT(EPOCH FROM ah.total_break_duration) / 3600,
          v_max_daily_hours
        ) AS net_hours,
        ah.overtime_minutes
      FROM attendance_hours ah
    ),
    -- Step 3: Aggregate per dealer over date range
    dealer_totals AS (
      SELECT
        ddh.dealer_id,
        ROUND(COALESCE(SUM(ddh.net_hours), 0)::NUMERIC, 1) AS total_hours,
        COALESCE(SUM(ddh.overtime_minutes), 0)::INT AS overtime_minutes,
        COUNT(DISTINCT ddh.shift_date)::INT AS days_worked
      FROM dealer_daily_hours ddh
      GROUP BY ddh.dealer_id
    )
  -- Step 4: Final SELECT with pay calculation
  SELECT
    d.id,
    d.full_name,
    d.tier,
    COALESCE(d.employment_type, 'full_time') AS employment_type,
    COALESCE(
      d.hourly_rate_vnd,
      CASE WHEN COALESCE(d.employment_type, 'full_time') = 'part_time' THEN v_min_hourly_rate ELSE v_min_hourly_rate END
    )::INT AS hourly_rate_vnd,
    COALESCE(d.base_rate_vnd, v_min_base_rate)::INT AS base_rate_vnd,
    COALESCE(dt.total_hours, 0) AS total_hours,
    COALESCE(dt.overtime_minutes, 0) AS overtime_minutes,
    COUNT(DISTINCT dassign.id)::INT AS total_swings,
    CASE
      -- Part-time: hours × hourly rate
      WHEN COALESCE(d.employment_type, 'full_time') = 'part_time'
        THEN ROUND(COALESCE(dt.total_hours, 0) * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate), 0)::NUMERIC
      -- Full-time WITH base_rate set: base_rate × days_worked
      WHEN d.base_rate_vnd IS NOT NULL
        THEN ROUND(COALESCE(dt.days_worked, 0) * d.base_rate_vnd, 0)::NUMERIC
      -- Full-time WITHOUT base_rate: hours × hourly_rate (fallback)
      ELSE ROUND(COALESCE(dt.total_hours, 0) * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate), 0)::NUMERIC
    END AS base_pay,
    -- Overtime: same for all types — OT minutes × hourly_rate × 1.5
    ROUND(COALESCE(dt.overtime_minutes, 0) / 60.0 * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate) * 1.5, 0)::NUMERIC AS overtime_pay,
    CASE
      WHEN COALESCE(d.employment_type, 'full_time') = 'part_time'
        THEN ROUND(COALESCE(dt.total_hours, 0) * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate), 0)::NUMERIC
           + ROUND(COALESCE(dt.overtime_minutes, 0) / 60.0 * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate) * 1.5, 0)::NUMERIC
      WHEN d.base_rate_vnd IS NOT NULL
        THEN ROUND(COALESCE(dt.days_worked, 0) * d.base_rate_vnd, 0)::NUMERIC
           + ROUND(COALESCE(dt.overtime_minutes, 0) / 60.0 * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate) * 1.5, 0)::NUMERIC
      ELSE ROUND(COALESCE(dt.total_hours, 0) * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate), 0)::NUMERIC
           + ROUND(COALESCE(dt.overtime_minutes, 0) / 60.0 * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate) * 1.5, 0)::NUMERIC
    END AS total_pay
  FROM dealers d
  LEFT JOIN dealer_totals dt ON dt.dealer_id = d.id
  LEFT JOIN dealer_attendance da ON da.dealer_id = d.id
    AND da.shift_date >= p_from_date
    AND da.shift_date <= p_to_date
    AND da.status IN ('checked_in', 'checked_out')
  LEFT JOIN dealer_assignments dassign ON dassign.attendance_id = da.id AND dassign.status = 'assigned'
  WHERE d.club_id = p_club_id
    AND d.status = 'active'
  GROUP BY d.id, d.full_name, d.tier, d.employment_type, d.hourly_rate_vnd, d.base_rate_vnd, dt.total_hours, dt.overtime_minutes, dt.days_worked
  ORDER BY d.tier, d.full_name;
END;
$$;

COMMENT ON FUNCTION get_dealer_payroll IS 'Payroll: part-time = hours×rate, full-time = base_rate×days or hours×rate fallback. Capped at 16h/day.';
