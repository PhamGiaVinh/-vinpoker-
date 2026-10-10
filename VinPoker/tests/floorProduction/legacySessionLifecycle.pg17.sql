\set ON_ERROR_STOP on
-- Current-schema isolated DB only. No historical/archive migration imports.
-- Seed identities only; open/close operations use the real public RPC seams.
BEGIN;
SET LOCAL statement_timeout='15s';
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'legacy_session_lifecycle: %',message; END IF; END $$;
SELECT pg_temp.assert_true(current_database() LIKE 'vinpoker_ops_%'
  AND inet_server_addr()='127.0.0.1'::inet,'isolated loopback DB required');
INSERT INTO auth.users(id) VALUES('f7460000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7460000-0000-4000-8000-000000000002','f7460000-0000-4000-8000-000000000001','Legacy lifecycle TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7460000-0000-4000-8000-000000000003','f7460000-0000-4000-8000-000000000002','Legacy lifecycle TEST','live','playing',1);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7460000-0000-4000-8000-000000000011','f7460000-0000-4000-8000-000000000002','Legacy close TEST',91,'tournament','inactive','available'),
 ('f7460000-0000-4000-8000-000000000012','f7460000-0000-4000-8000-000000000002','Canonical close TEST',92,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7460000-0000-4000-8000-000000000001',true);
-- Positive control: the supported writer must close the same kind of session.
-- Preserve its request identity across replay; changed payload must conflict.
DO $$ DECLARE opened jsonb; result jsonb; replay jsonb; tt uuid; sid uuid;
 revision bigint; request_id uuid:=gen_random_uuid(); BEGIN
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7460000-0000-4000-8000-000000000003',
   'f7460000-0000-4000-8000-000000000012','manual',gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'canonical fixture open failed: %',opened; END IF;
 tt:=(opened->>'tournament_table_id')::uuid;
 sid:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT s.revision INTO revision FROM public.table_sessions s WHERE s.id=sid;
 PERFORM set_config('role','authenticated',true);
 result:=public.close_tournament_table_v4(tt,revision,request_id);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'canonical close failed: %',result; END IF;
 replay:=public.close_tournament_table_v4(tt,revision,request_id);
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'canonical replay changed receipt'; END IF;
 replay:=public.close_tournament_table_v4(tt,revision+1,request_id);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
   RAISE EXCEPTION 'canonical changed-payload replay not rejected: %',replay;
 END IF;
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id=sid)
   AND (SELECT status='closed' FROM public.tournament_tables WHERE id=tt),
   'canonical close must close logical table and exact session');
 PERFORM set_config('role','authenticated',true);
 replay:=public.close_tournament_table(tt,'fill_lowest_table','legacy closed-session call');
 IF replay->>'error' IS DISTINCT FROM 'exact_session_required' THEN
   RAISE EXCEPTION 'closed canonical session accepted by legacy writer: %',replay;
 END IF;
 PERFORM set_config('request.jwt.claim.sub','f7460000-0000-4000-8000-000000000099',true);
 replay:=public.close_tournament_table(tt,'fill_lowest_table','foreign actor closed-session call');
 IF replay->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN
   RAISE EXCEPTION 'foreign actor obtained legacy closed-session receipt: %',replay;
 END IF;
 PERFORM set_config('request.jwt.claim.sub','f7460000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','none',true);
 RAISE NOTICE 'CANONICAL_CLOSE_SESSION_AND_RECEIPT_PASS';
END $$;
DO $$ DECLARE opened jsonb; result jsonb; tt uuid; sid uuid; BEGIN
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7460000-0000-4000-8000-000000000003',
   'f7460000-0000-4000-8000-000000000011','manual',gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture open failed: %',opened; END IF;
 tt:=(opened->>'tournament_table_id')::uuid;
 sid:=(opened->>'table_session_id')::uuid;
 result:=public.close_tournament_table(tt,'fill_lowest_table','isolated legacy close TEST');
 PERFORM set_config('role','none',true);
 RAISE NOTICE 'legacy close observed result=% table_status=% session_closed=%',result,
   (SELECT status FROM public.tournament_tables WHERE id=tt),
   (SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id=sid);
 IF result->>'ok'='true' THEN
   PERFORM pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id=sid),
     'legacy close acknowledged success while exact session remains open');
   PERFORM pg_temp.assert_true((SELECT status<>'active' FROM public.tournament_tables WHERE id=tt),
     'successful close must close logical assignment');
 ELSE
   PERFORM pg_temp.assert_true(result->>'error'='exact_session_required',
     'managed table must explain canonical session requirement');
   PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=sid)
     AND (SELECT status='active' FROM public.tournament_tables WHERE id=tt),
     'denied legacy close must leave both session and assignment open');
 END IF;
END $$;
ROLLBACK;
\echo LEGACY_SESSION_LIFECYCLE_PASS
