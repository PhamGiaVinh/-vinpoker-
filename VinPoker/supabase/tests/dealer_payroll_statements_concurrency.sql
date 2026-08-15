-- Cross-transaction PT statement finalization proof. Disposable PostgreSQL only.
-- Both sessions use the same idempotency request; exactly one reservation is
-- created and the second request returns that immutable result after the
-- deterministic club-policy -> dealer lock order is released.

\set ON_ERROR_STOP on

create extension if not exists dblink with schema public;

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

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('fa121000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'statement-concurrency-super@test.invalid', now(), now()),
  ('fa121000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'statement-concurrency-owner@test.invalid', now(), now());
insert into public.user_roles (user_id, role)
values ('fa121000-0000-4000-8000-000000000001', 'super_admin');
insert into public.clubs (id, owner_id, name, region, status)
values ('fb121000-0000-4000-8000-000000000001', 'fa121000-0000-4000-8000-000000000002', 'STATEMENT CONCURRENCY', 'HCM', 'approved');
insert into public.dealers (id, club_id, full_name, status, employment_type, hourly_rate_vnd)
values ('fc121000-0000-4000-8000-000000000001', 'fb121000-0000-4000-8000-000000000001', 'Statement concurrent PT', 'active', 'part_time', 50000);
insert into public.dealer_attendance (id, dealer_id, shift_date, status, current_state, check_in_time, check_out_time)
values ('fd121000-0000-4000-8000-000000000001', 'fc121000-0000-4000-8000-000000000001', current_date, 'checked_out', 'available', now() - interval '1 hour', now());
delete from public.dealer_pt_wage_rate_history where dealer_id = 'fc121000-0000-4000-8000-000000000001';
insert into public.dealer_pt_wage_rate_history (dealer_id, hourly_rate_vnd, pt_eligible, effective_from)
values ('fc121000-0000-4000-8000-000000000001', 50000, true, now() - interval '1 hour');
insert into public.dealer_pt_wage_accrual_policies (club_id, standby_accrual_enabled, effective_from, updated_at, reason)
values ('fb121000-0000-4000-8000-000000000001', true, now() - interval '1 hour', now(), 'statement concurrency policy')
on conflict (club_id) do update
set standby_accrual_enabled = excluded.standby_accrual_enabled,
    effective_from = excluded.effective_from,
    updated_at = excluded.updated_at,
    reason = excluded.reason;

select dblink_connect('statement_finalize_a', 'dbname=' || current_database());
select dblink_connect('statement_finalize_b', 'dbname=' || current_database());

select dblink_send_query('statement_finalize_a', $query$
  with claims as (
    select set_config('request.jwt.claim.sub', 'fa121000-0000-4000-8000-000000000002', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  select public.finalize_part_time_payroll_statement(
    'aa121000-0000-4000-8000-000000000001',
    'fb121000-0000-4000-8000-000000000001',
    'fc121000-0000-4000-8000-000000000001',
    'concurrent same-request finalization', null
  )::text from claims
$query$);
select dblink_send_query('statement_finalize_b', $query$
  with claims as (
    select set_config('request.jwt.claim.sub', 'fa121000-0000-4000-8000-000000000002', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  select public.finalize_part_time_payroll_statement(
    'aa121000-0000-4000-8000-000000000001',
    'fb121000-0000-4000-8000-000000000001',
    'fc121000-0000-4000-8000-000000000001',
    'concurrent same-request finalization', null
  )::text from claims
$query$);

create temp table statement_finalize_results (response jsonb not null);
insert into statement_finalize_results
select response::jsonb from dblink_get_result('statement_finalize_a') as t(response text);
insert into statement_finalize_results
select response::jsonb from dblink_get_result('statement_finalize_b') as t(response text);

select pg_temp.assert_true(
  (select count(*) = 2 from statement_finalize_results)
  and (select count(distinct response->>'statement_id') = 1 from statement_finalize_results)
  and (select count(*) = 1 from public.dealer_payroll_statements where request_id = 'aa121000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.dealer_pt_wage_settlements where dealer_id = 'fc121000-0000-4000-8000-000000000001' and status = 'finalized'),
  'concurrent finalization creates exactly one PT statement and one active reservation'
);

select dblink_disconnect('statement_finalize_a');
select dblink_disconnect('statement_finalize_b');

select set_config('request.jwt.claim.sub', 'fa121000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set local role authenticated;
do $$
begin
  perform public.finalize_part_time_payroll_statement(
    'aa121000-0000-4000-8000-000000000002',
    'fb121000-0000-4000-8000-000000000001',
    'fc121000-0000-4000-8000-000000000001',
    'second settlement before first payment', null
  );
  raise exception 'a second active PT settlement unexpectedly succeeded';
exception when raise_exception then
  if sqlerrm <> 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT' then raise; end if;
end;
$$;
reset role;

do $$
begin
  raise notice 'dealer payroll statement concurrency tests passed';
end;
$$;
