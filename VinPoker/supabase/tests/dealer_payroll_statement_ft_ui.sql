-- FT statement UI, rollout, exactly-once and PDF claim lifecycle.
-- Disposable PostgreSQL only; all fixtures roll back.

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

create or replace function pg_temp.statement_count()
returns bigint
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select count(*) from public.dealer_payroll_statements
$$;

create or replace function pg_temp.statement_audit_count(p_club_id uuid)
returns bigint
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select count(*) from public.payroll_audit_log
  where club_id = p_club_id and table_name = 'dealer_payroll_statements'
$$;

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.get_dealer_payroll_statement_rollout(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.preview_full_time_payroll_statement(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_full_time_payroll_statements_for_period(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.preview_full_time_payroll_statement(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_dealer_payroll_statement_pdf(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_dealer_payroll_statement_pdf(uuid,uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.dealer_payroll_statement_rollout', 'SELECT'),
  'entrypoint and internal PDF ACLs are fail closed'
);

select pg_temp.assert_true(
  not (select master_enabled from public.dealer_payroll_statement_rollout where id),
  'rollout defaults OFF'
);
select pg_temp.assert_true(
  cardinality((select allowed_club_ids from public.dealer_payroll_statement_rollout where id)) = 0,
  'rollout allowlist defaults empty'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('fa130001-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ft-ui-super@test.invalid', now(), now()),
  ('fa130001-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ft-ui-owner@test.invalid', now(), now()),
  ('fa130001-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ft-ui-cashier@test.invalid', now(), now()),
  ('fa130001-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'ft-ui-foreign@test.invalid', now(), now());

insert into public.user_roles (user_id, role)
values ('fa130001-0000-4000-8000-000000000001', 'super_admin');

insert into public.clubs (id, owner_id, name, region, status)
values
  ('fb130001-0000-4000-8000-000000000001', 'fa130001-0000-4000-8000-000000000002', 'FT UI HSOP', 'HCM', 'approved'),
  ('fb130001-0000-4000-8000-000000000002', 'fa130001-0000-4000-8000-000000000004', 'FT UI CONTROL', 'HCM', 'approved');

insert into public.club_cashiers (club_id, user_id, granted_by)
values ('fb130001-0000-4000-8000-000000000001', 'fa130001-0000-4000-8000-000000000003', 'fa130001-0000-4000-8000-000000000001');

insert into public.dealers (id, club_id, full_name, status, employment_type, hourly_rate_vnd)
values
  ('fc130001-0000-4000-8000-000000000001', 'fb130001-0000-4000-8000-000000000001', 'FT UI Dealer A', 'active', 'full_time', 50000),
  ('fc130001-0000-4000-8000-000000000002', 'fb130001-0000-4000-8000-000000000001', 'FT UI Dealer B', 'active', 'full_time', 50000);

insert into public.payroll_periods (
  id, club_id, period_year, period_month, period_start, period_end,
  status, calculated_by, locked_by, locked_at
)
values
  ('fd130001-0000-4000-8000-000000000001', 'fb130001-0000-4000-8000-000000000001', 2026, 8, date '2026-08-01', date '2026-08-31', 'locked', 'fa130001-0000-4000-8000-000000000002', 'fa130001-0000-4000-8000-000000000002', now()),
  ('fd130001-0000-4000-8000-000000000002', 'fb130001-0000-4000-8000-000000000001', 2026, 9, date '2026-09-01', date '2026-09-30', 'draft', 'fa130001-0000-4000-8000-000000000002', null, null);

insert into public.dealer_payroll (
  id, dealer_id, club_id, period_id, employment_type, hourly_rate_vnd,
  total_shifts, total_hours, regular_hours, ot_hours, base_salary_vnd,
  regular_pay_vnd, ot_pay_vnd, gross_pay_vnd, total_adjustments_vnd,
  bhxh_deduction_vnd, bhyt_deduction_vnd, bhtn_deduction_vnd,
  pit_deduction_vnd, net_pay_vnd, net_pay_after_tax_vnd, status, calculated_by
)
values
  ('fe130001-0000-4000-8000-000000000001', 'fc130001-0000-4000-8000-000000000001', 'fb130001-0000-4000-8000-000000000001', 'fd130001-0000-4000-8000-000000000001', 'full_time', 100000, 20, 160, 120, 40, 0, 800000, 400000, 1200000, 0, 80000, 20000, 10000, 90000, 1000000, 1000000, 'pending', 'fa130001-0000-4000-8000-000000000002'),
  ('fe130001-0000-4000-8000-000000000002', 'fc130001-0000-4000-8000-000000000002', 'fb130001-0000-4000-8000-000000000001', 'fd130001-0000-4000-8000-000000000001', 'full_time', 100000, 20, 160, 120, 40, 0, 700000, 300000, 1000000, 0, 50000, 10000, 10000, 30000, 900000, 900000, 'pending', 'fa130001-0000-4000-8000-000000000002'),
  ('fe130001-0000-4000-8000-000000000003', 'fc130001-0000-4000-8000-000000000001', 'fb130001-0000-4000-8000-000000000001', 'fd130001-0000-4000-8000-000000000002', 'full_time', 100000, 1, 8, 8, 0, 0, 50000, 0, 50000, 0, 0, 0, 0, 0, 50000, 50000, 'pending', 'fa130001-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub', 'fa130001-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set role authenticated;

do $$
begin
  perform public.preview_full_time_payroll_statement(
    'fb130001-0000-4000-8000-000000000001',
    'fc130001-0000-4000-8000-000000000001',
    'fd130001-0000-4000-8000-000000000001'
  );
  raise exception 'preview unexpectedly ignored rollout OFF';
exception when raise_exception then
  if sqlerrm <> 'PAYROLL_STATEMENT_ROLLOUT_DISABLED' then raise; end if;
end;
$$;

reset role;
update public.dealer_payroll_statement_rollout
set master_enabled = true,
    allowed_club_ids = array['fb130001-0000-4000-8000-000000000001'::uuid],
    all_clubs_enabled = false
where id;

select set_config('request.jwt.claim.sub', 'fa130001-0000-4000-8000-000000000003', true);
set role authenticated;

do $$
declare
  v_before bigint;
  v_audit_before bigint;
  v_preview jsonb;
begin
  v_before := pg_temp.statement_count();
  v_audit_before := pg_temp.statement_audit_count('fb130001-0000-4000-8000-000000000001');
  v_preview := public.preview_full_time_payroll_statement(
    'fb130001-0000-4000-8000-000000000001',
    'fc130001-0000-4000-8000-000000000001',
    'fd130001-0000-4000-8000-000000000001'
  );
  perform pg_temp.assert_eq(v_preview->>'state', 'previewed', 'cashier can preview saved payroll');
  perform pg_temp.assert_true(length(v_preview #>> '{club_snapshot,brand_asset_hash}') = 64, 'preview pins immutable brand hash');
  perform pg_temp.assert_true(pg_temp.statement_count() = v_before, 'preview writes no statement');
  perform pg_temp.assert_true(
    pg_temp.statement_audit_count('fb130001-0000-4000-8000-000000000001') = v_audit_before,
    'preview writes no audit row'
  );
  begin
    perform public.finalize_full_time_payroll_statement(
      'aa130001-0000-4000-8000-000000000001',
      'fb130001-0000-4000-8000-000000000001',
      'fc130001-0000-4000-8000-000000000001',
      'fd130001-0000-4000-8000-000000000001', null, null
    );
    raise exception 'cashier unexpectedly finalized immutable statement';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'fa130001-0000-4000-8000-000000000002', true);

do $$
declare
  v_first jsonb;
  v_second jsonb;
  v_list jsonb;
begin
  v_first := public.finalize_full_time_payroll_statement(
    'aa130001-0000-4000-8000-000000000002',
    'fb130001-0000-4000-8000-000000000001',
    'fc130001-0000-4000-8000-000000000001',
    'fd130001-0000-4000-8000-000000000001', 'owner finalization', null
  );
  v_second := public.finalize_full_time_payroll_statement(
    'aa130001-0000-4000-8000-000000000003',
    'fb130001-0000-4000-8000-000000000001',
    'fc130001-0000-4000-8000-000000000001',
    'fd130001-0000-4000-8000-000000000001', 'new-browser replay', null
  );
  perform pg_temp.assert_eq(v_second->>'statement_id', v_first->>'statement_id', 'business key deduplicates a new request id');
  perform pg_temp.assert_eq(v_second->>'deduplicated_by', 'business_key', 'business-key replay is explicit');
  v_list := public.list_full_time_payroll_statements_for_period(
    'fb130001-0000-4000-8000-000000000001',
    'fd130001-0000-4000-8000-000000000001'
  );
  perform pg_temp.assert_true(jsonb_array_length(v_list) = 1, 'refresh lookup returns one active statement');
end;
$$;

reset role;

select pg_temp.assert_true(
  (select count(*) from public.dealer_payroll_statements
   where club_id = 'fb130001-0000-4000-8000-000000000001'
     and dealer_id = 'fc130001-0000-4000-8000-000000000001'
     and state not in ('voided', 'replaced')) = 1,
  'new browser retry creates one active FT statement'
);
select pg_temp.assert_true(
  pg_temp.statement_audit_count('fb130001-0000-4000-8000-000000000001') = 1,
  'business-key replay does not duplicate audit'
);

update public.dealer_payroll
set regular_pay_vnd = regular_pay_vnd + 1,
    gross_pay_vnd = gross_pay_vnd + 1,
    net_pay_vnd = net_pay_vnd + 1,
    net_pay_after_tax_vnd = net_pay_after_tax_vnd + 1
where id = 'fe130001-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', 'fa130001-0000-4000-8000-000000000002', true);
set role authenticated;
do $$
begin
  perform public.finalize_full_time_payroll_statement(
    'aa130001-0000-4000-8000-000000000004',
    'fb130001-0000-4000-8000-000000000001',
    'fc130001-0000-4000-8000-000000000001',
    'fd130001-0000-4000-8000-000000000001', 'changed source conflict', null
  );
  raise exception 'changed source unexpectedly reused an immutable statement';
exception when serialization_failure then
  if sqlerrm <> 'PAYROLL_STATEMENT_BUSINESS_CONFLICT' then raise; end if;
end;
$$;
reset role;

do $$
declare
  v_statement uuid;
  v_claim jsonb;
  v_busy jsonb;
  v_ready jsonb;
begin
  select id into v_statement from public.dealer_payroll_statements
  where dealer_id = 'fc130001-0000-4000-8000-000000000001'
    and state not in ('voided', 'replaced');
  v_claim := public.claim_dealer_payroll_statement_pdf(v_statement, 'ab130001-0000-4000-8000-000000000001');
  v_busy := public.claim_dealer_payroll_statement_pdf(v_statement, 'ab130001-0000-4000-8000-000000000002');
  perform pg_temp.assert_eq(v_claim->>'outcome', 'claimed', 'first PDF request claims generation');
  perform pg_temp.assert_eq(v_busy->>'outcome', 'generating', 'second PDF request cannot render concurrently');
  v_ready := public.complete_dealer_payroll_statement_pdf(
    v_statement, (v_claim->>'generation_token')::uuid,
    repeat('a', 64), 'vinpoker-payroll-v1'
  );
  perform pg_temp.assert_eq(v_ready->>'outcome', 'ready', 'claim token completes immutable PDF metadata');
  perform pg_temp.assert_eq(
    public.claim_dealer_payroll_statement_pdf(v_statement, 'ab130001-0000-4000-8000-000000000003')->>'outcome',
    'ready', 'READY retry never starts a new render'
  );
end;
$$;

update public.dealer_payroll_statement_rollout
set master_enabled = false where id;

do $$
declare
  v_statement uuid;
begin
  select id into v_statement from public.dealer_payroll_statements limit 1;
  begin
    perform public.claim_dealer_payroll_statement_pdf(v_statement, 'ab130001-0000-4000-8000-000000000004');
    raise exception 'PDF claim unexpectedly ignored kill switch';
  exception when raise_exception then
    if sqlerrm <> 'PAYROLL_STATEMENT_ROLLOUT_DISABLED' then raise; end if;
  end;
end;
$$;

rollback;
