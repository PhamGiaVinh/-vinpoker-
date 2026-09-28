SELECT public.assert_true(
  NOT has_function_privilege('anon','public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE'),
  'canonical core must be private'
);
SELECT public.assert_true(
  has_function_privilege('authenticated','public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)','EXECUTE'),
  'operator ACL'
);
SELECT public.assert_true(
  has_function_privilege('service_role','public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE'),
  'worker ACL'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000099',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.assert_raises('SWING_OPERATOR_FORBIDDEN', $$
  SELECT public.operator_perform_swing(
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',1,'80000000-0000-4000-8000-000000000001')
$$);

SELECT set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',false);
SELECT public.assert_true(
  public.operator_perform_swing(
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',1,'80000000-0000-4000-8000-000000000002') ->> 'outcome' = 'swung',
  'authorized operator swing'
);
SELECT public.assert_true(
  (public.operator_perform_swing(
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',1,'80000000-0000-4000-8000-000000000002') ->> 'idempotent')::boolean,
  'response-loss replay'
);
SELECT public.assert_raises('SWING_ASSIGNMENT_CONTEXT_MISMATCH', $$
  SELECT public.operator_perform_swing(
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',1,'80000000-0000-4000-8000-000000000003')
$$);
RESET ROLE;

SELECT public.assert_true(
  (SELECT count(*) = 1 FROM public.dealer_swing_operator_requests WHERE completed_at IS NOT NULL),
  'one durable operator request'
);
SELECT public.assert_true(
  (SELECT count(*) = 1 FROM public.dealer_assignments
   WHERE table_id='20000000-0000-4000-8000-000000000001' AND status='assigned'
     AND table_session_id='30000000-0000-4000-8000-000000000001'),
  'one session-bound replacement'
);

SET ROLE service_role;
SELECT set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.assert_raises('SWING_INCOMING_CLUB_MISMATCH', $$
  SELECT public.worker_perform_swing(
    '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',30,false,15,60,1,
    '50000000-0000-4000-8000-000000000004',0)
$$);
SELECT public.assert_raises('SWING_INCOMING_ATTENDANCE_INVALID', $$
  SELECT public.worker_perform_swing(
    '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',30,false,15,60,1,
    '50000000-0000-4000-8000-000000000005',0)
$$);
SELECT public.assert_true(
  public.worker_execute_pre_assigned_swing(
    '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',1,
    '50000000-0000-4000-8000-000000000003',now()+interval '30 minutes',30,false,15
  ) ->> 'status' = 'success',
  'trusted preassigned worker'
);
RESET ROLE;

UPDATE public.dealer_assignments SET table_session_id=NULL
WHERE id='60000000-0000-4000-8000-000000000003';
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.assert_raises('TABLE_SESSION_BINDING_REQUIRED', $$
  SELECT public.worker_perform_swing(
    '20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000003',30,false,15,60,1,NULL,0)
$$);
RESET ROLE;
