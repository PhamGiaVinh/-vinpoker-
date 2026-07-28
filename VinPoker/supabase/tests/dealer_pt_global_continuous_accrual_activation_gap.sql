-- Pre-v2 activation regression. Run against the current 00001 baseline before
-- the superseding v2 migration. The global writer must not exist, so an
-- authenticated super-admin cannot mutate club policy or payroll audit state.

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

select pg_temp.assert_true(
  to_regprocedure('public.set_all_approved_dealer_pt_wage_accrual(boolean,text)') is null,
  'the 00001 baseline exposes no global PT wage mutation RPC'
);

select set_config('request.jwt.claim.sub', 'fa100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  perform public.set_all_approved_dealer_pt_wage_accrual(true, 'activation-gap-contract');
  raise exception 'pre-v2 global enable unexpectedly succeeded';
exception
  when undefined_function then null;
end;
$$;

reset role;

select pg_temp.assert_true(
  not exists (
    select 1 from public.dealer_pt_wage_accrual_policies
    where club_id = 'fb100000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.payroll_audit_log
    where reason = 'activation-gap-contract'
  ),
  'pre-v2 denied call leaves club policy and audit untouched'
);

rollback;
