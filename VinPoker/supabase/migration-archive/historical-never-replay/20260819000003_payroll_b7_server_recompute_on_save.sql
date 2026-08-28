-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL B7: SERVER RECOMPUTE ON SAVE — save_payroll_period
--
-- Problem (audit B7, MEDIUM-HIGH): save_payroll_period persisted CLIENT-supplied
-- amounts verbatim — tampered or stale client data became stored payroll truth,
-- violating the backend-source-of-truth principle.
--
-- Fix: the client payload now only selects WHICH dealers to include (roster).
-- Every stored number is recomputed server-side via calculate_dealer_payroll()
-- at save instant. Added:
--   - roster guard: dealer must belong to p_club_id and be active (skipped+counted otherwise)
--   - client-vs-server drift audit: one payroll_audit_log row per save
--     (action='UPDATE' per the audit-log CHECK constraint; reason='B7 server
--     recompute on save'; old_values=client totals, new_values=server totals + counts)
-- Unchanged: signature (frontend untouched), period creation, locked-period
-- rejection, ON CONFLICT upsert shape, soft-delete exclusion of dealers not in payload.
--
-- Verified live (2026-06-13, controlled apply; live md5 65d547ebf96c6fac93f7cb9d2d093d81):
--   - TAMPER TEST (club 11, June 2026): payload claimed 999,999,999 VND gross/net
--     for 2 dealers -> stored rows = server values (400,000 / 346,153 gross),
--     0 tampered rows persisted; audit row logged client_net_total=1,999,999,998
--     vs server_net_total=709,808
--   - UI save flow (real browser, club 11): "Đã lưu bảng lương — 2 dealer",
--     frontend unchanged and compatible; saved-path display shows server totals
--   - Golden fixture club 22 June: dealer_payroll md5 unchanged
--     (4a786968725b8879272ee701e576579b) throughout
--
-- Note: stored snapshot = full server calc at save instant (net includes
-- adjustments existing at that moment). The B5 read path recombines display net
-- from net_pay_after_tax_vnd + live adjustments, so display stays correct as
-- adjustments change after save.
--
-- ROLLBACK: re-apply docs/emergency_rollbacks/PRE_B7_save_payroll_period_live_snapshot_20260613.sql
--   (md5 e704de5411b99d1718c3a78f4f96b400)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.save_payroll_period(p_club_id uuid, p_year integer, p_month integer, p_start_date date, p_end_date date, p_payroll_rows jsonb, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_id UUID;
  v_row JSONB;
  v_calc JSONB;
  v_dealer_id UUID;
  v_client_gross BIGINT := 0;
  v_client_net BIGINT := 0;
  v_server_gross BIGINT := 0;
  v_server_net BIGINT := 0;
  v_rows_saved INT := 0;
  v_rows_skipped INT := 0;
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

  -- B7: SERVER RECOMPUTE ON SAVE - client-supplied amounts are IGNORED.
  -- The payload only selects WHICH dealers to include (roster); every stored
  -- number comes from calculate_dealer_payroll() server-side at save instant.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payroll_rows) LOOP
    v_dealer_id := (v_row->>'dealer_id')::UUID;

    -- roster guard: dealer must belong to this club and be active
    IF NOT EXISTS (
      SELECT 1 FROM dealers d
      WHERE d.id = v_dealer_id AND d.club_id = p_club_id AND d.status = 'active'
    ) THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    v_calc := calculate_dealer_payroll(v_dealer_id, p_start_date, p_end_date);
    IF v_calc ? 'error' THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    -- client-vs-server drift accounting for the audit trail
    v_client_gross := v_client_gross + COALESCE(NULLIF(v_row->>'gross_pay_vnd','')::NUMERIC, 0)::BIGINT;
    v_client_net   := v_client_net   + COALESCE(NULLIF(v_row->>'net_pay_vnd','')::NUMERIC, 0)::BIGINT;
    v_server_gross := v_server_gross + COALESCE((v_calc->>'gross_pay_vnd')::NUMERIC, 0)::BIGINT;
    v_server_net   := v_server_net   + COALESCE((v_calc->>'net_pay_vnd')::NUMERIC, 0)::BIGINT;

    INSERT INTO dealer_payroll (
      dealer_id, club_id, period_id, employment_type, monthly_salary_vnd,
      hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours,
      ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd,
      total_adjustments_vnd, tips_amount_vnd, bhxh_deduction_vnd,
      bhyt_deduction_vnd, bhtn_deduction_vnd, pit_deduction_vnd,
      net_pay_vnd, net_pay_after_tax_vnd, status, calculated_by
    ) VALUES (
      v_dealer_id, p_club_id, v_period_id,
      v_calc->>'employment_type',
      (v_calc->>'monthly_salary_vnd')::NUMERIC,
      (v_calc->>'hourly_rate_vnd')::NUMERIC,
      (v_calc->>'ot_multiplier')::NUMERIC,
      (v_calc->>'total_shifts')::INT,
      (v_calc->>'total_hours')::NUMERIC,
      (v_calc->>'regular_hours')::NUMERIC,
      (v_calc->>'ot_hours')::NUMERIC,
      (v_calc->>'base_salary_vnd')::NUMERIC,
      (v_calc->>'regular_pay_vnd')::NUMERIC,
      (v_calc->>'ot_pay_vnd')::NUMERIC,
      (v_calc->>'gross_pay_vnd')::NUMERIC,
      (v_calc->>'total_adjustments_vnd')::NUMERIC,
      COALESCE((v_calc->>'tips_amount_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhxh_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhyt_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhtn_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'pit_deduction_vnd')::NUMERIC, 0)::BIGINT,
      (v_calc->>'net_pay_vnd')::NUMERIC,
      COALESCE((v_calc->>'net_pay_after_tax_vnd')::NUMERIC, (v_calc->>'net_pay_vnd')::NUMERIC)::BIGINT,
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
    v_rows_saved := v_rows_saved + 1;
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

  -- B7: audit the save with client-vs-server drift evidence
  INSERT INTO payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) VALUES (
    'payroll_periods', v_period_id, p_club_id, 'UPDATE',
    jsonb_build_object('client_gross_total', v_client_gross, 'client_net_total', v_client_net),
    jsonb_build_object('server_gross_total', v_server_gross, 'server_net_total', v_server_net,
                       'rows_saved', v_rows_saved, 'rows_skipped', v_rows_skipped),
    p_user_id, 'B7 server recompute on save'
  );

  RETURN v_period_id;
END;
$function$;
