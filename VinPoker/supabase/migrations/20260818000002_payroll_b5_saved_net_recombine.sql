-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL B5: SAVED NET RECOMBINE — calculate_club_payroll saved branch
--
-- Problem (audit B5, MEDIUM-HIGH): on the saved-period path the function returned
-- net_pay_vnd from the stored dealer_payroll snapshot while total_adjustments_vnd
-- was re-summed LIVE from payroll_adjustments. Adjustments added AFTER save were
-- therefore invisible in the payable net -> standing "Chênh lệch điều chỉnh"
-- mismatch, the most dispute-prone payroll display issue.
--
-- Fix: ONE expression changed in the saved branch only:
--   OLD: 'net_pay_vnd', COALESCE(dp.net_pay_vnd, 0)
--   NEW: 'net_pay_vnd', COALESCE(dp.net_pay_after_tax_vnd, 0) + COALESCE(v_total_adjustments, 0)
-- Stored dealer_payroll rows are NEVER rewritten (read path only). The unsaved
-- live-calc branch is byte-identical to before.
--
-- ZERO other change: body below is byte-identical to the verified live body after
-- the manual controlled apply on 2026-06-13 (md5 8932bb8f8b2c880738c1008e57268789);
-- pre-patch live body md5 afd930661dbf898a85e2909fd5fb6a2b.
--
-- Golden-period diff (June 2026 fixture, club 22222222, 29 dealers, 1 adjustment +500k):
--   28 dealers byte-identical; only dl 12 net_pay_vnd 5,297,000 -> 5,797,000 (+500k);
--   total net 49,526,842 -> 50,026,842; stored-rows md5 unchanged
--   (4a786968725b8879272ee701e576579b before == after).
--
-- ROLLBACK: re-apply pre-patch snapshot:
--   docs/emergency_rollbacks/PRE_B5_calculate_club_payroll_live_snapshot_20260613.sql
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calculate_club_payroll(p_club_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- B5: saved-path net = stored after-tax + live adjustments (post-save adjustments stay visible; stored rows untouched)
        'net_pay_vnd', COALESCE(v_dealer_payroll.net_pay_after_tax_vnd, 0) + COALESCE(v_total_adjustments, 0),
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
$function$;
