-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL — MANUAL BHXH + TAX override — calculate_dealer_payroll
--
-- Builds on the live P3 body (20260909000000_payroll_p3_cross_month_overlap.sql).
-- Adds exactly TWO per-dealer overrides, read from dealers.manual_bhxh_vnd /
-- dealers.manual_tax_vnd (added by 20261001000000 — apply that FIRST):
--   (1) manual BHXH: if NOT NULL, REPLACES the auto-computed total insurance
--       (0 => BHXH/BHYT/BHTN all 0). Flows into taxable income + net unchanged.
--   (2) manual tax:  if NOT NULL, REPLACES the computed PIT (0 => no tax).
--
-- NO OTHER LOGIC CHANGES. When both columns are NULL the two IF blocks are skipped,
-- so every output (gross/insurance/PIT/taxable/net) is byte-identical to P3.
--
-- SOURCE-ONLY: apply is an owner-gated controlled op AND REQUIRES a golden-period
-- before/after diff proving net_pay is unchanged when both overrides are NULL (no
-- silent recompute of saved/locked periods). NO `supabase db push`, NO deploy_db.
--
-- ROLLBACK: re-apply 20260909000000_payroll_p3_cross_month_overlap.sql (the prior body).
-- ═══════════════════════════════════════════════════════════════════════════════
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
  v_insurance_base          BIGINT := 0;   -- P0: contractual base for social insurance (NOT gross)
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
  v_break_pay_mode           TEXT := 'paid_break';
  v_break_grace_minutes      INT := 35;
  v_break_deduct_hours       NUMERIC := 0;
  -- P3: cross-month overlap allocation
  v_period_start             TIMESTAMPTZ;     -- payroll period start, VN-local, inclusive
  v_period_end               TIMESTAMPTZ;     -- payroll period end, VN-local, EXCLUSIVE
  v_shift_credit             NUMERIC := 0;    -- fractional shift credit (base-salary prorate)
  v_total_eff_minutes        NUMERIC;         -- full effective shift span (P2 checkout)
  v_overlap_minutes          NUMERIC;         -- portion of the shift inside this period
  v_overlap_ratio            NUMERIC;         -- overlap_minutes / total_eff_minutes, (0,1]
BEGIN
  -- MANUAL OVERRIDE: also read dealers.manual_bhxh_vnd / manual_tax_vnd (NULL = auto).
  SELECT id, full_name, employment_type, monthly_salary_vnd, hourly_rate_vnd,
         COALESCE(standard_hours_per_shift, 8) AS standard_hours_per_shift,
         COALESCE(ot_multiplier, 1.5) AS ot_multiplier,
         club_id, manual_bhxh_vnd, manual_tax_vnd
  INTO v_dealer
  FROM public.dealers
  WHERE id = p_dealer_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Dealer not found or inactive');
  END IF;

  SELECT COALESCE(standard_shifts_per_month, 26) INTO v_standard_shifts
  FROM public.club_settings
  WHERE club_id = v_dealer.club_id;

  -- B2: break-pay policy (owner decision 2026-06-13; docs/payroll/B2_BREAK_PAY_MODE_DECISION.md)
  SELECT COALESCE(break_pay_mode, 'paid_break'), COALESCE(grace_minutes, 35)
  INTO v_break_pay_mode, v_break_grace_minutes
  FROM public.shift_break_policies
  WHERE club_id = v_dealer.club_id AND shift_type = 'default';
  IF NOT FOUND THEN
    v_break_pay_mode := 'paid_break';
    v_break_grace_minutes := 35;
  END IF;

  IF COALESCE(v_dealer.hourly_rate_vnd, 0) < v_min_hourly_rate THEN
    v_dealer.hourly_rate_vnd := v_min_hourly_rate;
  END IF;

  -- P3: payroll period as a Vietnam-local half-open interval [period_start, period_end).
  -- p_start_date 00:00 VN .. (p_end_date + 1 day) 00:00 VN exclusive.
  v_period_start := (p_start_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_period_end   := ((p_end_date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');

  FOR v_shift_record IN
    SELECT
      da.id AS attendance_id,
      da.check_in_time,
      da.check_out_time,
      da.overtime_minutes,
      da.total_worked_minutes_today,
      -- P2: open shift (no check-out) => effective checkout = check_in + one standard
      -- shift (NOT now()). Used for span/overlap AND the break clamp below.
      COALESCE(da.check_out_time, da.check_in_time + (v_dealer.standard_hours_per_shift * interval '1 hour')) AS eff_check_out,
      (da.check_out_time IS NOT NULL AND DATE(da.check_out_time) > DATE(da.check_in_time)) AS is_overnight
    FROM public.dealer_attendance da
    WHERE da.dealer_id = p_dealer_id
      AND da.status IN ('checked_in', 'checked_out')
      AND da.check_in_time IS NOT NULL
      -- P3: include any shift that OVERLAPS [period_start, period_end) (VN-local), not
      -- just shifts whose check-in date is in the period — so a shift's post-midnight
      -- hours are credited to the NEXT month's period as well.
      AND da.check_in_time < v_period_end
      AND COALESCE(da.check_out_time, da.check_in_time + (v_dealer.standard_hours_per_shift * interval '1 hour')) > v_period_start
    ORDER BY da.check_in_time
  LOOP
    -- P3: full effective shift span (P2 checkout) and its overlap with this period.
    v_total_eff_minutes := EXTRACT(EPOCH FROM (v_shift_record.eff_check_out - v_shift_record.check_in_time)) / 60.0;
    IF v_total_eff_minutes IS NULL OR v_total_eff_minutes <= 0 THEN
      CONTINUE;
    END IF;
    v_overlap_minutes := GREATEST(0, EXTRACT(EPOCH FROM (
        LEAST(v_shift_record.eff_check_out, v_period_end) - GREATEST(v_shift_record.check_in_time, v_period_start)
      )) / 60.0);
    IF v_overlap_minutes <= 0 THEN
      CONTINUE;   -- shift does not actually overlap this period
    END IF;
    v_overlap_ratio := v_overlap_minutes / v_total_eff_minutes;

    -- Full-shift paid hours (capped 24h). Regular/OT split is computed on the WHOLE
    -- shift; only the overlap fraction is credited to this period (below).
    v_shift_hours := LEAST(ROUND((v_total_eff_minutes / 60.0)::NUMERIC, 2), 24);

    -- B2: unpaid-break deduction - clamp each break to the shift window, merge
    -- overlapping intervals, grace per merged interval (with_grace mode), and
    -- deduct BEFORE the regular/OT split (Q3) so no fake OT is created.
    -- paid_break (default): block skipped entirely - zero behavior change.
    IF v_break_pay_mode IN ('unpaid_break_with_grace', 'unpaid_break_full') THEN
      SELECT COALESCE(SUM(
        CASE WHEN v_break_pay_mode = 'unpaid_break_full'
             THEN EXTRACT(EPOCH FROM (m.ge - m.gs)) / 60.0
             ELSE GREATEST(EXTRACT(EPOCH FROM (m.ge - m.gs)) / 60.0 - v_break_grace_minutes, 0)
        END), 0) / 60.0
      INTO v_break_deduct_hours
      FROM (
        SELECT MIN(g.s) AS gs, MAX(g.e) AS ge
        FROM (
          SELECT v2.s, v2.e, SUM(v2.new_grp) OVER (ORDER BY v2.s, v2.e) AS grp_id
          FROM (
            SELECT c.s, c.e,
                   CASE WHEN COALESCE(c.s > MAX(c.e) OVER (ORDER BY c.s, c.e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), TRUE)
                        THEN 1 ELSE 0 END AS new_grp
            FROM (
              SELECT GREATEST(db.break_start, v_shift_record.check_in_time) AS s,
                     LEAST(db.break_end, v_shift_record.eff_check_out) AS e
              FROM public.dealer_breaks db
              WHERE db.attendance_id = v_shift_record.attendance_id
                AND db.break_start IS NOT NULL
                AND db.break_end IS NOT NULL
            ) c
            WHERE c.e > c.s
          ) v2
        ) g
        GROUP BY g.grp_id
      ) m;

      v_shift_hours := GREATEST(ROUND(v_shift_hours - COALESCE(v_break_deduct_hours, 0), 2), 0);
    END IF;

    IF v_dealer.employment_type = 'full_time' THEN
      v_shift_regular := LEAST(v_shift_hours, v_dealer.standard_hours_per_shift);
      v_shift_ot := GREATEST(v_shift_hours - v_dealer.standard_hours_per_shift, 0);
    ELSE
      v_shift_regular := v_shift_hours;
      v_shift_ot := 0;
    END IF;

    -- P3: credit only the overlap fraction of this shift to the period. Regular/OT are
    -- prorated by overlap_ratio; the base-salary shift credit IS the overlap ratio (sums
    -- to exactly 1 per shift across its months; OT cannot push it above 1). v_total_shifts
    -- stays an informational count of overlapping attendance rows.
    v_regular_hours := v_regular_hours + v_shift_regular * v_overlap_ratio;
    v_ot_hours      := v_ot_hours      + v_shift_ot      * v_overlap_ratio;
    v_total_hours   := v_total_hours   + v_shift_hours   * v_overlap_ratio;
    v_shift_credit  := v_shift_credit  + v_overlap_ratio;
    v_total_shifts  := v_total_shifts  + 1;

    v_shift_details := v_shift_details || jsonb_build_object(
      'attendance_id', v_shift_record.attendance_id,
      'check_in_time', v_shift_record.check_in_time,
      'check_out_time', v_shift_record.check_out_time,
      'total_worked_minutes', v_shift_record.total_worked_minutes_today,
      'overtime_minutes', v_shift_record.overtime_minutes,
      'shift_hours', v_shift_hours,
      'regular_hours', v_shift_regular,
      'ot_hours', v_shift_ot,
      'overlap_ratio', ROUND(v_overlap_ratio, 4),
      'period_regular_hours', ROUND(v_shift_regular * v_overlap_ratio, 2),
      'period_ot_hours', ROUND(v_shift_ot * v_overlap_ratio, 2),
      'is_overnight', v_shift_record.is_overnight
    );
  END LOOP;

  -- ================================================================
  -- PAY CALCULATION
  -- FT: base_salary = FLOOR(monthly_salary x LEAST(shifts, standard) / standard)
  -- PT: unchanged (hourly rate, no base salary)
  -- ================================================================

  IF v_dealer.employment_type = 'full_time' THEN
    -- P3: base salary prorates by FRACTIONAL shift credit (overlap), not the raw row
    -- count, so a cross-month shift contributes its hour-share to each month (sum = 1).
    v_salary_ratio := LEAST(v_shift_credit, v_standard_shifts)::NUMERIC / v_standard_shifts::NUMERIC;
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
    -- P0 FIX: social-insurance base = prorated BASE salary (excludes OT/bonus/tips,
    -- keeps attendance proration). Old: LEAST(v_gross_pay_vnd, cap) wrongly added OT.
    -- Using full unprorated monthly_salary made net negative for partial-month dealers
    -- (golden diff 2026-06-15), so we use v_base_salary_vnd (0 when zero shifts).
    v_insurance_base := v_base_salary_vnd;
    v_bhxh_base := LEAST(v_insurance_base, v_bhxh_cap);
    v_bhxh_deduction_vnd := FLOOR((v_bhxh_base * 8) / 100)::BIGINT;
    v_bhyt_deduction_vnd := FLOOR((v_bhxh_base * 15) / 1000)::BIGINT;
    v_bhtn_deduction_vnd := FLOOR((v_bhxh_base * 1) / 100)::BIGINT;
    v_total_insurance := v_bhxh_deduction_vnd + v_bhyt_deduction_vnd + v_bhtn_deduction_vnd;
  ELSE
    v_insurance_base := 0;
    v_bhxh_base := 0;
    v_bhxh_deduction_vnd := 0;
    v_bhyt_deduction_vnd := 0;
    v_bhtn_deduction_vnd := 0;
    v_total_insurance := 0;
  END IF;

  -- MANUAL BHXH OVERRIDE (owner per-dealer): NULL = keep the auto-computed insurance
  -- above; a set value (incl. 0) REPLACES the total insurance. 0 => BHXH/BHYT/BHTN all 0.
  -- The component fields are collapsed onto bhxh for display; bhxh_base is left as the
  -- computed contractual base (informational). Flows into taxable income + net below.
  IF v_dealer.manual_bhxh_vnd IS NOT NULL THEN
    v_total_insurance := GREATEST(v_dealer.manual_bhxh_vnd, 0);
    v_bhxh_deduction_vnd := v_total_insurance;
    v_bhyt_deduction_vnd := 0;
    v_bhtn_deduction_vnd := 0;
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

  -- MANUAL TAX OVERRIDE (owner per-dealer): NULL = keep the computed PIT above; a set
  -- value (incl. 0) REPLACES it. 0 => no tax.
  IF v_dealer.manual_tax_vnd IS NOT NULL THEN
    v_pit_deduction_vnd := GREATEST(v_dealer.manual_tax_vnd, 0);
  END IF;

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
    -- MANUAL OVERRIDE transparency (NULL when auto-computed):
    'manual_bhxh_vnd', v_dealer.manual_bhxh_vnd,
    'manual_tax_vnd', v_dealer.manual_tax_vnd,
    'shifts', v_shift_details
  );
END;
$function$;
