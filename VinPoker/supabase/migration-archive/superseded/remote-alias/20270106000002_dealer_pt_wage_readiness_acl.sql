-- Dealer PT wage readiness helper ACL repair.
--
-- Requires the live 20270106000001 consolidated payroll contract. The helper
-- is called internally by the SECURITY DEFINER global mutation RPC and must
-- not remain a direct service-role surface. This migration does not alter a
-- policy, wage balance, attendance, payout, or audit row.
--
-- ROLLBACK: do not restore direct helper execute. A future reviewed migration
-- is required if a new server-only caller needs a different contract.

begin;

do $$
begin
  if to_regprocedure('public.assert_dealer_pt_wage_global_activation_ready(timestamp with time zone)') is null then
    raise exception 'dealer PT wage readiness helper is required for ACL repair';
  end if;
end;
$$;

revoke all on function public.assert_dealer_pt_wage_global_activation_ready(timestamptz)
  from public, anon, authenticated, service_role;

do $$
begin
  if has_function_privilege(
       'service_role',
       'public.assert_dealer_pt_wage_global_activation_ready(timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.assert_dealer_pt_wage_global_activation_ready(timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.assert_dealer_pt_wage_global_activation_ready(timestamp with time zone)',
       'EXECUTE'
     ) then
    raise exception 'dealer PT wage readiness helper ACL repair did not converge';
  end if;
end;
$$;

commit;
