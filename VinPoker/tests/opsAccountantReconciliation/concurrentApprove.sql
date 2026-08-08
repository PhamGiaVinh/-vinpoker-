\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
SELECT public.transition_payroll_status_secure(
  '40000000-0000-4000-8000-000000000001',
  'submitted',
  'approved',
  NULL
);
