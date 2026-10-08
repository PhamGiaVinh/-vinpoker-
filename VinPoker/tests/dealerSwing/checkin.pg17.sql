\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'checkin_test_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES ('e1000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','Check-in TEST','TEST');
INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES
 ('e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000002','Overnight TEST','18:00','06:00'),
 ('e1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000002','Other TEST','08:00','16:00');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
 ('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002','Dealer TEST','active'),
 ('e1000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000002','Stale TEST','active');
INSERT INTO public.dealer_attendance(dealer_id,shift_id,shift_date,status,check_in_time,current_state) VALUES
 ('e1000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000003',current_date-2,'checked_in',now()-interval '2 days','available');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.operator_check_in_dealer_v1('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000011')::text AS payload \gset first_
SELECT public.operator_check_in_dealer_v1('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000011')::text AS payload \gset retry_
SELECT public.operator_check_in_dealer_v1('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000011')::text AS payload \gset conflict_
SELECT public.operator_check_in_dealer_v1('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000012')::text AS payload \gset duplicate_
SELECT public.operator_check_in_dealer_v1('e1000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000013')::text AS payload \gset stale_
RESET ROLE;
SELECT pg_temp.assert_true(:'first_payload'::jsonb->>'outcome'='checked_in' AND :'first_payload'=:'retry_payload','lost response replay same receipt');
SELECT pg_temp.assert_true(:'conflict_payload'::jsonb->>'error'='IDEMPOTENCY_CONFLICT','same key different shift rejected');
SELECT pg_temp.assert_true(:'duplicate_payload'::jsonb->>'outcome'='already_checked_in','second actor intent does not create another attendance');
SELECT pg_temp.assert_true(:'stale_payload'::jsonb->>'error'='previous_shift_open','old shift preserved and blocked');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_attendance WHERE dealer_id='e1000000-0000-4000-8000-000000000005'),'one active row');
SELECT pg_temp.assert_true((:'first_payload'::jsonb->>'shift_date')::date = CASE WHEN (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<'06:00' THEN (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-1 ELSE (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END,'UTC+7 overnight operating day');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000099',true);
SET LOCAL ROLE authenticated;
SELECT public.operator_check_in_dealer_v1('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000015')::text AS payload \gset denied_
RESET ROLE;
SELECT pg_temp.assert_true(:'denied_payload'::jsonb->>'error'='actor_not_allowed','outsider denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.operator_check_in_dealer_v1(uuid,uuid,uuid,uuid)','EXECUTE'),'anonymous denied');
ROLLBACK;
