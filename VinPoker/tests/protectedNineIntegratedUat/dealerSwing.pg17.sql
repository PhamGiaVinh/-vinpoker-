\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'dealer_swing_uat_failed: %', message; END IF;
END $$;

SELECT pg_temp.assert_true(
  has_function_privilege('authenticated','public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE'),
  'only contained entrypoints are callable');

INSERT INTO auth.users(id) VALUES ('d1000000-0000-4000-8000-000000000010');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
  ('d1000000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000010','Swing runtime TEST','TEST');
INSERT INTO public.club_dealer_controls(club_id,user_id,granted_by) VALUES
  ('d1000000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000010','d1000000-0000-4000-8000-000000000010');
INSERT INTO public.game_tables(id,club_id,table_name,status) VALUES
  ('d1000000-0000-4000-8000-000000000021','d1000000-0000-4000-8000-000000000011','Swing operator TEST','active'),
  ('d1000000-0000-4000-8000-000000000022','d1000000-0000-4000-8000-000000000011','Swing worker TEST','active');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type) VALUES
  ('d1000000-0000-4000-8000-000000000031','d1000000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000021','cash'),
  ('d1000000-0000-4000-8000-000000000032','d1000000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000022','cash');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
  ('d1000000-0000-4000-8000-000000000041','d1000000-0000-4000-8000-000000000011','Operator outgoing TEST','active'),
  ('d1000000-0000-4000-8000-000000000042','d1000000-0000-4000-8000-000000000011','Operator incoming TEST','active'),
  ('d1000000-0000-4000-8000-000000000043','d1000000-0000-4000-8000-000000000011','Worker outgoing TEST','active'),
  ('d1000000-0000-4000-8000-000000000044','d1000000-0000-4000-8000-000000000011','Worker incoming TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,status,check_in_time,current_state) VALUES
  ('d1000000-0000-4000-8000-000000000051','d1000000-0000-4000-8000-000000000041','checked_in',now()-interval '1 hour','assigned'),
  ('d1000000-0000-4000-8000-000000000052','d1000000-0000-4000-8000-000000000042','checked_in',now()-interval '1 hour','pre_assigned'),
  ('d1000000-0000-4000-8000-000000000053','d1000000-0000-4000-8000-000000000043','checked_in',now()-interval '1 hour','assigned'),
  ('d1000000-0000-4000-8000-000000000054','d1000000-0000-4000-8000-000000000044','checked_in',now()-interval '1 hour','available');
INSERT INTO public.dealer_assignments(
  id,attendance_id,dealer_id,table_id,table_session_id,club_id,assigned_at,swing_due_at,
  status,version,pre_assigned_attendance_id
) VALUES
  ('d1000000-0000-4000-8000-000000000061','d1000000-0000-4000-8000-000000000051','d1000000-0000-4000-8000-000000000041','d1000000-0000-4000-8000-000000000021','d1000000-0000-4000-8000-000000000031','d1000000-0000-4000-8000-000000000011',now()-interval '30 minutes',now(), 'assigned',0,'d1000000-0000-4000-8000-000000000052'),
  ('d1000000-0000-4000-8000-000000000062','d1000000-0000-4000-8000-000000000053','d1000000-0000-4000-8000-000000000043','d1000000-0000-4000-8000-000000000022','d1000000-0000-4000-8000-000000000032','d1000000-0000-4000-8000-000000000011',now()-interval '30 minutes',now(), 'assigned',0,NULL);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  BEGIN
    PERFORM public.operator_perform_swing(
      'd1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      'd1000000-0000-4000-8000-000000000003', 1,
      'd1000000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'operator call unexpectedly accepted without an actor';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%SWING_OPERATOR_UNAUTHENTICATED%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000010', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT public.operator_perform_swing(
  'd1000000-0000-4000-8000-000000000021',
  'd1000000-0000-4000-8000-000000000031',
  'd1000000-0000-4000-8000-000000000061',0,
  'd1000000-0000-4000-8000-000000000071')::text AS payload \gset operator_
SELECT public.operator_perform_swing(
  'd1000000-0000-4000-8000-000000000021',
  'd1000000-0000-4000-8000-000000000031',
  'd1000000-0000-4000-8000-000000000061',0,
  'd1000000-0000-4000-8000-000000000071')::text AS payload \gset operator_retry_
RESET ROLE;
SELECT pg_temp.assert_true(
  :'operator_payload'::jsonb->>'outcome' = 'swung'
  AND (:'operator_retry_payload'::jsonb->>'idempotent')::boolean
  AND (SELECT count(*)=1 FROM public.dealer_swing_operator_requests
       WHERE request_id='d1000000-0000-4000-8000-000000000071' AND completed_at IS NOT NULL)
  AND (SELECT count(*)=1 FROM public.dealer_assignments
       WHERE table_id='d1000000-0000-4000-8000-000000000021'
         AND table_session_id='d1000000-0000-4000-8000-000000000031'
         AND status='assigned' AND released_at IS NULL),
  'operator success and response-loss replay create one session-bound replacement');

SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$ BEGIN
  BEGIN
    PERFORM public.worker_perform_swing(
      'd1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      'd1000000-0000-4000-8000-000000000003', 30, false, 15, 60, 1, NULL, 0);
    RAISE EXCEPTION 'missing exact context unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%SWING_TABLE_NOT_FOUND%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT public.worker_perform_swing(
  'd1000000-0000-4000-8000-000000000022',
  'd1000000-0000-4000-8000-000000000032',
  'd1000000-0000-4000-8000-000000000062',30,false,15,60,0,
  'd1000000-0000-4000-8000-000000000054',0)::text AS payload \gset worker_
RESET ROLE;
SELECT pg_temp.assert_true(
  :'worker_payload'::jsonb->>'outcome' = 'swung'
  AND (SELECT count(*)=1 FROM public.dealer_assignments
       WHERE table_id='d1000000-0000-4000-8000-000000000022'
         AND table_session_id='d1000000-0000-4000-8000-000000000032'
         AND attendance_id='d1000000-0000-4000-8000-000000000054'
         AND status='assigned' AND released_at IS NULL),
  'service worker succeeds only for the exact incoming attendance and session');

SELECT 'DEALER_SWING_INDEPENDENT_PG17_PASS' AS result;
