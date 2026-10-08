\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'mass_open_test_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('e1800000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e1800000-0000-4000-8000-000000000002','e1800000-0000-4000-8000-000000000001','Mass open TEST','TEST');
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
VALUES('e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000002','Fresh TEST',91,'cash','inactive','available'),
 ('e1800000-0000-4000-8000-000000000012','e1800000-0000-4000-8000-000000000002','Tournament requires Floor TEST',92,'tournament','inactive','available');
INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
VALUES('e1800000-0000-4000-8000-000000000030','e1800000-0000-4000-8000-000000000002','TEST','08:00','23:00');
INSERT INTO public.dealers(id,club_id,full_name,status)
VALUES('e1800000-0000-4000-8000-000000000031','e1800000-0000-4000-8000-000000000002','TEST dealer','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
VALUES('e1800000-0000-4000-8000-000000000041','e1800000-0000-4000-8000-000000000031','e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
INSERT INTO public.dealer_mass_open_rollout(id,enabled,all_clubs_enabled,allowed_club_ids)
VALUES(true,true,false,ARRAY['e1800000-0000-4000-8000-000000000002'::uuid])
ON CONFLICT(id) DO UPDATE SET enabled=true,all_clubs_enabled=false,allowed_club_ids=EXCLUDED.allowed_club_ids;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000050','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000011'::uuid],'cash');
SELECT pg_temp.assert_true((public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000050','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000011'::uuid],'cash')->>'idempotent_replay')::boolean,'same request replay');
SELECT pg_temp.assert_true(public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000050','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000011'::uuid],'vip')->>'outcome'='idempotency_conflict','changed payload conflicts');
SELECT pg_temp.assert_true(public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000051','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000012'::uuid],'tournament')->>'reason'='open_tournament_in_floor','never guess tournament from dealer shift');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.table_sessions WHERE game_table_id='e1800000-0000-4000-8000-000000000011' AND closed_at IS NULL),'one canonical session created');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.get_dealer_operational_tables_v1('e1800000-0000-4000-8000-000000000002')),'worker sees newly opened canonical table');
SELECT pg_temp.assert_true((SELECT public.worker_assign_dealer_to_session_v1('e1800000-0000-4000-8000-000000000002',id,table_session_id,'e1800000-0000-4000-8000-000000000041',now()+interval '45 minutes','mass-open-test-assign')->>'outcome'='ok'
 FROM public.get_dealer_operational_tables_v1('e1800000-0000-4000-8000-000000000002')),'worker commits exact-session assignment');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id WHERE a.table_id='e1800000-0000-4000-8000-000000000011' AND s.closed_at IS NULL AND a.released_at IS NULL),'one committed assignment for opened incarnation');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE game_table_id='e1800000-0000-4000-8000-000000000012'),'rejected tournament does not open a session');
ROLLBACK;
