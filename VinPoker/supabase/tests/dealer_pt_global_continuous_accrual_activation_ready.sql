-- Same activation request as activation_gap.sql, now after the atomic v2
-- migration. This proves the grant becomes available only once the rate-history
-- baseline, trigger, payment snapshot and replacement RPC contract are present.

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

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('fa100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pt-gap-super@test.invalid', now(), now());
insert into public.user_roles (user_id, role)
values ('fa100000-0000-4000-8000-000000000001', 'super_admin');
insert into public.clubs (id, owner_id, name, region, status)
values ('fb100000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'PT GAP CLUB', 'HCM', 'approved');
insert into public.dealers (id, club_id, full_name, status, employment_type, hourly_rate_vnd)
values ('fc100000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'PT gap baseline', 'active', 'part_time', 50000);

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.set_all_approved_dealer_pt_wage_accrual(boolean,text)', 'EXECUTE'),
  'v2 grants the global mutation RPC after readiness dependencies exist'
);

select set_config('request.jwt.claim.sub', 'fa100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare v_result jsonb;
begin
  v_result := public.set_all_approved_dealer_pt_wage_accrual(true, 'activation-gap-contract');
  perform pg_temp.assert_true(
    v_result->>'standby_accrual_enabled' = 'true'
    and v_result->>'future_club_enabled' = 'true',
    'the exact activation request succeeds only after v2'
  );
end;
$$;

reset role;

select pg_temp.assert_true(
  (select future_club_enabled from public.dealer_pt_wage_accrual_global_policy where singleton)
  and exists (
    select 1 from public.dealer_pt_wage_accrual_policies
    where club_id = 'fb100000-0000-4000-8000-000000000001'
      and standby_accrual_enabled
      and effective_from is not null
  )
  and exists (
    select 1 from public.payroll_audit_log
    where reason = 'activation-gap-contract'
  ),
  'v2 readiness grant writes the audited global and club policy atomically'
);

rollback;
