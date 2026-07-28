do $$
declare
  v_payment_count bigint;
  v_policy_count bigint;
  v_attendance_count bigint;
begin
  select count(*) into v_payment_count from public.dealer_pt_wage_payments;
  select count(*) into v_policy_count from public.dealer_pt_wage_accrual_policies;
  select count(*) into v_attendance_count from public.dealer_attendance;

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
    raise exception 'readiness helper remains directly executable';
  end if;

  if (select count(*) from public.dealer_pt_wage_payments) <> v_payment_count
     or (select count(*) from public.dealer_pt_wage_accrual_policies) <> v_policy_count
     or (select count(*) from public.dealer_attendance) <> v_attendance_count then
    raise exception 'ACL repair changed payroll data';
  end if;
end;
$$;
