-- Different request IDs racing on the same FT business key produce one statement.
-- Disposable PostgreSQL only.

\set ON_ERROR_STOP on
create extension if not exists dblink with schema public;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('fa130002-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ft-race-owner@test.invalid', now(), now());
insert into public.clubs (id, owner_id, name, region, status)
values ('fb130002-0000-4000-8000-000000000001', 'fa130002-0000-4000-8000-000000000001', 'FT RACE', 'HCM', 'approved');
insert into public.dealers (id, club_id, full_name, status, employment_type, hourly_rate_vnd)
values ('fc130002-0000-4000-8000-000000000001', 'fb130002-0000-4000-8000-000000000001', 'FT Race Dealer', 'active', 'full_time', 50000);
insert into public.payroll_periods (
  id, club_id, period_year, period_month, period_start, period_end, status,
  calculated_by, locked_by, locked_at
) values (
  'fd130002-0000-4000-8000-000000000001', 'fb130002-0000-4000-8000-000000000001',
  2026, 8, date '2026-08-01', date '2026-08-31', 'locked',
  'fa130002-0000-4000-8000-000000000001', 'fa130002-0000-4000-8000-000000000001', now()
);
insert into public.dealer_payroll (
  id, dealer_id, club_id, period_id, employment_type, hourly_rate_vnd,
  total_shifts, total_hours, regular_hours, ot_hours, base_salary_vnd,
  regular_pay_vnd, ot_pay_vnd, gross_pay_vnd, total_adjustments_vnd,
  bhxh_deduction_vnd, bhyt_deduction_vnd, bhtn_deduction_vnd,
  pit_deduction_vnd, net_pay_vnd, net_pay_after_tax_vnd, status, calculated_by
) values (
  'fe130002-0000-4000-8000-000000000001', 'fc130002-0000-4000-8000-000000000001',
  'fb130002-0000-4000-8000-000000000001', 'fd130002-0000-4000-8000-000000000001',
  'full_time', 100000, 20, 160, 120, 40, 0, 800000, 400000, 1200000, 0,
  80000, 20000, 10000, 90000, 1000000, 1000000, 'pending',
  'fa130002-0000-4000-8000-000000000001'
);
update public.dealer_payroll_statement_rollout
set master_enabled = true,
    allowed_club_ids = array['fb130002-0000-4000-8000-000000000001'::uuid]
where id;

select dblink_connect('ft_a', 'dbname=' || current_database());
select dblink_connect('ft_b', 'dbname=' || current_database());
select dblink_send_query('ft_a', $query$
  with claims as (
    select set_config('request.jwt.claim.sub','fa130002-0000-4000-8000-000000000001',false),
           set_config('request.jwt.claim.role','authenticated',false)
  )
  select public.finalize_full_time_payroll_statement(
    'aa130002-0000-4000-8000-000000000001',
    'fb130002-0000-4000-8000-000000000001',
    'fc130002-0000-4000-8000-000000000001',
    'fd130002-0000-4000-8000-000000000001', null, null
  )::text from claims
$query$);
select dblink_send_query('ft_b', $query$
  with claims as (
    select set_config('request.jwt.claim.sub','fa130002-0000-4000-8000-000000000001',false),
           set_config('request.jwt.claim.role','authenticated',false)
  )
  select public.finalize_full_time_payroll_statement(
    'aa130002-0000-4000-8000-000000000002',
    'fb130002-0000-4000-8000-000000000001',
    'fc130002-0000-4000-8000-000000000001',
    'fd130002-0000-4000-8000-000000000001', null, null
  )::text from claims
$query$);

create temp table ft_finalize_results (response jsonb not null);
insert into ft_finalize_results
select response::jsonb from dblink_get_result('ft_a') as t(response text);
insert into ft_finalize_results
select response::jsonb from dblink_get_result('ft_b') as t(response text);

do $$
begin
  if (select count(*) from ft_finalize_results) <> 2
     or (select count(distinct response->>'statement_id') from ft_finalize_results) <> 1 then
    raise exception 'concurrent calls did not converge on one statement id';
  end if;
  if (select count(*) from public.dealer_payroll_statements
      where club_id = 'fb130002-0000-4000-8000-000000000001'
        and dealer_id = 'fc130002-0000-4000-8000-000000000001'
        and payroll_period_id = 'fd130002-0000-4000-8000-000000000001'
        and statement_kind = 'full_time_period'
        and state not in ('voided', 'replaced')) <> 1 then
    raise exception 'concurrent different request IDs created more than one active FT statement';
  end if;
  if (select count(*) from public.payroll_audit_log
      where table_name = 'dealer_payroll_statements'
        and club_id = 'fb130002-0000-4000-8000-000000000001'
        and action = 'INSERT') <> 1 then
    raise exception 'concurrent replay wrote duplicate audit rows';
  end if;
end;
$$;

select dblink_disconnect('ft_a');
select dblink_disconnect('ft_b');
