BEGIN;

-- =============================================================================
-- Dealer Payroll Soft Delete
--
-- Changes:
--   1. Add CHECK constraint for dealer_payroll.status ('pending', 'excluded')
--   2. Add partial index for active (non-excluded) rows
--   3. Replace DELETE with soft-delete in save_payroll_period
--   4. Add status != 'excluded' filter to calculate_club_payroll saved-data path
-- =============================================================================

-- 1. Add CHECK constraint (existing values are 'pending')
ALTER TABLE dealer_payroll
  DROP CONSTRAINT IF EXISTS chk_dealer_payroll_status,
  ADD CONSTRAINT chk_dealer_payroll_status
    CHECK (status IN ('pending', 'excluded'));

-- 2. Partial index for active rows (excludes soft-deleted)
CREATE INDEX IF NOT EXISTS idx_dealer_payroll_active
  ON dealer_payroll(period_id, dealer_id)
  WHERE status != 'excluded';

-- 3. Replace save_payroll_period: soft-delete instead of hard delete
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
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id AND period_year = p_year AND period_month = p_month
  FOR UPDATE;

  IF v_period_id IS NULL THEN
    INSERT INTO payroll_periods (club_id, period_year, period_month, period_start, period_end, status, calculated_by)
    VALUES (p_club_id, p_year, p_month, p_start_date, p_end_date, 'draft', p_user_id)
    RETURNING id INTO v_period_id;
  ELSE
    IF EXISTS (SELECT 1 FROM payroll_periods WHERE id = v_period_id AND status = 'locked') THEN
      RAISE EXCEPTION 'Payroll period is locked and cannot be modified. Period ID: %', v_period_id;
    END IF;
    UPDATE payroll_periods SET calculated_by = p_user_id, updated_at = now() WHERE id = v_period_id;
  END IF;

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
      'pending', p_user_id
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

  -- Soft-delete: mark excluded instead of hard delete
  -- Preserves adjustments linked to excluded dealer rows
  UPDATE dealer_payroll
  SET status = 'excluded', updated_at = now()
  WHERE period_id = v_period_id
    AND dealer_id NOT IN (
      SELECT (elem->>'dealer_id')::UUID
      FROM jsonb_array_elements(p_payroll_rows) AS elem
    );

  RETURN v_period_id;
END;
$$;

COMMENT ON FUNCTION save_payroll_period IS
  'Transaction-safe save of payroll period. Uses soft-delete (status=excluded) instead of DELETE to preserve adjustments. Rejects if status=locked.';

-- 4. Update calculate_club_payroll: filter out excluded rows in saved-data path
CREATE OR REPLACE FUNCTION calculate_club_payroll(
  p_club_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dealer RECORD;
  v_results JSONB := '{}'::JSONB;
  v_payroll JSONB;
  v_period_id UUID;
  v_dealer_payroll RECORD;
  v_total_adjustments BIGINT;
BEGIN
  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id
    AND period_start = p_start_date
    AND period_end = p_end_date;

  IF FOUND THEN
    FOR v_dealer_payroll IN
      SELECT dp.*, d.full_name, d.standard_hours_per_shift, d.ot_multiplier AS dealer_ot_mult
      FROM dealer_payroll dp
      JOIN dealers d ON d.id = dp.dealer_id
      WHERE dp.period_id = v_period_id
        AND dp.club_id = p_club_id
        AND dp.status != 'excluded'
      ORDER BY d.full_name
    LOOP
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
      INTO v_total_adjustments
      FROM payroll_adjustments
      WHERE payroll_id = v_dealer_payroll.id;

      v_payroll := jsonb_build_object(
        'dealer_id', v_dealer_payroll.dealer_id,
        'full_name', v_dealer_payroll.full_name,
        'employment_type', v_dealer_payroll.employment_type,
        'monthly_salary_vnd', v_dealer_payroll.monthly_salary_vnd,
        'hourly_rate_vnd', v_dealer_payroll.hourly_rate_vnd,
        'standard_hours_per_shift', COALESCE(v_dealer_payroll.standard_hours_per_shift, 8),
        'ot_multiplier', COALESCE(v_dealer_payroll.dealer_ot_mult, 1.5),
        'total_shifts', COALESCE(v_dealer_payroll.total_shifts, 0),
        'total_hours', COALESCE(v_dealer_payroll.total_hours, 0),
        'regular_hours', COALESCE(v_dealer_payroll.regular_hours, 0),
        'ot_hours', COALESCE(v_dealer_payroll.ot_hours, 0),
        'base_salary_vnd', COALESCE(v_dealer_payroll.base_salary_vnd, 0),
        'regular_pay_vnd', COALESCE(v_dealer_payroll.regular_pay_vnd, 0),
        'ot_pay_vnd', COALESCE(v_dealer_payroll.ot_pay_vnd, 0),
        'gross_pay_vnd', COALESCE(v_dealer_payroll.gross_pay_vnd, 0),
        'total_adjustments_vnd', COALESCE(v_total_adjustments, 0),
        'tips_amount_vnd', COALESCE(v_dealer_payroll.tips_amount_vnd, 0),
        'bhxh_deduction_vnd', COALESCE(v_dealer_payroll.bhxh_deduction_vnd, 0),
        'bhyt_deduction_vnd', COALESCE(v_dealer_payroll.bhyt_deduction_vnd, 0),
        'bhtn_deduction_vnd', COALESCE(v_dealer_payroll.bhtn_deduction_vnd, 0),
        'pit_deduction_vnd', COALESCE(v_dealer_payroll.pit_deduction_vnd, 0),
        'net_pay_vnd', COALESCE(v_dealer_payroll.net_pay_vnd, 0),
        'net_pay_after_tax_vnd', COALESCE(v_dealer_payroll.net_pay_after_tax_vnd, 0),
        'shifts', '[]'::JSONB
      );

      v_results := v_results || jsonb_build_object(v_dealer_payroll.dealer_id::text, v_payroll);
    END LOOP;
  ELSE
    FOR v_dealer IN
      SELECT id FROM dealers
      WHERE club_id = p_club_id AND status = 'active'
      ORDER BY full_name
    LOOP
      v_payroll := calculate_dealer_payroll(v_dealer.id, p_start_date, p_end_date);
      v_results := v_results || jsonb_build_object(v_dealer.id::text, v_payroll);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'club_id', p_club_id,
    'period_start', p_start_date,
    'period_end', p_end_date,
    'dealers', v_results
  );
END;
$$;

COMMENT ON FUNCTION calculate_club_payroll IS
  'Returns payroll for all dealers in a club. Uses saved data if period exists (filtering excluded rows), otherwise calculates live.';

COMMIT;

-- =============================================================================
-- ROLLBACK COMPANION:
-- ALTER TABLE dealer_payroll DROP CONSTRAINT IF EXISTS chk_dealer_payroll_status;
-- DROP INDEX IF EXISTS idx_dealer_payroll_active;
-- -- Revert save_payroll_period to use DELETE instead of UPDATE status='excluded'
-- -- Revert calculate_club_payroll to remove status != 'excluded' filter
-- UPDATE dealer_payroll SET status = 'pending' WHERE status = 'excluded';
-- =============================================================================