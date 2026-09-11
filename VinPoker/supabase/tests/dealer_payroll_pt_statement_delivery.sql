-- PT statement grouping and mixed Telegram delivery intent.
-- Disposable PostgreSQL only; every fixture rolls back.

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.assert_true(p_value boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'assert_true failed: %', p_label; end if;
end;
$$;

create or replace function pg_temp.assert_eq(p_actual text, p_expected text, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'assert_eq failed: % (actual=%, expected=%)', p_label, p_actual, p_expected;
  end if;
end;
$$;

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.preview_part_time_payroll_statement(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.finalize_part_time_payroll_statements_for_period(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_dealer_payroll_statement_delivery_operation_v2(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.dealer_payroll_statement_period_links', 'SELECT'),
  'PT statement entrypoints and internal linkage ACLs are fail closed'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('fa140004-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pt-statement-owner@test.invalid', now(), now()),
  ('fa140004-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pt-statement-cashier@test.invalid', now(), now()),
  ('fa140004-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'pt-statement-dealer@test.invalid', now(), now());

insert into public.clubs (id, owner_id, name, region, status)
values ('fb140004-0000-4000-8000-000000000001', 'fa140004-0000-4000-8000-000000000001', 'PT DELIVERY TEST', 'HCM', 'approved');

insert into public.club_cashiers (club_id, user_id, granted_by)
values ('fb140004-0000-4000-8000-000000000001', 'fa140004-0000-4000-8000-000000000002', 'fa140004-0000-4000-8000-000000000001');

insert into public.dealers (
  id, club_id, user_id, full_name, status, employment_type, hourly_rate_vnd, telegram_user_id
)
values (
  'fc140004-0000-4000-8000-000000000001', 'fb140004-0000-4000-8000-000000000001',
  'fa140004-0000-4000-8000-000000000003', 'PT Delivery Dealer', 'active', 'part_time', 50000, '123456789'
);

insert into public.dealer_attendance (
  id, dealer_id, shift_date, status, current_state, check_in_time, check_out_time
)
values (
  'fd140004-0000-4000-8000-000000000001', 'fc140004-0000-4000-8000-000000000001',
  current_date, 'checked_out', 'available', now() - interval '1 hour', now()
);

delete from public.dealer_pt_wage_rate_history
where dealer_id = 'fc140004-0000-4000-8000-000000000001';
insert into public.dealer_pt_wage_rate_history (
  dealer_id, hourly_rate_vnd, pt_eligible, effective_from
)
values ('fc140004-0000-4000-8000-000000000001', 50000, true, now() - interval '1 hour');

insert into public.dealer_pt_wage_accrual_policies (
  club_id, standby_accrual_enabled, effective_from, updated_at, reason
)
values (
  'fb140004-0000-4000-8000-000000000001', true, now() - interval '1 hour', now(),
  'PT statement delivery disposable policy'
)
on conflict (club_id) do update
set standby_accrual_enabled = excluded.standby_accrual_enabled,
    effective_from = excluded.effective_from,
    updated_at = excluded.updated_at,
    reason = excluded.reason;

insert into public.payroll_periods (
  id, club_id, period_year, period_month, period_start, period_end,
  status, calculated_by, locked_by, locked_at
)
values (
  'fe140004-0000-4000-8000-000000000001', 'fb140004-0000-4000-8000-000000000001',
  2026, 9, date '2026-09-01', date '2026-09-30', 'locked',
  'fa140004-0000-4000-8000-000000000001', 'fa140004-0000-4000-8000-000000000001', now()
);

update public.dealer_payroll_statement_rollout
set master_enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = array['fb140004-0000-4000-8000-000000000001'::uuid]
where id;
update public.dealer_payroll_statement_delivery_rollout
set master_enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = array['fb140004-0000-4000-8000-000000000001'::uuid]
where id;

select set_config('request.jwt.claim.sub', 'fa140004-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set role authenticated;
do $$
begin
  perform public.preview_part_time_payroll_statement(
    'fb140004-0000-4000-8000-000000000001',
    'fc140004-0000-4000-8000-000000000001',
    'fe140004-0000-4000-8000-000000000001'
  );
  begin
    perform public.finalize_part_time_payroll_statement_for_period(
      'aa140004-0000-4000-8000-000000000001',
      'fb140004-0000-4000-8000-000000000001',
      'fc140004-0000-4000-8000-000000000001',
      'fe140004-0000-4000-8000-000000000001', null
    );
    raise exception 'cashier unexpectedly finalized PT statement';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'fa140004-0000-4000-8000-000000000001', true);
do $$
declare
  v_before bigint;
  v_first jsonb;
  v_second jsonb;
  v_bulk jsonb;
begin
  select count(*) into v_before from public.dealer_payroll_statements;
  perform public.preview_part_time_payroll_statement(
    'fb140004-0000-4000-8000-000000000001',
    'fc140004-0000-4000-8000-000000000001',
    'fe140004-0000-4000-8000-000000000001'
  );
  perform pg_temp.assert_true((select count(*) from public.dealer_payroll_statements) = v_before, 'PT preview writes no statement');

  v_first := public.finalize_part_time_payroll_statement_for_period(
    'aa140004-0000-4000-8000-000000000002',
    'fb140004-0000-4000-8000-000000000001',
    'fc140004-0000-4000-8000-000000000001',
    'fe140004-0000-4000-8000-000000000001', 'owner PT finalization'
  );
  v_second := public.finalize_part_time_payroll_statement_for_period(
    'aa140004-0000-4000-8000-000000000003',
    'fb140004-0000-4000-8000-000000000001',
    'fc140004-0000-4000-8000-000000000001',
    'fe140004-0000-4000-8000-000000000001', 'new browser replay'
  );
  perform pg_temp.assert_eq(v_second->>'statement_id', v_first->>'statement_id', 'business link deduplicates a new request id');
  perform pg_temp.assert_eq(v_second->>'idempotent', 'true', 'new request replay is explicit');
  perform pg_temp.assert_true(
    (select count(*) from public.dealer_payroll_statement_period_links
     where club_id = 'fb140004-0000-4000-8000-000000000001'
       and payroll_period_id = 'fe140004-0000-4000-8000-000000000001') = 1,
    'one PT statement is linked to the locked period'
  );

  v_bulk := public.finalize_part_time_payroll_statements_for_period(
    'aa140004-0000-4000-8000-000000000004',
    'fb140004-0000-4000-8000-000000000001',
    'fe140004-0000-4000-8000-000000000001'
  );
  perform pg_temp.assert_eq(v_bulk->>'existing_count', '1', 'bulk retry recognizes the existing immutable PT statement');
end;
$$;
reset role;

do $$
declare
  v_statement_id uuid;
  v_claim jsonb;
begin
  select statement_id into v_statement_id
  from public.dealer_payroll_statement_period_links
  where club_id = 'fb140004-0000-4000-8000-000000000001'
    and payroll_period_id = 'fe140004-0000-4000-8000-000000000001';
  v_claim := public.claim_dealer_payroll_statement_pdf(
    v_statement_id, 'ab140004-0000-4000-8000-000000000001'
  );
  perform public.complete_dealer_payroll_statement_pdf(
    v_statement_id,
    (v_claim->>'generation_token')::uuid,
    repeat('a', 64),
    'vinpoker-payroll-v1'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'fa140004-0000-4000-8000-000000000001', true);
set role authenticated;
do $$
declare
  v_operation jsonb;
begin
  v_operation := public.create_dealer_payroll_statement_delivery_operation_v2(
    'ac140004-0000-4000-8000-000000000001',
    'fb140004-0000-4000-8000-000000000001',
    'fe140004-0000-4000-8000-000000000001'
  );
  perform pg_temp.assert_eq(v_operation->>'pending_count', '1', 'PDF-ready linked PT statement becomes one pending delivery intent');
  perform pg_temp.assert_eq(v_operation->>'sent_count', '0', 'creating an operation does not send Telegram');
end;
$$;
reset role;

select pg_temp.assert_true(
  (select count(*) from public.dealer_pt_wage_payments
   where dealer_id = 'fc140004-0000-4000-8000-000000000001') = 0,
  'statement preparation and delivery intent create no payout'
);

rollback;
