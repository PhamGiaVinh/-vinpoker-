BEGIN;

-- =============================================================================
-- Sprint 2: Payroll Business Logic Enhancement
--
-- Changes:
--   1. Add tax/insurance/tips columns to dealer_payroll (BIGINT default 0)
--   2. Add dependents_count to dealers (for Sprint 4 PIT)
--   3. Update calculate_dealer_payroll: integer arithmetic, BHXH for FT
--   4. Update save_payroll_period: persist new columns
--   5. Add split-shift indicator to shift details (check-in date rule)
--
-- Rules (locked):
--   - All shift attributes belong to check-in date (Option A)
--   - BHXH/BHYT/BHTN: full_time only, informational (not deducted from net)
--   - Tips: net, not taxable, placeholder = 0 (Sprint 3)
--   - PIT: placeholder = 0 (Sprint 4)
--   - Integer arithmetic only for VND (no float multiplication)
-- =============================================================================

-- ============================================================================
-- 1. Schema: Add columns to dealer_payroll
-- ============================================================================

ALTER TABLE dealer_payroll
  ADD COLUMN IF NOT EXISTS tips_amount_vnd BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bhxh_deduction_vnd BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bhyt_deduction_vnd BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bhtn_deduction_vnd BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pit_deduction_vnd BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_pay_after_tax_vnd BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN dealer_payroll.tips_amount_vnd IS
  'Tips net from customers. Not taxable. TODO Sprint 3: tips pool integration';

COMMENT ON COLUMN dealer_payroll.bhxh_deduction_vnd IS
  'BHXH 8% employee portion (full_time only). Informational only - NOT deducted from net_pay in Sprint 2. TODO Sprint 4: configurable per dealer';

COMMENT ON COLUMN dealer_payroll.bhyt_deduction_vnd IS
  'BHYT 1.5% employee portion (full_time only). Informational only.';

COMMENT ON COLUMN dealer_payroll.bhtn_deduction_vnd IS
  'BHTN 1% employee portion (full_time only). Informational only.';

COMMENT ON COLUMN dealer_payroll.pit_deduction_vnd IS
  'PIT placeholder. TODO Sprint 4: implement full PIT calculation with dependents';

COMMENT ON COLUMN dealer_payroll.net_pay_after_tax_vnd IS
  'Net pay after all deductions. Sprint 2: same as net_pay_vnd (no deductions applied yet)';

-- ============================================================================
-- 2. Schema: Add dependents_count to dealers (for Sprint 4 PIT)
-- ============================================================================

ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS dependents_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN dealers.dependents_count IS
  'Number of dependents for PIT deduction (Sprint 4). Default 0 = self-deduction only (11M VND/month)';

-- ============================================================================
-- 3. Update calculate_dealer_payroll: integer arithmetic + new fields
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_dealer_payroll(
  p_dealer_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dealer RECORD;
  v_total_shifts INT := 0;
  v_total_hours NUMERIC := 0;
  v_regular_hours NUMERIC := 0;
  v_ot_hours NUMERIC := 0;
  v_base_salary_vnd BIGINT := 0;
  v_regular_pay_vnd BIGINT := 0;
  v_ot_pay_vnd BIGINT := 0;
  v_gross_pay_vnd BIGINT := 0;
  v_total_adjustments_vnd BIGINT := 0;
  v_tips_amount_vnd BIGINT := 0;          -- Sprint 2: placeholder
  v_bhxh_deduction_vnd BIGINT := 0;       -- Sprint 2: informational
  v_bhyt_deduction_vnd BIGINT := 0;       -- Sprint 2: informational
  v_bhtn_deduction_vnd BIGINT := 0;       -- Sprint 2: informational
  v_pit_deduction_vnd BIGINT := 0;        -- Sprint 2: placeholder
  v_net_pay_vnd BIGINT := 0;
  v_net_pay_after_tax_vnd BIGINT := 0;
  v_shift_details JSONB := '[]'::JSONB;
  v_shift_record RECORD;
  v_shift_hours NUMERIC;
  v_shift_regular NUMERIC;
  v_shift_ot NUMERIC;
  v_min_hourly_rate CONSTANT INT := 50000;
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

  -- Ensure minimum hourly rate
  IF COALESCE(v_dealer.hourly_rate_vnd, 0) < v_min_hourly_rate THEN
    v_dealer.hourly_rate_vnd := v_min_hourly_rate;
  END IF;

  -- Loop through attendance records in the period
  -- CRITICAL: filter by check_in date only (Option A - shift belongs to check-in date)
  FOR v_shift_record IN
    SELECT
      da.id AS attendance_id,
      da.check_in_time,
      da.check_out_time,
      da.overtime_minutes,
      da.total_worked_minutes_today,
      -- Calculate actual shift duration in hours (do NOT cap at midnight)
      EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, now()) - da.check_in_time)) / 3600 AS shift_hours_raw,
      -- Detect cross-midnight for UI badge
      (da.check_out_time IS NOT NULL AND DATE(da.check_out_time) > DATE(da.check_in_time)) AS is_overnight
    FROM public.dealer_attendance da
    WHERE da.dealer_id = p_dealer_id
      AND da.status IN ('checked_in', 'checked_out')
      AND da.check_in_time IS NOT NULL
      AND da.check_in_time::DATE BETWEEN p_start_date AND p_end_date
    ORDER BY da.check_in_time
  LOOP
    -- Handle null or invalid timestamps
    IF v_shift_record.shift_hours_raw IS NULL OR v_shift_record.shift_hours_raw < 0 THEN
      CONTINUE;
    END IF;

    -- Cap at 24h to prevent runaway from forgotten check-out
    v_shift_hours := LEAST(ROUND(v_shift_record.shift_hours_raw::NUMERIC, 2), 24);

    IF v_dealer.employment_type = 'full_time' THEN
      -- Full-time: standard hours per shift, OT for anything above
      v_shift_regular := LEAST(v_shift_hours, v_dealer.standard_hours_per_shift);
      v_shift_ot := GREATEST(v_shift_hours - v_dealer.standard_hours_per_shift, 0);
    ELSE
      -- Part-time: all hours are regular, no OT
      v_shift_regular := v_shift_hours;
      v_shift_ot := 0;
    END IF;

    v_regular_hours := v_regular_hours + v_shift_regular;
    v_ot_hours := v_ot_hours + v_shift_ot;
    v_total_hours := v_total_hours + v_shift_hours;
    v_total_shifts := v_total_shifts + 1;

    -- Build shift detail with split-shift indicator
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
  -- PAY CALCULATION: Integer arithmetic only
  -- ================================================================

  IF v_dealer.employment_type = 'full_time' THEN
    -- Full-time: monthly salary + OT pay
    v_base_salary_vnd := COALESCE(v_dealer.monthly_salary_vnd, 0);
    v_regular_pay_vnd := 0;  -- Regular hours included in monthly salary
    -- OT: hours * rate * multiplier, rounded to integer
    v_ot_pay_vnd := (v_ot_hours * v_dealer.hourly_rate_vnd * v_dealer.ot_multiplier)::NUMERIC;
    v_ot_pay_vnd := FLOOR(v_ot_pay_vnd)::BIGINT;
    v_gross_pay_vnd := v_base_salary_vnd + v_ot_pay_vnd;
  ELSE
    -- Part-time: hours × rate, no base salary
    v_base_salary_vnd := 0;
    v_regular_pay_vnd := FLOOR(v_regular_hours * v_dealer.hourly_rate_vnd)::BIGINT;
    v_ot_pay_vnd := 0;  -- No OT for part-time
    v_gross_pay_vnd := v_regular_pay_vnd;
  END IF;

  -- Get adjustments (from saved payroll record if exists, else 0)
  -- Note: adjustments are stored in payroll_adjustments table linked to dealer_payroll
  -- For live calculation, we calculate from all adjustments for this dealer
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

  -- ================================================================
  -- BHXH / BHYT / BHTN (informational only, full_time only)
  -- Integer arithmetic: FLOOR(gross * rate / 100)
  -- TODO Sprint 4: make configurable per dealer
  -- ================================================================

  IF v_dealer.employment_type = 'full_time' THEN
    v_bhxh_deduction_vnd := FLOOR(v_gross_pay_vnd * 8 / 100)::BIGINT;      -- 8%
    v_bhyt_deduction_vnd := FLOOR(v_gross_pay_vnd * 15 / 1000)::BIGINT;    -- 1.5%
    v_bhtn_deduction_vnd := FLOOR(v_gross_pay_vnd * 1 / 100)::BIGINT;      -- 1%
  ELSE
    v_bhxh_deduction_vnd := 0;
    v_bhyt_deduction_vnd := 0;
    v_bhtn_deduction_vnd := 0;
  END IF;

  -- Tips: placeholder for Sprint 3
  v_tips_amount_vnd := 0;

  -- PIT: placeholder for Sprint 4
  v_pit_deduction_vnd := 0;

  -- ================================================================
  -- NET PAY (Sprint 2: no deductions applied yet)
  -- gross + adjustments + tips
  -- TODO Sprint 4: net = gross - bhxh - bhyt - bhtn - pit + adjustments + tips
  -- ================================================================

  v_net_pay_vnd := v_gross_pay_vnd + v_total_adjustments_vnd + v_tips_amount_vnd;
  v_net_pay_after_tax_vnd := v_net_pay_vnd;  -- Sprint 2: same as net

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
    'bhxh_deduction_vnd', v_bhxh_deduction_vnd,
    'bhyt_deduction_vnd', v_bhyt_deduction_vnd,
    'bhtn_deduction_vnd', v_bhtn_deduction_vnd,
    'pit_deduction_vnd', v_pit_deduction_vnd,
    'net_pay_vnd', v_net_pay_vnd,
    'net_pay_after_tax_vnd', v_net_pay_after_tax_vnd,
    'shifts', v_shift_details
  );
END;
$$;

COMMENT ON FUNCTION calculate_dealer_payroll IS
  'Calculate dealer payroll for a date range. Integer arithmetic only. All shift hours belong to check-in date. BHXH/BHYT/BHTN informational only (not deducted). Tips and PIT are placeholders.';

-- ============================================================================
-- 4. Update save_payroll_period: persist new columns
-- ============================================================================

CREATE OR REPLACE FUNCTION save_payroll_period(
  p_club_id UUID,
  p_year INT,
  p_month INT,
  p_start_date DATE,
  p_end_date DATE,
  p_payroll_rows JSONB,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_row JSONB;
BEGIN
  -- Set session variable for audit trigger
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

  -- 1. Lock period row
  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id AND period_year = p_year AND period_month = p_month
  FOR UPDATE;

  -- 2. Create or verify period
  IF v_period_id IS NULL THEN
    INSERT INTO payroll_periods (club_id, period_year, period_month, period_start, period_end, status, calculated_by)
    VALUES (p_club_id, p_year, p_month, p_start_date, p_end_date, 'draft', p_user_id)
    RETURNING id INTO v_period_id;
  ELSE
    IF EXISTS (SELECT 1 FROM payroll_periods WHERE id = v_period_id AND status = 'locked') THEN
      RAISE EXCEPTION 'Payroll period is locked and cannot be modified. Period ID: %', v_period_id;
    END IF;
    UPDATE payroll_periods
    SET calculated_by = p_user_id, updated_at = now()
    WHERE id = v_period_id;
  END IF;

  -- 3. Upsert dealer_payroll rows with new columns
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payroll_rows) LOOP
    INSERT INTO dealer_payroll (
      dealer_id, club_id, period_id, employment_type, monthly_salary_vnd,
      hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours,
      ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd,
      total_adjustments_vnd, tips_amount_vnd, bhxh_deduction_vnd,
      bhyt_deduction_vnd, bhtn_deduction_vnd, pit_deduction_vnd,
      net_pay_vnd, net_pay_after_tax_vnd, status, calculated_by
    ) VALUES (
      (v_row->>'dealer_id')::UUID, p_club_id, v_period_id,
      v_row->>'employment_type',
      NULLIF(v_row->>'monthly_salary_vnd', '')::NUMERIC,
      NULLIF(v_row->>'hourly_rate_vnd', '')::NUMERIC,
      NULLIF(v_row->>'ot_multiplier', '')::NUMERIC,
      NULLIF(v_row->>'total_shifts', '')::INT,
      NULLIF(v_row->>'total_hours', '')::NUMERIC,
      NULLIF(v_row->>'regular_hours', '')::NUMERIC,
      NULLIF(v_row->>'ot_hours', '')::NUMERIC,
      NULLIF(v_row->>'base_salary_vnd', '')::NUMERIC,
      NULLIF(v_row->>'regular_pay_vnd', '')::NUMERIC,
      NULLIF(v_row->>'ot_pay_vnd', '')::NUMERIC,
      NULLIF(v_row->>'gross_pay_vnd', '')::NUMERIC,
      NULLIF(v_row->>'total_adjustments_vnd', '')::NUMERIC,
      COALESCE(NULLIF(v_row->>'tips_amount_vnd', '')::NUMERIC, 0)::BIGINT,
      COALESCE(NULLIF(v_row->>'bhxh_deduction_vnd', '')::NUMERIC, 0)::BIGINT,
      COALESCE(NULLIF(v_row->>'bhyt_deduction_vnd', '')::NUMERIC, 0)::BIGINT,
      COALESCE(NULLIF(v_row->>'bhtn_deduction_vnd', '')::NUMERIC, 0)::BIGINT,
      COALESCE(NULLIF(v_row->>'pit_deduction_vnd', '')::NUMERIC, 0)::BIGINT,
      NULLIF(v_row->>'net_pay_vnd', '')::NUMERIC,
      COALESCE(NULLIF(v_row->>'net_pay_after_tax_vnd', '')::NUMERIC, NULLIF(v_row->>'net_pay_vnd', '')::NUMERIC)::BIGINT,
      'draft', p_user_id
    )
    ON CONFLICT (period_id, dealer_id) DO UPDATE SET
      employment_type = EXCLUDED.employment_type,
      monthly_salary_vnd = EXCLUDED.monthly_salary_vnd,
      hourly_rate_vnd = EXCLUDED.hourly_rate_vnd,
      ot_multiplier = EXCLUDED.ot_multiplier,
      total_shifts = EXCLUDED.total_shifts,
      total_hours = EXCLUDED.total_hours,
      regular_hours = EXCLUDED.regular_hours,
      ot_hours = EXCLUDED.ot_hours,
      base_salary_vnd = EXCLUDED.base_salary_vnd,
      regular_pay_vnd = EXCLUDED.regular_pay_vnd,
      ot_pay_vnd = EXCLUDED.ot_pay_vnd,
      gross_pay_vnd = EXCLUDED.gross_pay_vnd,
      total_adjustments_vnd = EXCLUDED.total_adjustments_vnd,
      tips_amount_vnd = EXCLUDED.tips_amount_vnd,
      bhxh_deduction_vnd = EXCLUDED.bhxh_deduction_vnd,
      bhyt_deduction_vnd = EXCLUDED.bhyt_deduction_vnd,
      bhtn_deduction_vnd = EXCLUDED.bhtn_deduction_vnd,
      pit_deduction_vnd = EXCLUDED.pit_deduction_vnd,
      net_pay_vnd = EXCLUDED.net_pay_vnd,
      net_pay_after_tax_vnd = EXCLUDED.net_pay_after_tax_vnd,
      status = EXCLUDED.status,
      calculated_by = EXCLUDED.calculated_by,
      updated_at = now();
  END LOOP;

  -- 4. Delete dealer_payroll rows NOT in p_payroll_rows
  DELETE FROM dealer_payroll
  WHERE period_id = v_period_id
    AND dealer_id NOT IN (
      SELECT (elem->>'dealer_id')::UUID
      FROM jsonb_array_elements(p_payroll_rows) AS elem
    );

  RETURN v_period_id;
END;
$$;

COMMENT ON FUNCTION save_payroll_period IS
  'Transaction-safe save of payroll period. Persists all Sprint 2 columns (tips, BHXH, PIT placeholders). Uses UPSERT to preserve adjustments.';

COMMIT;

-- =============================================================================
-- Post-migration: Mark draft periods for recalculation
-- =============================================================================
-- Run this AFTER deploying new RPC:
-- UPDATE payroll_periods
-- SET status = 'needs_recalculation'
-- WHERE status IN ('draft', 'submitted');

-- =============================================================================
-- ROLLBACK COMPANION (run manually if rollback required):
--
-- ALTER TABLE dealer_payroll
--   DROP COLUMN IF EXISTS tips_amount_vnd,
--   DROP COLUMN IF EXISTS bhxh_deduction_vnd,
--   DROP COLUMN IF EXISTS bhyt_deduction_vnd,
--   DROP COLUMN IF EXISTS bhtn_deduction_vnd,
--   DROP COLUMN IF EXISTS pit_deduction_vnd,
--   DROP COLUMN IF EXISTS net_pay_after_tax_vnd;
--
-- ALTER TABLE dealers
--   DROP COLUMN IF EXISTS dependents_count;
--
-- -- Restore previous calculate_dealer_payroll from backup if needed
-- =============================================================================
