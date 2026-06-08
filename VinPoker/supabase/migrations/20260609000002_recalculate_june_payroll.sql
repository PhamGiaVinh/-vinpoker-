BEGIN;

-- =============================================================================
-- Migration: Recalculate June 2026 dealer_payroll with corrected formula
-- Version: 2.0 (Optimized & Fixed)
--
-- Changes from Sprint 2:
--   1. BHXH/BHYT/BHTN: recalculate with LEAST(gross, 46,800,000) cap
--   2. PIT: calculate via calculate_pit_vn()
--   3. net_pay_after_tax = gross + tips - insurance - PIT
--   4. net_pay = net_pay_after_tax + adjustments  (tips NOT double-counted)
--
-- Strategy:
--   - Timestamped backup table (safe for re-runs)
--   - Nested CTEs: old_values → computed → computed_final → computed_with_net
--   - calculate_pit_vn() called ONCE per row in computed_final
--   - Pre-calculated net values used for both UPDATE and AUDIT
--   - Audit log includes full old/new comparison for rollback capability
-- =============================================================================

-- Step 0: Timestamped backup (safe for re-runs — won't overwrite)
DO $$
DECLARE
  v_backup_name TEXT;
  v_count INT;
BEGIN
  v_backup_name := 'dealer_payroll_backup_202606_' || TO_CHAR(NOW(), 'YYYYMMDD_HH24MISS');

  -- Check if any backup already exists for this period
  SELECT COUNT(*) INTO v_count FROM information_schema.tables
  WHERE table_name LIKE 'dealer_payroll_backup_202606_%';

  IF v_count = 0 THEN
    EXECUTE format(
      'CREATE TABLE %I AS SELECT dp.*, pp.period_year, pp.period_month
       FROM dealer_payroll dp
       JOIN payroll_periods pp ON pp.id = dp.period_id
       WHERE pp.period_year = 2026 AND pp.period_month = 6',
      v_backup_name
    );
    RAISE NOTICE 'Backup created: %', v_backup_name;
  ELSE
    RAISE NOTICE 'Backup already exists for period 2026-06, skipping.';
  END IF;
END $$;

-- Step 1-5: Atomic UPDATE + AUDIT in single transaction using data-modifying CTEs
WITH target_period AS (
  SELECT id FROM payroll_periods
  WHERE period_year = 2026 AND period_month = 6
  LIMIT 1
),
old_values AS (
  SELECT
    dp.id,
    dp.club_id,
    dp.dealer_id,
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
  JOIN target_period tp ON dp.period_id = tp.id
),
computed AS (
  SELECT
    o.*,
    -- Calculate NEW insurance components (FT only, capped; PT = 0)
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
    END AS new_bhtn
  FROM old_values o
),
computed_final AS (
  SELECT
    c.*,
    -- Aggregate insurance from components (calculated once, reused)
    (c.new_bhxh + c.new_bhyt + c.new_bhtn) AS total_insurance,
    -- Taxable income (using NEW insurance, not old DB values)
    CASE WHEN c.employment_type = 'full_time'
         THEN (c.gross_pay_vnd + c.tips)
              - (c.new_bhxh + c.new_bhyt + c.new_bhtn)
              - 11000000
         ELSE (c.gross_pay_vnd + c.tips) - 11000000
    END AS taxable_income_raw,
    -- PIT (called exactly once per row)
    calculate_pit_vn(GREATEST(CASE WHEN c.employment_type = 'full_time'
         THEN (c.gross_pay_vnd + c.tips)
              - (c.new_bhxh + c.new_bhyt + c.new_bhtn)
              - 11000000
         ELSE (c.gross_pay_vnd + c.tips) - 11000000
    END, 0)) AS new_pit
  FROM computed c
),
computed_with_net AS (
  SELECT
    cf.*,
    -- Final net values (used for both UPDATE and AUDIT)
    (cf.gross_pay_vnd + cf.tips - cf.total_insurance - cf.new_pit) AS final_net_after_tax,
    (cf.gross_pay_vnd + cf.tips - cf.total_insurance - cf.new_pit + cf.adjustments) AS final_net_pay
  FROM computed_final cf
),
updated AS (
  UPDATE dealer_payroll dp
  SET
    bhxh_deduction_vnd = c.new_bhxh,
    bhyt_deduction_vnd = c.new_bhyt,
    bhtn_deduction_vnd = c.new_bhtn,
    pit_deduction_vnd = c.new_pit,
    net_pay_after_tax_vnd = c.final_net_after_tax,
    net_pay_vnd = c.final_net_pay,
    updated_at = now()
  FROM computed_with_net c
  WHERE dp.id = c.id
  RETURNING dp.id, dp.club_id
)
INSERT INTO payroll_audit_log (table_name, record_id, club_id, action, old_values, new_values, changed_by, changed_at, reason)
SELECT
  'dealer_payroll',
  u.id,
  u.club_id,
  'UPDATE',
  jsonb_build_object(
    'old_bhxh', c.old_bhxh,
    'old_bhyt', c.old_bhyt,
    'old_bhtn', c.old_bhtn,
    'old_pit', c.old_pit,
    'old_net_after_tax', c.old_net_after_tax,
    'old_net_pay', c.old_net_pay
  ),
  jsonb_build_object(
    'new_bhxh', c.new_bhxh,
    'new_bhyt', c.new_bhyt,
    'new_bhtn', c.new_bhtn,
    'new_pit', c.new_pit,
    'new_net_after_tax', c.final_net_after_tax,
    'new_net_pay', c.final_net_pay,
    'total_insurance_deducted', c.total_insurance,
    'taxable_income_raw', c.taxable_income_raw,
    'gross_pay_vnd', c.gross_pay_vnd,
    'tips', c.tips
  ),
  '6c320d89-0de3-4ad1-9238-3ca475b006cf'::UUID,
  now(),
  'Sprint 4 net pay fix: BHXH cap (46.8M) + PIT via calculate_pit_vn() + insurance deducted from net'
FROM updated u
JOIN computed_with_net c ON c.id = u.id;

COMMIT;