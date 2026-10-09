\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'tracker_roster_session_test: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('f7280000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7280000-0000-4000-8000-000000000002','f7280000-0000-4000-8000-000000000001','Roster session TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000002','Roster session TEST','live','playing',1);
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break) VALUES
 ('f7280000-0000-4000-8000-000000000003',1,100,100,0,false);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7280000-0000-4000-8000-000000000011','f7280000-0000-4000-8000-000000000002','Roster session TEST',72,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000001',true);
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','floor_private.set_tracker_roster_seat_core_v1(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)','EXECUTE'),'browser cannot call private core');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','floor_private.set_tracker_roster_seat_core_v1(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)','EXECUTE'),'service cannot bypass private core');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text)','EXECUTE'),'anonymous writer denied');
\if :{?LATE_PHYSICAL_REQUEST_CASE}
SELECT set_config('test.late_physical_request','true',true);
\endif
DO $$ DECLARE opened jsonb; old_table uuid; old_session uuid; current_table uuid; current_session uuid; result jsonb; epoch bigint; BEGIN
 opened:=public.floor_open_tournament_table_v3('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011','manual','f7280000-0000-4000-8000-000000000051');
 PERFORM pg_temp.assert_true((opened->>'ok')::boolean,'first session opens');
 old_table:=(opened->>'tournament_table_id')::uuid;
 old_session:=(opened->>'table_session_id')::uuid;
 -- Close through the real public seam, preserving the previous incarnation.
 result:=public.close_tournament_table_v3(old_table,1,'f7280000-0000-4000-8000-000000000052');
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'empty session closes');
 opened:=public.floor_open_tournament_table_v3('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011','manual','f7280000-0000-4000-8000-000000000053');
 PERFORM pg_temp.assert_true((opened->>'ok')::boolean,'physical table reopens');
 current_table:=(opened->>'tournament_table_id')::uuid; current_session:=(opened->>'table_session_id')::uuid;
 PERFORM pg_temp.assert_true(current_table<>old_table,'new tournament table incarnation');
 IF current_setting('test.late_physical_request',true)='true' THEN
  -- Payload was prepared while session A was open. The public legacy seam
  -- carries only its reusable physical ID; deliver it after A closes/B opens.
  result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011',9,'Late A TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_true(NOT COALESCE((result->>'ok')::boolean,false),'late physical request must not write into reopened session B');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='f7280000-0000-4000-8000-000000000003' AND table_session_id=current_session AND is_active),'reopened B remains untouched by late A request');
 END IF;
 result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003',old_table,1,'Stale TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(result->>'error'='roster_context_required','legacy payload cannot bypass exact context');
 SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=current_session;
 PERFORM set_config('test.roster_table',current_table::text,true);
 PERFORM set_config('test.roster_session',current_session::text,true);
 PERFORM set_config('test.roster_epoch',epoch::text,true);
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',old_table,old_session,1,'f7280000-0000-4000-8000-000000000065',1,'Old session TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='table_session_mismatch','exact old session cannot write after reopen');
 INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
 VALUES('f7280000-0000-4000-8000-000000000003',current_table,current_session,8,'TEST lock','f7280000-0000-4000-8000-000000000001');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000066',8,'Locked TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='seat_locked','locked empty seat cannot be occupied');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000067',99,'Over capacity TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='bad_seat_number','capacity retained');
 PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000099',true);
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000068',1,'Outsider TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='actor_not_authorized','outsider cannot write roster');
 PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','authenticated',true);
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000);
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'exact context routes to current session');
 PERFORM pg_temp.assert_true(public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000)=result,'same request replay');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000061',1,'A TEST',21000);
 PERFORM pg_temp.assert_true(result->>'error'='IDEMPOTENCY_CONFLICT','changed payload conflicts');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch-1,'f7280000-0000-4000-8000-000000000063',2,'B TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='STALE_STATE','old epoch rejected');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000062',2,'B TEST',20000);
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'exact current table routes correctly');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 AND bool_and(entry_id IS NOT NULL AND tournament_table_id=current_table AND table_session_id=current_session) FROM public.tournament_seats WHERE tournament_id='f7280000-0000-4000-8000-000000000003' AND is_active),'canonical seats belong exclusively to reopened session');
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id=current_session RETURNING control_epoch INTO epoch;
 -- Exercise the actual writer, not a hand INSERT with a convenient logical ID.
 result:=public.start_tracker_hand_v3('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,1,now(),'f7280000-0000-4000-8000-000000000001',1);
 PERFORM pg_temp.assert_true(result->>'status'='success','public V3 start accepts canonical roster');
 PERFORM pg_temp.assert_true((SELECT table_id=current_table AND tournament_table_id=current_table AND table_session_id=current_session AND tracker_small_blind=100 AND tracker_big_blind=100 AND tracker_sb_position=1 AND tracker_bb_position=2 FROM public.tournament_hands WHERE id=(result->>'hand_id')::uuid),'hand uses logical FK and exact-session blind lineage');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 AND sum(starting_stack)=40000 FROM public.hand_players WHERE hand_id=(result->>'hand_id')::uuid),'same roster and chip sum frozen');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000064',3,'During hand TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='hand_in_progress','roster remains locked while hand active');
END $$;
-- Only public RPC calls under the actual browser role; privileged fixture
-- setup and DB assertions stay outside this section.
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',
  current_setting('test.roster_table')::uuid,current_setting('test.roster_session')::uuid,
  current_setting('test.roster_epoch')::bigint,'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000);
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->'seat'->>'chip_count'<>'20000' THEN
  RAISE EXCEPTION 'authenticated receipt replay failed: %',r; END IF;
 r:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',
  current_setting('test.roster_table')::uuid,current_setting('test.roster_session')::uuid,
  current_setting('test.roster_epoch')::bigint,'f7280000-0000-4000-8000-000000000061',1,'Changed TEST',20000);
 IF r->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'authenticated payload conflict failed'; END IF;
 BEGIN
  PERFORM floor_private.set_tracker_roster_seat_core_v1(NULL,NULL,1,'Bypass',20000,NULL,false,NULL,auth.uid());
  RAISE EXCEPTION 'private core browser bypass';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
