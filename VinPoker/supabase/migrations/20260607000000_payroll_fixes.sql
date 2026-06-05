-- =============================================================================
-- Migration: 20260607000000_payroll_fixes.sql
-- 
-- Decisions applied:
--   1. Per-day OT (aggregate by day first, then LEAST 8h) - was per-attendance
--   2. Uncapped break deduction (was capped at 20min via LEAST())
--   5. Expose days_worked in RETURNS TABLE for FT base_pay calculation
-- 
-- Minor fixes:
--   M1. 20min fallback for active breaks (NULL break_end) - not NOW() to avoid runaway
--   M2. Aligned status filters in overtime_minutes + total_swings CTEs
--   M3. COALESCE(d.employment_type, 'full_time') in all CASE branches
--   M4-A. ORDER BY d.tier, d.full_name (preserve original seniority-first ordering)
-- 
-- Other fixes (preserved original behavior):
--   - Status filter: IN ('checked_in', 'checked_out') - keeps active dealers visible
--   - Date filter: da.shift_date (not check_in_time::DATE) - respects scheduled shift
--   - COALESCE fallbacks everywhere for NULL rates/values
--   - Show all active dealers (removed AND dt.total_hours > 0)
-- 
-- PL/pgSQL Notes:
--   - All CTE column names aliased to avoid collision with RETURNS TABLE OUT params
--   - hourly_rate_vnd, base_rate_vnd are INTEGER in dealers table (not NUMERIC)
--   - overtime_minutes is sourced from dealer_attendance.overtime_minutes
-- 
-- Forward-only: Does NOT backfill historical payrolls.
--   Historical payrolls in payroll_periods remain unchanged.
--   New calculation applies to periods from 2026-06-07 onward.
-- =============================================================================

DROP FUNCTION IF EXISTS get_dealer_payroll(uuid, date, date);

CREATE OR REPLACE FUNCTION get_dealer_payroll(p_club_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS TABLE (
  dealer_id UUID,
  full_name TEXT,
  tier TEXT,
  employment_type TEXT,
  hourly_rate_vnd INT,
  base_rate_vnd INT,
  total_hours NUMERIC,
  regular_hours NUMERIC,
  ot_hours NUMERIC,
  overtime_minutes INT,
  total_swings INT,
  days_worked INT,
  base_pay NUMERIC,
  overtime_pay NUMERIC,
  total_pay NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  v_standard_hours CONSTANT INT := 8;
  v_ot_multiplier CONSTANT NUMERIC := 1.5;
  v_max_daily_hours CONSTANT INT := 16;
  v_min_hourly_rate CONSTANT INT := 50000;
BEGIN
  RETURN QUERY
  WITH
    -- =====================================================================
    -- CTE 1: attendance_hours
    --   One row per attendance record. Computes net_hours = checkout - checkin
    --   minus total break duration.
    --   Break duration uses M1 fallback: 20min for active (NULL break_end) breaks.
    --   Note: ah_* aliases prevent collision with RETURNS TABLE OUT parameters.
    -- =====================================================================
    attendance_hours AS (
      SELECT
        da.id AS attendance_id,
        da.dealer_id AS ah_dealer_id,
        da.check_in_time,
        da.check_out_time,
        da.shift_date,
        da.overtime_minutes AS ah_ot_minutes,
        LEAST(
          EXTRACT(EPOCH FROM (
            COALESCE(da.check_out_time, NOW()) - da.check_in_time
            - COALESCE((
              SELECT SUM(
                COALESCE(db.break_end, db.break_start + INTERVAL '20 minutes')
                - db.break_start
              )
              FROM dealer_breaks db
              JOIN dealer_assignments dass ON dass.id = db.assignment_id
              WHERE dass.attendance_id = da.id
                AND db.break_start IS NOT NULL
            ), INTERVAL '0')
          )) / 3600.0,
          v_max_daily_hours
        ) AS net_hours
      FROM dealer_attendance da
      JOIN dealers d ON d.id = da.dealer_id
      WHERE d.club_id = p_club_id
        AND da.status IN ('checked_in', 'checked_out')
        AND da.shift_date >= p_from_date
        AND da.shift_date <= p_to_date
    ),

    -- =====================================================================
    -- CTE 2: dealer_daily_hours
    --   Decision 1: Aggregate by (dealer_id, shift_date) FIRST.
    --   This converts per-attendance logic to per-day logic.
    --   A dealer with 2 shifts x 5h on same day => daily_net_hours = 10h
    -- =====================================================================
    dealer_daily_hours AS (
      SELECT
        ah.ah_dealer_id AS ddh_dealer_id,
        ah.shift_date,
        SUM(ah.net_hours) AS daily_net_hours
      FROM attendance_hours ah
      GROUP BY ah.ah_dealer_id, ah.shift_date
    ),

    -- =====================================================================
    -- CTE 3: dealer_daily_split
    --   Decision 1: Apply 8h cap on DAILY total (was per-attendance).
    --   regular = MIN(daily_hours, 8)
    --   shift_ot_hours = MAX(daily_hours - 8, 0)
    -- =====================================================================
    dealer_daily_split AS (
      SELECT
        ddh.ddh_dealer_id,
        ddh.shift_date,
        ddh.daily_net_hours AS net_hours,
        LEAST(ddh.daily_net_hours, v_standard_hours) AS regular_hours,
        GREATEST(ddh.daily_net_hours - v_standard_hours, 0) AS shift_ot_hours
      FROM dealer_daily_hours ddh
    ),

    -- =====================================================================
    -- CTE 4: dealer_overtime_minutes
    --   Informational only (per-swing OT minutes, not used in pay calc).
    --   M2: Aligned with dealer_swings status filter.
    --   Source: dealer_attendance.overtime_minutes (per-attendance).
    -- =====================================================================
    dealer_overtime_minutes AS (
      SELECT
        ah.ah_dealer_id,
        COALESCE(SUM(ah.ah_ot_minutes), 0)::INT AS dom_ot_minutes
      FROM attendance_hours ah
      GROUP BY ah.ah_dealer_id
    ),

    -- =====================================================================
    -- CTE 5: dealer_swings
    --   M2: Aligned with dealer_overtime_minutes status filter.
    -- =====================================================================
    dealer_swings AS (
      SELECT
        da.dealer_id,
        COUNT(DISTINCT dass.id)::INT AS total_swings
      FROM dealer_attendance da
      JOIN dealer_assignments dass ON dass.attendance_id = da.id
      WHERE da.shift_date >= p_from_date
        AND da.shift_date <= p_to_date
        AND dass.status IN ('assigned', 'on_break', 'completed')
      GROUP BY da.dealer_id
    ),

    -- =====================================================================
    -- CTE 6: dealer_totals
    --   Decision 5: days_worked exposed in RETURNS TABLE for FT base_pay.
    -- =====================================================================
    dealer_totals AS (
      SELECT
        dds.ddh_dealer_id,
        ROUND(COALESCE(SUM(dds.net_hours), 0)::NUMERIC, 1) AS total_hours,
        ROUND(COALESCE(SUM(dds.regular_hours), 0)::NUMERIC, 1) AS regular_hours,
        ROUND(COALESCE(SUM(dds.shift_ot_hours), 0)::NUMERIC, 1) AS ot_hours,
        COUNT(DISTINCT dds.shift_date)::INT AS days_worked
      FROM dealer_daily_split dds
      GROUP BY dds.ddh_dealer_id
    )

  -- =======================================================================
  -- FINAL SELECT
  --   - M3: COALESCE(d.employment_type, 'full_time') in all CASE branches
  --   - M4-A: ORDER BY d.tier, d.full_name (preserve original seniority-first)
  -- =======================================================================
  SELECT
    d.id,
    d.full_name,
    d.tier,
    d.employment_type,
    d.hourly_rate_vnd,
    d.base_rate_vnd,
    COALESCE(dt.total_hours, 0) AS total_hours,
    COALESCE(dt.regular_hours, 0) AS regular_hours,
    COALESCE(dt.ot_hours, 0) AS ot_hours,
    COALESCE(dom.dom_ot_minutes, 0) AS overtime_minutes,
    COALESCE(ds.total_swings, 0) AS total_swings,
    COALESCE(dt.days_worked, 0) AS days_worked,
    CASE
      WHEN COALESCE(d.employment_type, 'full_time') = 'part_time' THEN
        ROUND(COALESCE(dt.total_hours, 0) * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate), 0)
      WHEN d.base_rate_vnd IS NOT NULL AND d.base_rate_vnd > 0 THEN
        ROUND(COALESCE(dt.days_worked, 0) * d.base_rate_vnd, 0)
      ELSE
        ROUND(COALESCE(dt.regular_hours, 0) * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate), 0)
    END AS base_pay,
    CASE
      WHEN COALESCE(d.employment_type, 'full_time') = 'part_time' THEN
        0::NUMERIC
      ELSE
        ROUND(
          COALESCE(dt.ot_hours, 0)
          * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate)
          * v_ot_multiplier,
          0
        )
    END AS overtime_pay,
    CASE
      WHEN COALESCE(d.employment_type, 'full_time') = 'part_time' THEN
        ROUND(COALESCE(dt.total_hours, 0) * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate), 0)
      WHEN d.base_rate_vnd IS NOT NULL AND d.base_rate_vnd > 0 THEN
        ROUND(
          COALESCE(dt.days_worked, 0) * d.base_rate_vnd
          + COALESCE(dt.ot_hours, 0)
            * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate)
            * v_ot_multiplier,
          0
        )
      ELSE
        ROUND(
          COALESCE(dt.regular_hours, 0)
            * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate)
          + COALESCE(dt.ot_hours, 0)
            * COALESCE(d.hourly_rate_vnd, v_min_hourly_rate)
            * v_ot_multiplier,
          0
        )
    END AS total_pay
  FROM dealers d
  LEFT JOIN dealer_totals dt ON dt.ddh_dealer_id = d.id
  LEFT JOIN dealer_overtime_minutes dom ON dom.ah_dealer_id = d.id
  LEFT JOIN dealer_swings ds ON ds.dealer_id = d.id
  WHERE d.club_id = p_club_id
    AND d.status = 'active'
  ORDER BY d.tier, d.full_name;
END;
$func$;

COMMENT ON FUNCTION get_dealer_payroll IS
  'Payroll calculation v2: per-day OT, uncapped breaks, days_worked exposed. Applied from 2026-06-07 forward. No historical backfill. Decisions: 1 (per-day OT), 2 (uncapped breaks with 20min active-break fallback), 5 (days_worked exposed). Minor fixes: M1 (20min fallback), M2 (status alignment), M3 (COALESCE employment_type), M4-A (tier ordering).';
