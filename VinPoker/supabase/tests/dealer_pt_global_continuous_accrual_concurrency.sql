-- Cross-transaction payroll policy interleaving. Disposable database only.
-- Unlike the lifecycle suite, dblink sessions commit so their lock ordering is
-- observed by PostgreSQL rather than simulated inside one transaction.

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
  ('fa200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pt-concurrency-super@test.invalid', now(), now()),
  ('fa200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pt-concurrency-owner-b@test.invalid', now(), now()),
  ('fa200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'pt-concurrency-owner-c@test.invalid', now(), now());
insert into public.user_roles (user_id, role)
values ('fa200000-0000-4000-8000-000000000001', 'super_admin');
insert into public.clubs (id, owner_id, name, region, status)
values
  ('fb200000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'PT CONCURRENCY A', 'HCM', 'approved'),
  ('fb200000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000002', 'PT CONCURRENCY B', 'HCM', 'approved');

select dblink_connect('pt_global_enable', 'dbname=' || current_database());
select dblink_connect('pt_club_change', 'dbname=' || current_database());

select dblink_send_query('pt_global_enable', $query$
  with claims as (
    select set_config('request.jwt.claim.sub', 'fa200000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  select public.set_all_approved_dealer_pt_wage_accrual(
    true, 'disposable concurrent global enable'
  )::text from claims
$query$);
select dblink_send_query('pt_club_change', $query$
  with claims as (
    select set_config('request.jwt.claim.sub', 'fa200000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  select public.set_dealer_pt_wage_accrual_policy(
    'fb200000-0000-4000-8000-000000000001', false, null, 'disposable concurrent club change'
  )::text from claims
$query$);

create temp table pt_enable_results (response jsonb not null);
insert into pt_enable_results select response::jsonb from dblink_get_result('pt_global_enable') as t(response text);
insert into pt_enable_results select response::jsonb from dblink_get_result('pt_club_change') as t(response text);

select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(response ? 'idempotent') from pt_enable_results)
  and (select future_club_enabled from public.dealer_pt_wage_accrual_global_policy where singleton)
  and (select count(*) <= 1 from public.dealer_pt_wage_accrual_policies where club_id = 'fb200000-0000-4000-8000-000000000001'),
  'global enable versus per-club change completes without a duplicate policy or deadlock'
);

select dblink_disconnect('pt_global_enable');
select dblink_disconnect('pt_club_change');
select dblink_connect('pt_global_disable', 'dbname=' || current_database());
select dblink_connect('pt_club_approval', 'dbname=' || current_database());

select dblink_send_query('pt_global_disable', $query$
  with claims as (
    select set_config('request.jwt.claim.sub', 'fa200000-0000-4000-8000-000000000001', false),
           set_config('request.jwt.claim.role', 'authenticated', false)
  )
  select public.set_all_approved_dealer_pt_wage_accrual(
    false, 'disposable concurrent global disable'
  )::text from claims
$query$);
select dblink_send_query('pt_club_approval', $query$
  insert into public.clubs (id, owner_id, name, region, status)
  values (
    'fb200000-0000-4000-8000-000000000003',
    'fa200000-0000-4000-8000-000000000003',
    'PT CONCURRENCY APPROVAL', 'HCM', 'approved'
  )
  returning id::text
$query$);

select dblink_get_result('pt_global_disable');
select dblink_get_result('pt_club_approval');

select pg_temp.assert_true(
  not (select future_club_enabled from public.dealer_pt_wage_accrual_global_policy where singleton)
  and not exists (
    select 1
    from public.dealer_pt_wage_accrual_policies p
    join public.clubs c on c.id = p.club_id
    where c.id in (
      'fb200000-0000-4000-8000-000000000001',
      'fb200000-0000-4000-8000-000000000002',
      'fb200000-0000-4000-8000-000000000003'
    )
      and p.standby_accrual_enabled
  ),
  'club approval racing global disable cannot leave an enabled policy behind'
);

select dblink_disconnect('pt_global_disable');
select dblink_disconnect('pt_club_approval');

delete from public.payroll_audit_log
where reason like 'disposable concurrent global %'
   or reason = 'disposable concurrent club change';
delete from public.clubs
where id in (
  'fb200000-0000-4000-8000-000000000001',
  'fb200000-0000-4000-8000-000000000002',
  'fb200000-0000-4000-8000-000000000003'
);
delete from public.user_roles where user_id = 'fa200000-0000-4000-8000-000000000001';
delete from auth.users
where id in (
  'fa200000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000002',
  'fa200000-0000-4000-8000-000000000003'
);

do $$
begin
  raise notice 'dealer PT global continuous accrual concurrency tests passed';
end;
$$;
