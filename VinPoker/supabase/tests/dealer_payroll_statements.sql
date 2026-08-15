-- Dealer payroll statement v1 lifecycle and access contract.
-- Disposable PostgreSQL only. The test rolls back all fixtures and never calls
-- a remote database, storage bucket, Edge function, or Telegram endpoint.

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(p_value boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_value is distinct from true then
    raise exception 'assert_true failed: %', p_label;
  end if;
end;
$$;

create or replace function pg_temp.assert_eq(p_actual text, p_expected text, p_label text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'assert_eq failed: % (actual=%, expected=%)', p_label, p_actual, p_expected;
  end if;
end;
$$;

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.finalize_part_time_payroll_statement(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_part_time_payroll_statement(uuid,uuid,uuid,text,uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.dealer_payroll_statements', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dealer_payroll_statement_lines', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dealer_pt_wage_settlements', 'SELECT'),
  'statement mutation uses authenticated RPCs while snapshot tables remain server-only'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('fa120000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'statement-super@test.invalid', now(), now()),
  ('fa120000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'statement-owner-a@test.invalid', now(), now()),
  ('fa120000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'statement-owner-b@test.invalid', now(), now()),
  ('fa120000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'statement-cashier-a@test.invalid', now(), now()),
  ('fa120000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'statement-dealer-a@test.invalid', now(), now());

insert into public.user_roles (user_id, role)
values ('fa120000-0000-4000-8000-000000000001', 'super_admin');

insert into public.clubs (id, owner_id, name, region, status)
values
  ('fb120000-0000-4000-8000-000000000001', 'fa120000-0000-4000-8000-000000000002', 'STATEMENT CLUB A', 'HCM', 'approved'),
  ('fb120000-0000-4000-8000-000000000002', 'fa120000-0000-4000-8000-000000000003', 'STATEMENT CLUB B', 'HCM', 'approved');

insert into public.club_cashiers (club_id, user_id, granted_by)
values ('fb120000-0000-4000-8000-000000000001', 'fa120000-0000-4000-8000-000000000004', 'fa120000-0000-4000-8000-000000000001');

insert into public.dealers (id, club_id, user_id, full_name, status, employment_type, hourly_rate_vnd)
values
  ('fc120000-0000-4000-8000-000000000001', 'fb120000-0000-4000-8000-000000000001', 'fa120000-0000-4000-8000-000000000005', 'Statement FT', 'active', 'full_time', 50000),
  ('fc120000-0000-4000-8000-000000000002', 'fb120000-0000-4000-8000-000000000001', null, 'Statement PT', 'active', 'part_time', 50000),
  ('fc120000-0000-4000-8000-000000000003', 'fb120000-0000-4000-8000-000000000002', null, 'Statement foreign', 'active', 'part_time', 50000);

insert into public.dealer_attendance (
  id, dealer_id, shift_date, status, current_state, check_in_time, check_out_time
)
values
  ('fd120000-0000-4000-8000-000000000001', 'fc120000-0000-4000-8000-000000000002', current_date, 'checked_out', 'available', now() - interval '1 hour', now()),
  ('fd120000-0000-4000-8000-000000000002', 'fc120000-0000-4000-8000-000000000003', current_date, 'checked_out', 'available', now() - interval '1 hour', now());

delete from public.dealer_pt_wage_rate_history
where dealer_id in (
  'fc120000-0000-4000-8000-000000000002',
  'fc120000-0000-4000-8000-000000000003'
);
insert into public.dealer_pt_wage_rate_history (
  dealer_id, hourly_rate_vnd, pt_eligible, effective_from
)
values
  ('fc120000-0000-4000-8000-000000000002', 50000, true, now() - interval '1 hour'),
  ('fc120000-0000-4000-8000-000000000002', 70000, true, now() - interval '30 minutes'),
  ('fc120000-0000-4000-8000-000000000003', 50000, true, now() - interval '1 hour');

insert into public.dealer_pt_wage_accrual_policies (
  club_id, standby_accrual_enabled, effective_from, updated_at, reason
)
values
  ('fb120000-0000-4000-8000-000000000001', true, now() - interval '1 hour', now(), 'statement disposable continuous policy'),
  ('fb120000-0000-4000-8000-000000000002', true, now() - interval '1 hour', now(), 'statement disposable foreign policy')
on conflict (club_id) do update
set standby_accrual_enabled = excluded.standby_accrual_enabled,
    effective_from = excluded.effective_from,
    updated_at = excluded.updated_at,
    reason = excluded.reason;

insert into public.payroll_periods (
  id, club_id, period_year, period_month, period_start, period_end, status, calculated_by, locked_by, locked_at
)
values
  ('fe120000-0000-4000-8000-000000000001', 'fb120000-0000-4000-8000-000000000001', 2026, 8, date '2026-08-01', date '2026-08-31', 'locked', 'fa120000-0000-4000-8000-000000000002', 'fa120000-0000-4000-8000-000000000002', now()),
  ('fe120000-0000-4000-8000-000000000002', 'fb120000-0000-4000-8000-000000000001', 2026, 9, date '2026-09-01', date '2026-09-30', 'draft', 'fa120000-0000-4000-8000-000000000002', null, null);

insert into public.dealer_payroll (
  id, dealer_id, club_id, period_id, employment_type, hourly_rate_vnd,
  total_shifts, total_hours, regular_hours, ot_hours, base_salary_vnd,
  regular_pay_vnd, ot_pay_vnd, gross_pay_vnd, total_adjustments_vnd,
  bhxh_deduction_vnd, bhyt_deduction_vnd, bhtn_deduction_vnd,
  pit_deduction_vnd, net_pay_vnd, net_pay_after_tax_vnd, status, calculated_by
)
values
  ('ff120000-0000-4000-8000-000000000001', 'fc120000-0000-4000-8000-000000000001', 'fb120000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000001', 'full_time', 100000,
   20, 160, 120, 40, 0, 800000, 400000, 1200000, 0,
   80000, 20000, 10000, 90000, 1000000, 1000000, 'pending', 'fa120000-0000-4000-8000-000000000002'),
  ('ff120000-0000-4000-8000-000000000002', 'fc120000-0000-4000-8000-000000000001', 'fb120000-0000-4000-8000-000000000001', 'fe120000-0000-4000-8000-000000000002', 'full_time', 100000,
   1, 8, 8, 0, 0, 50000, 0, 50000, 0,
   0, 0, 0, 0, 50000, 50000, 'pending', 'fa120000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub', 'fa120000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  perform public.finalize_full_time_payroll_statement(
    'aa120000-0000-4000-8000-000000000001',
    'fb120000-0000-4000-8000-000000000001',
    'fc120000-0000-4000-8000-000000000001',
    'fe120000-0000-4000-8000-000000000001', 'cross club must fail', null
  );
  raise exception 'cross-club finalization unexpectedly succeeded';
exception when insufficient_privilege then null;
end;
$$;

select set_config('request.jwt.claim.sub', 'fa120000-0000-4000-8000-000000000002', true);

do $$
declare
  v_ft jsonb;
  v_replay jsonb;
  v_snapshot_before text;
begin
  v_ft := public.finalize_full_time_payroll_statement(
    'aa120000-0000-4000-8000-000000000002',
    'fb120000-0000-4000-8000-000000000001',
    'fc120000-0000-4000-8000-000000000001',
    'fe120000-0000-4000-8000-000000000001', 'lock-period fixture', null
  );
  v_replay := public.finalize_full_time_payroll_statement(
    'aa120000-0000-4000-8000-000000000002',
    'fb120000-0000-4000-8000-000000000001',
    'fc120000-0000-4000-8000-000000000001',
    'fe120000-0000-4000-8000-000000000001', 'same request replay', null
  );
  perform pg_temp.assert_eq(v_ft->>'net_amount_vnd', '1000000', 'FT statement uses the stored net amount');
  perform pg_temp.assert_eq(v_replay->>'idempotent', 'true', 'FT request replay returns the same immutable statement');
  perform pg_temp.assert_true(length(v_ft->>'statement_hash') = 64, 'FT statement stores a sha256 hash');
  perform pg_temp.assert_eq(
    (select club_snapshot->>'club_name' from public.dealer_payroll_statements where id = (v_ft->>'statement_id')::uuid),
    'STATEMENT CLUB A',
    'statement stores the server club-name snapshot used by the later renderer'
  );

  select source_snapshot::text into v_snapshot_before
  from public.dealer_payroll_statements
  where id = (v_ft->>'statement_id')::uuid;
  reset role;
  update public.dealer_payroll set net_pay_after_tax_vnd = 1 where id = 'ff120000-0000-4000-8000-000000000001';
  perform pg_temp.assert_eq(
    (select source_snapshot::text from public.dealer_payroll_statements where id = (v_ft->>'statement_id')::uuid),
    v_snapshot_before,
    'later source-row mutation cannot recalculate an existing statement'
  );
  update public.dealer_payroll set net_pay_after_tax_vnd = 1000000 where id = 'ff120000-0000-4000-8000-000000000001';
  update public.dealer_payroll_statements
  set state = 'pdf_rendered'
  where id = (v_ft->>'statement_id')::uuid;
  select set_config('request.jwt.claim.sub', 'fa120000-0000-4000-8000-000000000002', true);
  set local role authenticated;

  begin
    perform public.finalize_full_time_payroll_statement(
      'aa120000-0000-4000-8000-000000000003',
      'fb120000-0000-4000-8000-000000000001',
      'fc120000-0000-4000-8000-000000000001',
      'fe120000-0000-4000-8000-000000000002', 'draft must fail', null
    );
    raise exception 'draft period finalization unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'PAYROLL_STATEMENT_PERIOD_NOT_LOCKED' then raise; end if;
  end;
end;
$$;

reset role;

do $$
declare
  v_ft_id uuid;
  v_replacement jsonb;
begin
  select id into v_ft_id
  from public.dealer_payroll_statements
  where request_id = 'aa120000-0000-4000-8000-000000000002';
  perform public.void_dealer_payroll_statement(v_ft_id, 'fixture correction before payment');
  perform pg_temp.assert_eq(
    (select state from public.dealer_payroll_statements where id = v_ft_id),
    'voided',
    'an unpaid PDF-rendered statement remains voidable through the audited server path'
  );
  v_replacement := public.finalize_full_time_payroll_statement(
    'aa120000-0000-4000-8000-000000000004',
    'fb120000-0000-4000-8000-000000000001',
    'fc120000-0000-4000-8000-000000000001',
    'fe120000-0000-4000-8000-000000000001', 'replacement fixture', v_ft_id
  );
  perform pg_temp.assert_eq(
    (select state from public.dealer_payroll_statements where id = v_ft_id),
    'replaced',
    'voided FT statement links to its replacement instead of being edited or deleted'
  );
  perform pg_temp.assert_true(
    (select replaces_statement_id = v_ft_id from public.dealer_payroll_statements where id = (v_replacement->>'statement_id')::uuid),
    'replacement has immutable lineage to the voided statement'
  );
end;
$$;

do $$
declare
  v_pt jsonb;
  v_pt_replay jsonb;
  v_held jsonb;
  v_payment jsonb;
  v_payment_replay jsonb;
  v_statement_id uuid;
  v_payment_snapshot text;
  v_segment_amount numeric;
begin
  v_pt := public.finalize_part_time_payroll_statement(
    'aa120000-0000-4000-8000-000000000005',
    'fb120000-0000-4000-8000-000000000001',
    'fc120000-0000-4000-8000-000000000002', 'mixed-rate PT fixture', null
  );
  v_pt_replay := public.finalize_part_time_payroll_statement(
    'aa120000-0000-4000-8000-000000000005',
    'fb120000-0000-4000-8000-000000000001',
    'fc120000-0000-4000-8000-000000000002', 'mixed-rate PT replay', null
  );
  perform pg_temp.assert_eq(v_pt->>'net_amount_vnd', '60000', 'PT statement freezes two 30-minute rate segments at 50K and 70K');
  perform pg_temp.assert_eq(v_pt_replay->>'idempotent', 'true', 'PT request replay returns the existing reservation');
  v_statement_id := (v_pt->>'statement_id')::uuid;
  v_held := public._pt_wage_balance('fc120000-0000-4000-8000-000000000002');
  perform pg_temp.assert_eq(v_held->>'balance_vnd', '0', 'finalized PT interval is excluded from the live balance while unpaid');
  perform pg_temp.assert_true((v_held->>'reserved_through')::timestamptz >= (v_pt->>'cutoff_at')::timestamptz, 'live balance reports the statement reservation boundary');

  begin
    perform public.pay_part_time_balance('fc120000-0000-4000-8000-000000000002', 'cash', null, 'must-not-recalc', null);
    raise exception 'generic PT payout ignored a finalized statement';
  exception when raise_exception then
    if sqlerrm <> 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT' then raise; end if;
  end;

  reset role;
  update public.dealer_payroll_statements
  set state = 'pdf_rendered'
  where id = v_statement_id;
  select set_config('request.jwt.claim.sub', 'fa120000-0000-4000-8000-000000000002', true);
  set local role authenticated;

  v_payment := public.pay_finalized_part_time_payroll_statement(
    v_statement_id, 'cash', 'PT-STMT-1', 'pt-statement-payment-1', 'exact frozen snapshot payment'
  );
  v_payment_replay := public.pay_finalized_part_time_payroll_statement(
    v_statement_id, 'cash', 'PT-STMT-1', 'pt-statement-payment-1', 'retry'
  );
  perform pg_temp.assert_eq(v_payment->>'amount_vnd', '60000', 'PT payment uses statement amount without a new calculation');
  perform pg_temp.assert_eq(v_payment_replay->>'idempotent', 'true', 'PT statement payment replay cannot create a second receipt');
  perform pg_temp.assert_true(
    (select payment_id = (v_payment->>'payment_id')::uuid from public.dealer_pt_wage_settlements where statement_id = v_statement_id)
    and (select pt_wage_payment_id = (v_payment->>'payment_id')::uuid from public.dealer_payroll_statements where id = v_statement_id),
    'PT settlement and statement link to exactly one immutable payment'
  );
  select accrual_policy_snapshot::text into v_payment_snapshot
  from public.dealer_pt_wage_payments where id = (v_payment->>'payment_id')::uuid;
  select floor(sum((segment->>'amount_vnd')::numeric)) into v_segment_amount
  from jsonb_array_elements((select financial_snapshot->'accrual_policy_snapshot'->'rate_segments' from public.dealer_payroll_statements where id = v_statement_id)) segment;
  perform pg_temp.assert_eq(v_segment_amount::text, '60000', 'exact rate segments reconstruct the frozen statement amount');

  reset role;
  update public.dealers set hourly_rate_vnd = 90000 where id = 'fc120000-0000-4000-8000-000000000002';
  perform pg_temp.assert_eq(
    (select accrual_policy_snapshot::text from public.dealer_pt_wage_payments where id = (v_payment->>'payment_id')::uuid),
    v_payment_snapshot,
    'later rate changes cannot mutate an existing PT payment snapshot'
  );
  begin
    update public.dealer_payroll_statements set net_amount_vnd = 1 where id = v_statement_id;
    raise exception 'paid statement mutation unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
  select set_config('request.jwt.claim.sub', 'fa120000-0000-4000-8000-000000000002', true);
  set local role authenticated;
  begin
    perform public.void_dealer_payroll_statement(v_statement_id, 'paid statement must not void');
    raise exception 'paid statement void unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'PAYROLL_STATEMENT_ALREADY_PAID_OR_NOT_VOIDABLE' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'fa120000-0000-4000-8000-000000000005', true);
set local role authenticated;
select pg_temp.assert_true(
  (public.get_dealer_payroll_statement((
    select id from public.dealer_payroll_statements
    where statement_kind = 'full_time_period' and state = 'finalized'
    order by finalized_at desc limit 1
  ))->'dealer_snapshot'->>'full_name') = 'Statement FT',
  'linked dealer can read only the server-authorized own statement via RPC'
);

select set_config('request.jwt.claim.sub', 'fa120000-0000-4000-8000-000000000003', true);
set local role authenticated;
do $$
begin
  perform public.get_dealer_payroll_statement((
    select id from public.dealer_payroll_statements
    where statement_kind = 'full_time_period' and state = 'finalized'
    order by finalized_at desc limit 1
  ));
  raise exception 'foreign owner read unexpectedly succeeded';
exception when insufficient_privilege then null;
end;
$$;

reset role;

do $$
begin
  raise notice 'dealer payroll statement lifecycle, immutable snapshot, PT reservation, payout bridge, ACL, and correction tests passed';
end;
$$;

rollback;
