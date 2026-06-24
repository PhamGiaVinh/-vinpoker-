-- ═══════════════════════════════════════════════════════════════════════════════
-- Salary-D — get_my_dealer_payroll: dealer-self FT payslip read. SOURCE-ONLY: NOT applied.
--
-- Apply is a SEPARATE owner-gated controlled op (Management API: CREATE OR REPLACE -> verify
-- grants/SECURITY DEFINER/search_path -> types regen). NO `supabase db push`, NO deploy_db,
-- NO schema_migrations edit here.
--
-- A logged-in dealer reads their OWN saved monthly payslip. Returns the SAVED immutable
-- dealer_payroll values (never recomputes; NEVER calls/exposes calculate_dealer_payroll, which
-- has no auth guard). Ownership is enforced: the row must belong to a dealers row whose
-- user_id = auth.uid() (multi-club safe via p_dealer_id). If the dealer has no saved period,
-- returns {has_data:false} so the app shows "chưa chốt bảng lương". Read-only / STABLE.
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function public.get_my_dealer_payroll(
  p_dealer_id uuid,
  p_year int default null,
  p_month int default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dp record;
  v_pay_status text;
  v_paid_at timestamptz;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- ownership: p_dealer_id must be a dealer linked to the caller
  if not exists (select 1 from public.dealers d where d.id = p_dealer_id and d.user_id = v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- the dealer's saved payroll for the requested month, else the latest saved period
  select dp.employment_type, dp.monthly_salary_vnd, dp.total_shifts, dp.total_hours,
         dp.regular_hours, dp.ot_hours, dp.base_salary_vnd, dp.ot_pay_vnd, dp.gross_pay_vnd,
         dp.bhxh_deduction_vnd, dp.bhyt_deduction_vnd, dp.bhtn_deduction_vnd, dp.pit_deduction_vnd,
         dp.total_adjustments_vnd, dp.net_pay_after_tax_vnd, dp.net_pay_vnd, dp.status AS dp_status,
         dp.paid_at AS dp_paid_at, dp.period_id,
         pp.period_year, pp.period_month, pp.status AS period_status
    into v_dp
  from public.dealer_payroll dp
  join public.payroll_periods pp on pp.id = dp.period_id
  where dp.dealer_id = p_dealer_id
    and (p_year is null or pp.period_year = p_year)
    and (p_month is null or pp.period_month = p_month)
  order by pp.period_year desc, pp.period_month desc
  limit 1;

  if not found then
    return jsonb_build_object('has_data', false, 'dealer_id', p_dealer_id);
  end if;

  -- payment status for the period (latest payment_records row, if any)
  select pr.status, pr.paid_at into v_pay_status, v_paid_at
  from public.payment_records pr
  where pr.period_id = v_dp.period_id
  order by pr.created_at desc
  limit 1;

  return jsonb_build_object(
    'has_data', true,
    'dealer_id', p_dealer_id,
    'employment_type', v_dp.employment_type,
    'period_year', v_dp.period_year,
    'period_month', v_dp.period_month,
    'period_status', v_dp.period_status,
    'monthly_salary_vnd', v_dp.monthly_salary_vnd,
    'total_shifts', v_dp.total_shifts,
    'total_hours', v_dp.total_hours,
    'regular_hours', v_dp.regular_hours,
    'ot_hours', v_dp.ot_hours,
    'base_salary_vnd', v_dp.base_salary_vnd,
    'ot_pay_vnd', v_dp.ot_pay_vnd,
    'gross_pay_vnd', v_dp.gross_pay_vnd,
    'bhxh_deduction_vnd', v_dp.bhxh_deduction_vnd,
    'bhyt_deduction_vnd', v_dp.bhyt_deduction_vnd,
    'bhtn_deduction_vnd', v_dp.bhtn_deduction_vnd,
    'pit_deduction_vnd', v_dp.pit_deduction_vnd,
    'total_adjustments_vnd', v_dp.total_adjustments_vnd,
    'net_pay_after_tax_vnd', v_dp.net_pay_after_tax_vnd,
    'net_pay_vnd', v_dp.net_pay_vnd,
    'payment_status', coalesce(v_pay_status, v_dp.dp_status),
    'paid_at', coalesce(v_paid_at, v_dp.dp_paid_at)
  );
end;
$$;
revoke all on function public.get_my_dealer_payroll(uuid, int, int) from public, anon;
grant execute on function public.get_my_dealer_payroll(uuid, int, int) to authenticated;
