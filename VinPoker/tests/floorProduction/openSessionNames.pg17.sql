\set ON_ERROR_STOP on
-- Exact restored current schema; isolated transaction, never a live fixture.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'floor_open_session_test: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('f7260000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7260000-0000-4000-8000-000000000002','f7260000-0000-4000-8000-000000000001','Floor open TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES
 ('f7260000-0000-4000-8000-000000000003','f7260000-0000-4000-8000-000000000002','Floor open TEST','live','playing');
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7260000-0000-4000-8000-000000000011','f7260000-0000-4000-8000-000000000002','Bàn 1',1,'tournament','inactive','available'),
 ('f7260000-0000-4000-8000-000000000012','f7260000-0000-4000-8000-000000000002','Bàn 2',2,'tournament','inactive','available');
-- Retain a legacy empty-name row: the migration must not rewrite it.
INSERT INTO public.tournament_tables(id,tournament_id,table_name,table_number,status) VALUES
 ('f7260000-0000-4000-8000-000000000090','f7260000-0000-4000-8000-000000000003','',90,'closed');
SELECT set_config('request.jwt.claim.sub','f7260000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb; b jsonb; replay jsonb; reopened jsonb; closed jsonb; BEGIN
 a:=public.floor_open_tournament_table_v3('f7260000-0000-4000-8000-000000000003','f7260000-0000-4000-8000-000000000011','manual','f7260000-0000-4000-8000-000000000051');
 PERFORM pg_temp.assert_true((a->>'ok')::boolean,'first table opens alongside historical empty label');
 b:=public.floor_open_tournament_table_v3('f7260000-0000-4000-8000-000000000003','f7260000-0000-4000-8000-000000000012','manual','f7260000-0000-4000-8000-000000000052');
 PERFORM pg_temp.assert_true((b->>'ok')::boolean,'second physical table opens in same tour');
 replay:=public.floor_open_tournament_table_v3('f7260000-0000-4000-8000-000000000003','f7260000-0000-4000-8000-000000000011','manual','f7260000-0000-4000-8000-000000000051');
 PERFORM pg_temp.assert_true(replay=a,'response-loss replay returns original exact session');
 replay:=public.floor_open_tournament_table_v3('f7260000-0000-4000-8000-000000000003','f7260000-0000-4000-8000-000000000012','manual','f7260000-0000-4000-8000-000000000051');
 PERFORM pg_temp.assert_true(replay->>'error'='IDEMPOTENCY_CONFLICT','same key different table conflicts');
 replay:=public.floor_open_tournament_table_v3('f7260000-0000-4000-8000-000000000003','f7260000-0000-4000-8000-000000000012',NULL,'f7260000-0000-4000-8000-000000000053');
 PERFORM pg_temp.assert_true(replay->>'error'='invalid_request','null mode rejected before mutation');
 closed:=public.close_tournament_table_v3((a->>'tournament_table_id')::uuid,1,'f7260000-0000-4000-8000-000000000054');
 PERFORM pg_temp.assert_true((closed->>'ok')::boolean,'empty table closes through canonical RPC');
 reopened:=public.floor_open_tournament_table_v3('f7260000-0000-4000-8000-000000000003','f7260000-0000-4000-8000-000000000011','manual','f7260000-0000-4000-8000-000000000055');
 PERFORM pg_temp.assert_true((reopened->>'ok')::boolean AND reopened->>'table_session_id'<>a->>'table_session_id','reopen creates new incarnation despite historical unique-name index');
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=3 AND count(DISTINCT table_name)=3 FROM public.tournament_tables WHERE tournament_id='f7260000-0000-4000-8000-000000000003' AND table_session_id IS NOT NULL),'all session labels unique and history retained');
SELECT pg_temp.assert_true((SELECT table_name='' FROM public.tournament_tables WHERE id='f7260000-0000-4000-8000-000000000090'),'legacy label unchanged');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.table_sessions WHERE tournament_id='f7260000-0000-4000-8000-000000000003' AND closed_at IS NULL),'exactly two active physical sessions');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.floor_open_tournament_table_v3(uuid,uuid,text,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.floor_open_tournament_table_v3(uuid,uuid,text,uuid)','EXECUTE'),'public and service roles remain denied');
ROLLBACK;
