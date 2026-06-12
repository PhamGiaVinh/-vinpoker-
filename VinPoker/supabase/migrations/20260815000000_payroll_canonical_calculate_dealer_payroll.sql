-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL CANONICAL SOURCE-OF-TRUTH: calculate_dealer_payroll (4-param)
--
-- Purpose: end migration/live drift (audit B1). The repo contained two
-- conflicting committed definitions (3-param 20260717000000 informational-tax,
-- 4-param 20260609000001 no-proration), while the LIVE database runs a third
-- body: 4-param + insurance/PIT deducted + FT base-salary proration via
-- club_settings.standard_shifts_per_month (the "applied directly" hotfix
-- 20260609000003). This migration commits that verified live body verbatim.
--
-- ZERO BEHAVIOR CHANGE: the body below is byte-identical to
-- pg_get_functiondef() captured from the linked DB (orlesggcjamwuknxwcpk)
-- on 2026-06-12. md5(pg_get_functiondef) = 0ffc563d65f12790a17b4673c82a3dce.
-- Verification report: VinPoker/LIVE_PAYROLL_RPC_VERIFICATION.md.
--
-- The 3-param overload does NOT exist on the live DB (20260717000000 was
-- history-repaired without executing SQL) and is intentionally NOT recreated.
-- Guard below drops it if it ever exists elsewhere, so every environment
-- converges on exactly ONE overload and 3-arg calls stay unambiguous.
--
-- ROLLBACK: re-apply the pre-change snapshot (identical body):
--   docs/emergency_rollbacks/PRE_CANONICAL_calculate_dealer_payroll_live_snapshot_20260612.sql
-- (CREATE OR REPLACE only — no DDL here is irreversible.)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.calculate_dealer_payroll(uuid, date, date);
CREATE OR REPLACE FUNCTION public.calculate_dealer_payroll(p_dealer_id uuid, p_start_date date, p_end_date date, p_dependents integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_tips_amount_vnd         BIGINT := 0;
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
  v_standard_shifts          INT := 26;
  v_salary_ratio            NUMERIC := 1;
  v_shift_details            JSONB := '[]'::JSONB;
  v_shift_record             RECORD;
  v_shift_hours              NUMERIC;
  v_shift_regular            NUMERIC;
  v_shift_ot                 NUMERIC;
  v_min_hourly_rate          CONSTANT INT := 50000;
BEGIN
  SELECT id, full_name, employment_type, monthly_salary_vnd, hourly_rate_vnd,
         COALESCE(standard_hours_per_shift, 8) AS standard_hours_per_shift,
         COALESCE(ot_multiplier, 1.5) AS ot_multiplier,
         club_id
  INTO v_dealer
  FROM public.dealers
  WHERE id = p_dealer_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Dealer not found or inactive');
  END IF;

  SELECT COALESCE(standard_shifts_per_month, 26) INTO v_standard_shifts
  FROM public.club_settings
  WHERE club_id = v_dealer.club_id;

  IF COALESCE(v_dealer.hourly_rate_vnd, 0) < v_min_hourly_rate THEN
    v_dealer.hourly_rate_vnd := v_min_hourly_rate;
  END IF;

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
  -- FT: base_salary = FLOOR(monthly_salary x LEAST(shifts, standard) / standard)
  -- PT: unchanged (hourly rate, no base salary)
  -- ================================================================

  IF v_dealer.employment_type = 'full_time' THEN
    v_salary_ratio := LEAST(v_total_shifts, v_standard_shifts)::NUMERIC / v_standard_shifts::NUMERIC;
    v_base_salary_vnd := FLOOR(COALESCE(v_dealer.monthly_salary_vnd, 0) * v_salary_ratio)::BIGINT;
    v_regular_pay_vnd := 0;
    v_ot_pay_vnd := FLOOR((v_ot_hours * v_dealer.hourly_rate_vnd * v_dealer.ot_multiplier)::NUMERIC)::BIGINT;
    v_gross_pay_vnd := v_base_salary_vnd + v_ot_pay_vnd;
  ELSE
    v_base_salary_vnd := 0;
    v_regular_pay_vnd := FLOOR((v_regular_hours * v_dealer.hourly_rate_vnd)::NUMERIC)::BIGINT;
    v_ot_pay_vnd := 0;
    v_gross_pay_vnd := v_regular_pay_vnd;
  END IF;

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

  v_tips_amount_vnd := 0;

  IF v_dealer.employment_type = 'full_time' THEN
    v_bhxh_base := LEAST(v_gross_pay_vnd, v_bhxh_cap);
    v_bhxh_deduction_vnd := FLOOR((v_bhxh_base * 8) / 100)::BIGINT;
    v_bhyt_deduction_vnd := FLOOR((v_bhxh_base * 15) / 1000)::BIGINT;
    v_bhtn_deduction_vnd := FLOOR((v_bhxh_base * 1) / 100)::BIGINT;
    v_total_insurance := v_bhxh_deduction_vnd + v_bhyt_deduction_vnd + v_bhtn_deduction_vnd;
  ELSE
    v_bhxh_base := 0;
    v_bhxh_deduction_vnd := 0;
    v_bhyt_deduction_vnd := 0;
    v_bhtn_deduction_vnd := 0;
    v_total_insurance := 0;
  END IF;

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
    'standard_shifts_per_month', v_standard_shifts,
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
$function$;

COMMIT;