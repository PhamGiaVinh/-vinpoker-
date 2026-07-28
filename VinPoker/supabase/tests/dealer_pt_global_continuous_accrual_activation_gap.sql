-- Activation-gap regression: run after 00002 only, before 00003.
-- The authenticated super-admin has no EXECUTE grant, so the global writer
-- cannot touch a policy, the singleton row, or payroll audit before the
-- rate-history/payout contract is ready.

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
  not has_function_privilege('authenticated', 'public.set_all_approved_dealer_pt_wage_accrual(boolean,text)', 'EXECUTE'),
  '00002 does not grant the global mutation RPC'
);

select set_config('request.jwt.claim.sub', 'fa100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  perform public.set_all_approved_dealer_pt_wage_accrual(true, 'activation-gap-contract');
  raise exception '00002-only global enable unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;

select pg_temp.assert_true(
  not (select future_club_enabled from public.dealer_pt_wage_accrual_global_policy where singleton)
  and not exists (
    select 1 from public.dealer_pt_wage_accrual_policies
    where club_id = 'fb100000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.payroll_audit_log
    where reason = 'activation-gap-contract'
  ),
  '00002-only denied call leaves global policy, club policy and audit untouched'
);

rollback;
