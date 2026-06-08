-- =============================================================================
-- DRY RUN: Compare old vs new net values for June 2026 payroll
-- Run this BEFORE Migration 4 to verify expected values.
-- This is NOT a migration — do NOT apply. Run in Supabase SQL Editor.
--
-- KEY FIX: taxable_income uses NEW insurance values (with cap),
--           not OLD values from DB. Previous version had this inconsistency.
--
-- Expected results for canary data (all FT dealers ~9-10M gross):
--   BHXH cap doesn't change values (gross < 46.8M)
--   taxable_income ≈ negative → PIT = 0
--   new_net_after_tax < old_net_after_tax (insurance now deducted from net)
--   delta = -(bhxh + bhyt + bhtn) for FT; 0 for PT
-- =============================================================================

WITH period_info AS (
  SELECT id FROM payroll_periods
  WHERE period_year = 2026 AND period_month = 6
  LIMIT 1
),
old_values AS (
  SELECT
    dp.id,
    d.full_name,
    dp.employment_type,
    dp.gross_pay_vnd,
    COALESCE(dp.tips_amount_vnd, 0) AS tips,
    dp.bhxh_deduction_vnd AS old_bhxh,
    dp.bhyt_deduction_vnd AS old_bhyt,
    dp.bhtn_deduction_vnd AS old_bhtn,
    dp.pit_deduction_vnd AS old_pit,
    dp.net_pay_after_tax_vnd AS old_net_after_tax,
    dp.net_pay_vnd AS old_net_pay,
    COALESCE(dp.total_adjustments_vnd, 0) AS adjustments
  FROM dealer_payroll dp
  JOIN dealers d ON d.id = dp.dealer_id
  CROSS JOIN period_info pi
  WHERE dp.period_id = pi.id
),
computed AS (
  SELECT
    o.*,
    -- NEW insurance (FT only, capped at 46.8M; PT = 0)
    CASE WHEN o.employment_type = 'full_time'
         THEN FLOOR((LEAST(o.gross_pay_vnd, 46800000) * 8) / 100)::BIGINT
         ELSE 0
    END AS new_bhxh,
    CASE WHEN o.employment_type = 'full_time'
         THEN FLOOR((LEAST(o.gross_pay_vnd, 46800000) * 15) / 1000)::BIGINT
         ELSE 0
    END AS new_bhyt,
    CASE WHEN o.employment_type = 'full_time'
         THEN FLOOR((LEAST(o.gross_pay_vnd, 46800000) * 1) / 100)::BIGINT
         ELSE 0
    END AS new_bhtn,
    -- OLD insurance total (from DB)
    (COALESCE(o.old_bhxh, 0) + COALESCE(o.old_bhyt, 0) + COALESCE(o.old_bhtn, 0)) AS old_insurance_total
  FROM old_values o
),
final_calc AS (
  SELECT
    c.*,
    -- NEW insurance total
    (c.new_bhxh + c.new_bhyt + c.new_bhtn) AS new_insurance_total,
    -- Taxable income using NEW insurance values (not old)
    CASE WHEN c.employment_type = 'full_time'
         THEN (c.gross_pay_vnd + c.tips)
              - (c.new_bhxh + c.new_bhyt + c.new_bhtn)
              - 11000000
         ELSE (c.gross_pay_vnd + c.tips) - 11000000
    END AS new_taxable_income_raw,
    -- PIT (called once per row)
    calculate_pit_vn(GREATEST(CASE WHEN c.employment_type = 'full_time'
         THEN (c.gross_pay_vnd + c.tips)
              - (c.new_bhxh + c.new_bhyt + c.new_bhtn)
              - 11000000
         ELSE (c.gross_pay_vnd + c.tips) - 11000000
    END, 0)) AS new_pit
  FROM computed c
)
SELECT
  f.full_name,
  f.employment_type,
  f.gross_pay_vnd,
  -- Insurance comparison
  f.old_insurance_total,
  (f.new_bhxh + f.new_bhyt + f.new_bhtn) AS new_insurance_total,
  (f.new_bhxh + f.new_bhyt + f.new_bhtn - f.old_insurance_total) AS insurance_delta,
  -- Detailed breakdown
  f.new_bhxh,
  f.new_bhyt,
  f.new_bhtn,
  -- Taxable income & PIT
  GREATEST(f.new_taxable_income_raw, 0) AS new_taxable_income,
  f.old_pit,
  f.new_pit,
  -- Net after tax
  f.old_net_after_tax,
  (f.gross_pay_vnd + f.tips - (f.new_bhxh + f.new_bhyt + f.new_bhtn) - f.new_pit) AS new_net_after_tax,
  -- Final net pay
  f.old_net_pay,
  (f.gross_pay_vnd + f.tips - (f.new_bhxh + f.new_bhyt + f.new_bhtn) - f.new_pit + f.adjustments) AS new_net_pay,
  -- Bottom line: how much money changes
  f.old_net_pay - (f.gross_pay_vnd + f.tips - (f.new_bhxh + f.new_bhyt + f.new_bhtn) - f.new_pit + f.adjustments) AS delta_net_pay
FROM final_calc f
ORDER BY f.employment_type, f.full_name;