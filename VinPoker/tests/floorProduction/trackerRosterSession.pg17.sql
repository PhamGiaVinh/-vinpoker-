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
DO $$ DECLARE opened jsonb; old_table uuid; current_table uuid; current_session uuid; result jsonb; epoch bigint; BEGIN
 opened:=public.floor_open_tournament_table_v3('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011','manual','f7280000-0000-4000-8000-000000000051');
 PERFORM pg_temp.assert_true((opened->>'ok')::boolean,'first session opens');
 old_table:=(opened->>'tournament_table_id')::uuid;
 -- Close through the real public seam, preserving the previous incarnation.
 result:=public.close_tournament_table_v3(old_table,1,'f7280000-0000-4000-8000-000000000052');
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'empty session closes');
 opened:=public.floor_open_tournament_table_v3('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011','manual','f7280000-0000-4000-8000-000000000053');
 PERFORM pg_temp.assert_true((opened->>'ok')::boolean,'physical table reopens');
 current_table:=(opened->>'tournament_table_id')::uuid; current_session:=(opened->>'table_session_id')::uuid;
 PERFORM pg_temp.assert_true(current_table<>old_table,'new tournament table incarnation');
 result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003',old_table,1,'Stale TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(result->>'error'='table_mismatch','closed exact table rejected');
 result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011',1,'A TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'physical ID routes to current session');
 result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003',current_table,2,'B TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'exact current table routes correctly');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 AND bool_and(entry_id IS NOT NULL AND tournament_table_id=current_table AND table_session_id=current_session) FROM public.tournament_seats WHERE tournament_id='f7280000-0000-4000-8000-000000000003' AND is_active),'canonical seats belong exclusively to reopened session');
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id=current_session RETURNING control_epoch INTO epoch;
 -- Exercise the actual writer, not a hand INSERT with a convenient logical ID.
 result:=public.start_tracker_hand_v3('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,1,now(),'f7280000-0000-4000-8000-000000000001',1);
 PERFORM pg_temp.assert_true(result->>'status'='success','public V3 start accepts canonical roster');
 PERFORM pg_temp.assert_true((SELECT table_id='f7280000-0000-4000-8000-000000000011' AND tournament_table_id=current_table AND table_session_id=current_session AND tracker_small_blind=100 AND tracker_big_blind=100 AND tracker_sb_position=1 AND tracker_bb_position=2 FROM public.tournament_hands WHERE id=(result->>'hand_id')::uuid),'physical hand ID resolves exact-session blind lineage');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 AND sum(starting_stack)=40000 FROM public.hand_players WHERE hand_id=(result->>'hand_id')::uuid),'same roster and chip sum frozen');
 result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003',current_table,3,'During hand TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(result->>'error'='hand_in_progress','roster remains locked while hand active');
END $$;
ROLLBACK;
