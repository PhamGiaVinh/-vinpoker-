\set ON_ERROR_STOP on

SELECT public.test_assert(
  NOT has_function_privilege(
    'anon',
    'public.transition_payroll_status_secure(uuid,text,text,text)',
    'EXECUTE'
  ),
  'anon must not execute the caller-bound wrapper'
);
SELECT public.test_assert(
  has_function_privilege(
    'authenticated',
    'public.transition_payroll_status_secure(uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated must execute the caller-bound wrapper'
);
SELECT public.test_assert(
  NOT has_function_privilege(
    'authenticated',
    'public.transition_payroll_status(uuid,text,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated must not execute the caller-supplied legacy writer'
);
SELECT public.test_assert(
  NOT has_function_privilege(
    'authenticated',
    'public._assert_payroll_approval_actor(uuid)',
    'EXECUTE'
  ),
  'strict approval helper must remain private'
);

-- Cashier is denied approve, reject and lock. Rows must remain unchanged.
SELECT public.test_expect_transition_denied(
  '00000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  'submitted',
  'approved'
);
SELECT public.test_expect_transition_denied(
  '00000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  'submitted',
  'rejected'
);
SELECT public.test_expect_transition_denied(
  '00000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  'approved',
  'locked'
);

-- Accountants may submit, but cannot approve/reject/lock their own report.
SELECT public.test_expect_transition_denied(
  '00000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000006',
  'submitted',
  'approved'
);
SELECT public.test_expect_transition_denied(
  '00000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000007',
  'submitted',
  'rejected'
);
SELECT public.test_expect_transition_denied(
  '00000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000008',
  'approved',
  'locked'
);

-- No authenticated actor and a Cashier from another club both fail closed.
SELECT public.test_expect_transition_denied(
  NULL,
  '30000000-0000-4000-8000-000000000009',
  'submitted',
  'approved'
);
SELECT public.test_expect_transition_denied(
  '00000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000011',
  'submitted',
  'approved'
);

-- Cashier and Accountant retain only the non-review submit path.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
SELECT public.transition_payroll_status_secure(
  '30000000-0000-4000-8000-000000000004', 'draft', 'submitted', NULL
);
RESET ROLE;
SELECT public.test_assert(
  (SELECT status = 'submitted' AND submitted_by = '00000000-0000-4000-8000-000000000002'
   FROM public.payroll_periods WHERE id = '30000000-0000-4000-8000-000000000004'),
  'Cashier submit must remain available without granting review authority'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
SELECT public.transition_payroll_status_secure(
  '30000000-0000-4000-8000-000000000005', 'draft', 'submitted', NULL
);
RESET ROLE;
SELECT public.test_assert(
  (SELECT status = 'submitted' AND submitted_by = '00000000-0000-4000-8000-000000000003'
   FROM public.payroll_periods WHERE id = '30000000-0000-4000-8000-000000000005'),
  'Accountant submit must remain available'
);

-- Club owner can approve and lock; actor metadata is server-derived.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
SELECT public.transition_payroll_status_secure(
  '30000000-0000-4000-8000-000000000009', 'submitted', 'approved', NULL
);
SELECT public.transition_payroll_status_secure(
  '30000000-0000-4000-8000-000000000009', 'approved', 'locked', NULL
);
RESET ROLE;
SELECT public.test_assert(
  (SELECT status = 'locked'
      AND approved_by = '00000000-0000-4000-8000-000000000001'
      AND locked_by = '00000000-0000-4000-8000-000000000001'
   FROM public.payroll_periods WHERE id = '30000000-0000-4000-8000-000000000009'),
  'Owner must approve and lock with server-derived actor metadata'
);

-- Super Admin and legacy global Club Admin authority remain unchanged.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);
SELECT public.transition_payroll_status_secure(
  '30000000-0000-4000-8000-000000000010', 'submitted', 'approved', NULL
);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', false);
SELECT public.transition_payroll_status_secure(
  '30000000-0000-4000-8000-000000000012', 'submitted', 'rejected', 'reviewed'
);
RESET ROLE;

SELECT public.test_assert(
  (SELECT status = 'approved' AND approved_by = '00000000-0000-4000-8000-000000000004'
   FROM public.payroll_periods WHERE id = '30000000-0000-4000-8000-000000000010'),
  'Super Admin approval must remain available'
);
SELECT public.test_assert(
  (SELECT status = 'rejected' AND rejected_by = '00000000-0000-4000-8000-000000000005'
   FROM public.payroll_periods WHERE id = '30000000-0000-4000-8000-000000000012'),
  'Club Admin rejection must remain available'
);

SELECT 'ops Accountant payroll approval authority integration passed' AS result;
