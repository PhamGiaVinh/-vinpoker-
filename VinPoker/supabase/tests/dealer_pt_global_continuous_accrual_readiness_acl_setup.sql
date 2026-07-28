-- Mimic the explicit service_role EXECUTE grant observed in the protected live
-- catalog. The forward repair must remove it without touching payroll data.
grant execute on function public.assert_dealer_pt_wage_global_activation_ready(timestamptz)
  to service_role;
