BEGIN;

-- =============================================================================
-- Migration: Fix calculate_dealer_payroll — proper net pay formula
--
-- Sprint 2 had:  net_pay = gross + adjustments + tips      (insurance not deducted)
--                net_pay_after_tax = net_pay                (PIT always 0)
--
-- Sprint 4 fixes:
--   1. BHXH/BHYT/BHTN base = LEAST(gross, 46,800,000) — tips EXCLUDED from base
--   2. taxable_income = (gross + tips) - insurance - 11M - (dependents × 4.4M)  [FT]
--                      = (gross + tips) - 11M - (dependents × 4.4M)              [PT]
--   3. PIT = calculate_pit_vn(GREATEST(taxable_income, 0))
--   4. net_pay_after_tax = gross + tips - insurance - PIT
--   5. net_pay = net_pay_after_tax + adjustments  (tips NOT double-counted)
--   6. Added p_dependents INT DEFAULT 0 parameter
--   7. Added bhxh_base_vnd, taxable_income_vnd to JSON output for debug traceability
--
-- All existing output fields preserved — NO breaking changes to UI.
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_dealer_payroll(
  p_dealer_id   UUID,
  p_start_date  DATE,
  p_end_date    DATE,
  p_dependents  INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dealer                  RECORD;
  v_total_shifts            INT := 0;
  v_total_hours             NUMERIC := 0;
  v_regular_hours           NUMERIC := 0;
  v_ot_hours                NUMERIC := 0;
  v_base_salary_vnd         BIGINT := 0;
  v_regular_pay_vnd         BIGINT := 0;
  v_ot_pay_vnd              BIGINT := 0;
  v_gross_pay_vnd           BIGINT := 0;
  v_total_adjustments_vnd   BIGINT := 0;
  v_tips_amount_vnd          BIGINT := 0;
  v_bhxh_base               BIGINT := 0;
  v_bhxh_deduction_vnd      BIGINT := 0;
  v_bhyt_deduction_vnd      BIGINT := 0;
  v_bhtn_deduction_vnd      BIGINT := 0;
  v_total_insurance          BIGINT := 0;
  v_taxable_income           BIGINT := 0;
  v_pit_deduction_vnd        BIGINT := 0;
  v_net_pay_after_tax_vnd   BIGINT := 0;
  v_net_pay_vnd             BIGINT := 0;
  v_personal_deduction       CONSTANT BIGINT := 11000000;
  v_dependent_deduction      CONSTANT BIGINT := 4400000;
  v_bhxh_cap                CONSTANT BIGINT := 46800000;
  v_shift_details            JSONB := '[]'::JSONB;
  v_shift_record             RECORD;
  v_shift_hours              NUMERIC;
  v_shift_regular            NUMERIC;
  v_shift_ot                 NUMERIC;
  v_min_hourly_rate          CONSTANT INT := 50000;
BEGIN
  -- Get dealer info
  SELECT id, full_name, employment_type, monthly_salary_vnd, hourly_rate_vnd,
         COALESCE(standard_hours_per_shift, 8) AS standard_hours_per_shift,
         COALESCE(ot_multiplier, 1.5) AS ot_multiplier
  INTO v_dealer
  FROM public.dealers
  WHERE id = p_dealer_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Dealer not found or inactive');
  END IF;

  IF COALESCE(v_dealer.hourly_rate_vnd, 0) < v_min_hourly_rate THEN
    v_dealer.hourly_rate_vnd := v_min_hourly_rate;
  END IF;

  -- Loop through attendance records in the period
  FOR v_shift_record IN
    SELECT
      da.id AS attendance_id,
      da.check_in_time,
      da.check_out_time,
      da.overtime_minutes,
      da.total_worked_minutes_today,
      EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, now()) - da.check_in_time)) / 3600 AS shift_hours_raw,
      (da.check_out_time IS NOT NULL AND DATE(da.check_out_time) > DATE(da.check_in_time)) AS is_overnight
    FROM public.dealer_attendance da
    WHERE da.dealer_id = p_dealer_id
      AND da.status IN ('checked_in', 'checked_out')
      AND da.check_in_time IS NOT NULL
      AND da.check_in_time::DATE BETWEEN p_start_date AND p_end_date
    ORDER BY da.check_in_time
  LOOP
    IF v_shift_record.shift_hours_raw IS NULL OR v_shift_record.shift_hours_raw < 0 THEN
      CONTINUE;
    END IF;

    v_shift_hours := LEAST(ROUND(v_shift_record.shift_hours_raw::NUMERIC, 2), 24);

    IF v_dealer.employment_type = 'full_time' THEN
      v_shift_regular := LEAST(v_shift_hours, v_dealer.standard_hours_per_shift);
      v_shift_ot := GREATEST(v_shift_hours - v_dealer.standard_hours_per_shift, 0);
    ELSE
      v_shift_regular := v_shift_hours;
      v_shift_ot := 0;
    END IF;

    v_regular_hours := v_regular_hours + v_shift_regular;
    v_ot_hours := v_ot_hours + v_shift_ot;
    v_total_hours := v_total_hours + v_shift_hours;
    v_total_shifts := v_total_shifts + 1;

    v_shift_details := v_shift_details || jsonb_build_object(
      'attendance_id', v_shift_record.attendance_id,
      'check_in_time', v_shift_record.check_in_time,
      'check_out_time', v_shift_record.check_out_time,
      'total_worked_minutes', v_shift_record.total_worked_minutes_today,
      'overtime_minutes', v_shift_record.overtime_minutes,
      'shift_hours', v_shift_hours,
      'regular_hours', v_shift_regular,
      'ot_hours', v_shift_ot,
      'is_overnight', v_shift_record.is_overnight
    );
  END LOOP;

  -- ================================================================
  -- PAY CALCULATION
  -- ================================================================

  IF v_dealer.employment_type = 'full_time' THEN
    v_base_salary_vnd := COALESCE(v_dealer.monthly_salary_vnd, 0);
    v_regular_pay_vnd := 0;
    v_ot_pay_vnd := FLOOR((v_ot_hours * v_dealer.hourly_rate_vnd * v_dealer.ot_multiplier)::NUMERIC)::BIGINT;
    v_gross_pay_vnd := v_base_salary_vnd + v_ot_pay_vnd;
  ELSE
    v_base_salary_vnd := 0;
    v_regular_pay_vnd := FLOOR((v_regular_hours * v_dealer.hourly_rate_vnd)::NUMERIC)::BIGINT;
    v_ot_pay_vnd := 0;
    v_gross_pay_vnd := v_regular_pay_vnd;
  END IF;

  -- Adjustments
  SELECT COALESCE(SUM(
    CASE adjustment_type
      WHEN 'BONUS' THEN amount_vnd
      WHEN 'PENALTY' THEN -amount_vnd
      WHEN 'DEDUCTION' THEN -amount_vnd
      WHEN 'ADVANCE' THEN -amount_vnd
      WHEN 'OTHER' THEN amount_vnd
      ELSE 0
    END
  ), 0)
  INTO v_total_adjustments_vnd
  FROM public.payroll_adjustments pa
  WHERE EXISTS (
    SELECT 1 FROM public.dealer_payroll dp
    WHERE dp.id = pa.payroll_id
      AND dp.dealer_id = p_dealer_id
      AND dp.period_id IN (
        SELECT id FROM public.payroll_periods
        WHERE period_start >= p_start_date
          AND period_end <= p_end_date
      )
  );

  -- Tips: placeholder (Sprint 3 — to be populated from dealer_tips table)
  v_tips_amount_vnd := 0;

  -- ================================================================
  -- BHXH / BHYT / BHTN — FT only, with ceiling cap
  -- Base = LEAST(gross, 46,800,000) — tips NOT included in insurance base
  -- ================================================================

  IF v_dealer.employment_type = 'full_time' THEN
    v_bhxh_base := LEAST(v_gross_pay_vnd, v_bhxh_cap);
    v_bhxh_deduction_vnd := FLOOR((v_bhxh_base * 8) / 100)::BIGINT;      -- 8%
    v_bhyt_deduction_vnd := FLOOR((v_bhxh_base * 15) / 1000)::BIGINT;    -- 1.5%
    v_bhtn_deduction_vnd := FLOOR((v_bhxh_base * 1) / 100)::BIGINT;      -- 1%
    v_total_insurance := v_bhxh_deduction_vnd + v_bhyt_deduction_vnd + v_bhtn_deduction_vnd;
  ELSE
    v_bhxh_base := 0;
    v_bhxh_deduction_vnd := 0;
    v_bhyt_deduction_vnd := 0;
    v_bhtn_deduction_vnd := 0;
    v_total_insurance := 0;
  END IF;

  -- ================================================================
  -- PIT: progressive VN tax via calculate_pit_vn()
  -- FT: taxable = (gross + tips) - insurance - 11M - (dependents × 4.4M)
  -- PT: taxable = (gross + tips) - 11M - (dependents × 4.4M)
  -- ================================================================

  IF v_dealer.employment_type = 'full_time' THEN
    v_taxable_income := (v_gross_pay_vnd + v_tips_amount_vnd)
                       - v_total_insurance
                       - v_personal_deduction
                       - (COALESCE(p_dependents, 0)::BIGINT * v_dependent_deduction);
  ELSE
    v_taxable_income := (v_gross_pay_vnd + v_tips_amount_vnd)
                       - v_personal_deduction
                       - (COALESCE(p_dependents, 0)::BIGINT * v_dependent_deduction);
  END IF;

  v_pit_deduction_vnd := calculate_pit_vn(GREATEST(v_taxable_income, 0));

  -- ================================================================
  -- NET PAY
  -- net_pay_after_tax = gross + tips - insurance - PIT
  -- net_pay = net_pay_after_tax + adjustments  (tips NOT double-counted)
  -- ================================================================

  v_net_pay_after_tax_vnd := (v_gross_pay_vnd + v_tips_amount_vnd)
                           - v_total_insurance
                           - v_pit_deduction_vnd;

  v_net_pay_vnd := v_net_pay_after_tax_vnd + v_total_adjustments_vnd;

  RETURN jsonb_build_object(
    'dealer_id', p_dealer_id,
    'full_name', v_dealer.full_name,
    'employment_type', v_dealer.employment_type,
    'period_start', p_start_date,
    'period_end', p_end_date,
    'monthly_salary_vnd', v_dealer.monthly_salary_vnd,
    'hourly_rate_vnd', v_dealer.hourly_rate_vnd,
    'ot_multiplier', v_dealer.ot_multiplier,
    'standard_hours_per_shift', v_dealer.standard_hours_per_shift,
    'total_shifts', v_total_shifts,
    'total_hours', v_total_hours,
    'regular_hours', v_regular_hours,
    'ot_hours', v_ot_hours,
    'base_salary_vnd', v_base_salary_vnd,
    'regular_pay_vnd', v_regular_pay_vnd,
    'ot_pay_vnd', v_ot_pay_vnd,
    'gross_pay_vnd', v_gross_pay_vnd,
    'total_adjustments_vnd', v_total_adjustments_vnd,
    'tips_amount_vnd', v_tips_amount_vnd,
    'bhxh_base_vnd', v_bhxh_base,
    'bhxh_deduction_vnd', v_bhxh_deduction_vnd,
    'bhyt_deduction_vnd', v_bhyt_deduction_vnd,
    'bhtn_deduction_vnd', v_bhtn_deduction_vnd,
    'pit_deduction_vnd', v_pit_deduction_vnd,
    'taxable_income_vnd', v_taxable_income,
    'net_pay_vnd', v_net_pay_vnd,
    'net_pay_after_tax_vnd', v_net_pay_after_tax_vnd,
    'shifts', v_shift_details
  );
END;
$$;

COMMIT;