BEGIN;

-- =============================================================================
-- Payroll System: dealer_scores VIEW update + get_dealer_payroll function
-- =============================================================================

-- 1. UPDATE dealer_scores VIEW: add pay rates + overtime columns
DROP VIEW IF EXISTS dealer_scores;
CREATE OR REPLACE VIEW dealer_scores AS
SELECT
  d.id AS dealer_id,
  d.full_name,
  d.tier,
  d.club_id,
  d.employment_type,
  COALESCE(d.hourly_rate_vnd, 0) AS hourly_rate_vnd,
  COALESCE(d.base_rate_vnd, 0) AS base_rate_vnd,
  COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0) AS total_hours,
  COALESCE(SUM(dsm.total_assignments), 0) AS total_swings,
  COALESCE(SUM(da.overtime_minutes), 0) AS overtime_minutes,
  COALESCE(ROUND(SUM(dsm.total_worked_minutes) / 60.0, 1), 0) * 1.0
    + COALESCE(SUM(dsm.total_assignments), 0) * 0.5
    + CASE d.tier
        WHEN 'A' THEN 20
        WHEN 'B' THEN 10
        ELSE 0
      END AS score
FROM dealers d
LEFT JOIN dealer_attendance da ON da.dealer_id = d.id AND da.shift_date >= CURRENT_DATE - 30
LEFT JOIN dealer_shift_metrics dsm ON dsm.attendance_id = da.id
GROUP BY d.id, d.full_name, d.tier, d.club_id, d.employment_type, d.hourly_rate_vnd, d.base_rate_vnd;

COMMENT ON VIEW dealer_scores IS 'Dealer scores + pay rates based on 30‑day history. Score = hours×1 + swings×0.5 + tier_bonus(A=20,B=10).';

-- 2. CREATE get_dealer_payroll function for date-range queries
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
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.full_name,
    d.tier,
    COALESCE(d.employment_type, 'full_time'),
    COALESCE(d.hourly_rate_vnd, CASE WHEN d.employment_type = 'part_time' THEN 100000 ELSE 40000 END)::INT,
    COALESCE(d.base_rate_vnd, CASE WHEN d.employment_type = 'part_time' THEN 0 ELSE 100000 END)::INT,
    ROUND(COALESCE(SUM(
      EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, CURRENT_TIMESTAMP) - da.check_in_time)) / 3600
      - COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(db.break_end, CURRENT_TIMESTAMP) - db.break_start)) / 3600)
        FROM dealer_breaks db
        JOIN dealer_assignments dass ON dass.id = db.assignment_id
        WHERE dass.attendance_id = da.id
      ), 0)
    ), 0)::NUMERIC, 1) AS total_hours,
    COALESCE(SUM(da.overtime_minutes), 0)::INT AS overtime_minutes,
    COUNT(DISTINCT dassign.id)::INT AS total_swings,
    CASE
      WHEN d.employment_type = 'part_time'
        THEN ROUND(COALESCE(SUM(
          EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, CURRENT_TIMESTAMP) - da.check_in_time)) / 3600
          - COALESCE((
            SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(db.break_end, CURRENT_TIMESTAMP) - db.break_start)) / 3600)
            FROM dealer_breaks db
            JOIN dealer_assignments dass ON dass.id = db.assignment_id
            WHERE dass.attendance_id = da.id
          ), 0)
        ), 0) * COALESCE(d.hourly_rate_vnd, 100000), 0)::NUMERIC
      ELSE COALESCE(d.base_rate_vnd, 100000)::NUMERIC
    END AS base_pay,
    CASE
      WHEN d.employment_type = 'part_time'
        THEN ROUND(COALESCE(SUM(da.overtime_minutes), 0) / 60.0 * COALESCE(d.hourly_rate_vnd, 100000) * 1.5, 0)::NUMERIC
      ELSE ROUND(COALESCE(SUM(da.overtime_minutes), 0) / 60.0 * COALESCE(d.hourly_rate_vnd, 40000) * 1.5, 0)::NUMERIC
    END AS overtime_pay,
    CASE
      WHEN d.employment_type = 'part_time'
        THEN ROUND(COALESCE(SUM(
          EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, CURRENT_TIMESTAMP) - da.check_in_time)) / 3600
          - COALESCE((
            SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(db.break_end, CURRENT_TIMESTAMP) - db.break_start)) / 3600)
            FROM dealer_breaks db
            JOIN dealer_assignments dass ON dass.id = db.assignment_id
            WHERE dass.attendance_id = da.id
          ), 0)
        ), 0) * COALESCE(d.hourly_rate_vnd, 100000)
        + COALESCE(SUM(da.overtime_minutes), 0) / 60.0 * COALESCE(d.hourly_rate_vnd, 100000) * 1.5, 0)::NUMERIC
      ELSE COALESCE(d.base_rate_vnd, 100000)::NUMERIC
        + ROUND(COALESCE(SUM(da.overtime_minutes), 0) / 60.0 * COALESCE(d.hourly_rate_vnd, 40000) * 1.5, 0)::NUMERIC
    END AS total_pay
  FROM dealers d
  LEFT JOIN dealer_attendance da ON da.dealer_id = d.id
    AND da.shift_date >= p_from_date
    AND da.shift_date <= p_to_date
    AND da.status IN ('checked_in', 'checked_out')
  LEFT JOIN dealer_assignments dassign ON dassign.attendance_id = da.id AND dassign.status = 'assigned'
  WHERE d.club_id = p_club_id
    AND d.status = 'active'
  GROUP BY d.id, d.full_name, d.tier, d.employment_type, d.hourly_rate_vnd, d.base_rate_vnd
  ORDER BY d.tier, d.full_name;
END;
$$;

COMMENT ON FUNCTION get_dealer_payroll IS 'Returns payroll data for all active dealers in a club for a date range. Calculates base_pay, overtime_pay based on employment_type.';

COMMIT;

-- =============================================================================
-- ROLLBACK COMPANION
--   DROP FUNCTION IF EXISTS get_dealer_payroll;
--   DROP VIEW IF EXISTS dealer_scores;
--   -- Recreate original dealer_scores from 20260610000000_dealer_management.sql
-- =============================================================================
