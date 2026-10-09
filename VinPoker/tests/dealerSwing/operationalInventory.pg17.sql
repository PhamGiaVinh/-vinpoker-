\set ON_ERROR_STOP on
-- Restored current schema, disposable database only. Entire fixture rolls back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'operational_inventory_test_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('e1700000-0000-4000-8000-000000000001'),('e1700000-0000-4000-8000-000000000098');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000001','Operational TEST','TEST'),
 ('e1700000-0000-4000-8000-000000000099','e1700000-0000-4000-8000-000000000098','Other TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES
 ('e1700000-0000-4000-8000-000000000003','e1700000-0000-4000-8000-000000000002','Operational TEST','live','playing');
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000002','Cash session TEST',1,'cash','inactive','available'),
 ('e1700000-0000-4000-8000-000000000012','e1700000-0000-4000-8000-000000000002','Legacy active TEST',2,'cash','active','available'),
 ('e1700000-0000-4000-8000-000000000013','e1700000-0000-4000-8000-000000000002','Orphan TEST',3,'tournament','active','available'),
 ('e1700000-0000-4000-8000-000000000014','e1700000-0000-4000-8000-000000000002','Closed TEST',4,'cash','active','available');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,control_mode,control_epoch,revision,opened_by,closed_at) VALUES
 ('e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','cash',null,'manual',1,1,'e1700000-0000-4000-8000-000000000001',null),
 ('e1700000-0000-4000-8000-000000000023','e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000013','tournament','e1700000-0000-4000-8000-000000000003','manual',1,1,'e1700000-0000-4000-8000-000000000001',null),
 ('e1700000-0000-4000-8000-000000000024','e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000014','cash',null,'manual',1,1,'e1700000-0000-4000-8000-000000000001',now());
INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES
 ('e1700000-0000-4000-8000-000000000030','e1700000-0000-4000-8000-000000000002','TEST','08:00','23:00'),
 ('e1700000-0000-4000-8000-000000000039','e1700000-0000-4000-8000-000000000099','Other TEST','08:00','23:00');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
 ('e1700000-0000-4000-8000-000000000031','e1700000-0000-4000-8000-000000000002','Telegram-only TEST','active'),
 ('e1700000-0000-4000-8000-000000000039','e1700000-0000-4000-8000-000000000099','Other TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state) VALUES
 ('e1700000-0000-4000-8000-000000000041','e1700000-0000-4000-8000-000000000031','e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available'),
 ('e1700000-0000-4000-8000-000000000049','e1700000-0000-4000-8000-000000000039','e1700000-0000-4000-8000-000000000039',current_date,'checked_in',now(),'available');
SELECT set_config('request.jwt.claim.sub','e1700000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT availability_status='repair_required' FROM public.get_club_table_inventory('e1700000-0000-4000-8000-000000000002') WHERE game_table_id='e1700000-0000-4000-8000-000000000013'),'orphan is explicit repair state');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.get_dealer_operational_tables_v1('e1700000-0000-4000-8000-000000000002')),'only one actual valid session, not three legacy active markers');
SELECT pg_temp.assert_true((SELECT id='e1700000-0000-4000-8000-000000000011' FROM public.get_dealer_operational_tables_v1('e1700000-0000-4000-8000-000000000002')),'inactive legacy marker cannot hide open Floor session');
DO $$ DECLARE result jsonb; replay jsonb; due timestamptz:=now()+interval '30 minutes'; BEGIN
  result:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000049',due,'cross-club-key');
  PERFORM pg_temp.assert_true(result->>'outcome'='attendance_not_available','cross club attendance denied before canonical mutation');
  result:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',due,'exact-key');
  PERFORM pg_temp.assert_true(result->>'outcome'='ok','valid Telegram-only dealer assigned to exact cash session');
  replay:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',due,'exact-key');
  PERFORM pg_temp.assert_true(replay=result,'lost response returns identical receipt');
  replay:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',due+interval '1 minute','exact-key');
  PERFORM pg_temp.assert_true(replay->>'outcome'='idempotency_mismatch','same key changed due conflicts');
  replay:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000014','e1700000-0000-4000-8000-000000000024','e1700000-0000-4000-8000-000000000041',due,'closed-key');
  PERFORM pg_temp.assert_true(replay->>'outcome'='table_session_changed','closed session cannot be assigned');
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_assignments WHERE table_session_id='e1700000-0000-4000-8000-000000000021'),'one bound assignment, no duplicate from retry');
-- Runtime corruption probe: cross-linked denormalized Dealer identity must quarantine.
UPDATE public.dealer_assignments SET dealer_id='e1700000-0000-4000-8000-000000000039' WHERE table_session_id='e1700000-0000-4000-8000-000000000021';
SELECT pg_temp.assert_true((SELECT availability_status='repair_required' FROM floor_private.club_operational_inventory('e1700000-0000-4000-8000-000000000002') WHERE game_table_id='e1700000-0000-4000-8000-000000000011'),'cross-linked Dealer identity quarantined');
UPDATE public.dealer_assignments SET dealer_id='e1700000-0000-4000-8000-000000000031' WHERE table_session_id='e1700000-0000-4000-8000-000000000021';
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text)','EXECUTE') AND NOT has_function_privilege('anon','public.get_dealer_operational_tables_v1(uuid)','EXECUTE'),'worker boundaries not browser-granted');
ROLLBACK;
