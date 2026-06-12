CREATE OR REPLACE FUNCTION public.save_payroll_period(p_club_id uuid, p_year integer, p_month integer, p_start_date date, p_end_date date, p_payroll_rows jsonb, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
