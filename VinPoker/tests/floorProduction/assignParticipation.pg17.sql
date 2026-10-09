\set ON_ERROR_STOP on
-- Optional control distinguishes tuple repair from the missing upstream chip
-- projection. Default remains the original RED; never seed counts silently.
\if :{?seed_chip_projection}
\else
\set seed_chip_projection false
\endif
\if :{?projection_stack}
\else
\set projection_stack 20000
\endif
\if :{?free_sit_roundtrip}
\else
\set free_sit_roundtrip false
\endif
-- Isolated current-schema DB only. All fixture and public writes roll back.
BEGIN;
INSERT INTO auth.users(id) VALUES('f7350000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7350000-0000-4000-8000-000000000002','f7350000-0000-4000-8000-000000000001','Assign participation TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000002','Assign participation TEST','live','playing',1);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7350000-0000-4000-8000-000000000011','f7350000-0000-4000-8000-000000000002','Assign TEST',73,'tournament','inactive','available');
INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,buy_in,reference_code,status) VALUES
 ('f7350000-0000-4000-8000-000000000021','f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000001','f7350000-0000-4000-8000-000000000002',0,'ASSIGN-PARTICIPATION-TEST','confirmed');
INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,current_stack,status,source) VALUES
 ('f7350000-0000-4000-8000-000000000031','f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000021','f7350000-0000-4000-8000-000000000001',1,20000,'registered','online');
SELECT set_config('request.jwt.claim.sub','f7350000-0000-4000-8000-000000000001',true);
SELECT set_config('test.assign_free_sit_roundtrip', :'free_sit_roundtrip', true);
SELECT set_config('test.assign_projection_mismatch', (:seed_chip_projection AND :projection_stack <> 20000)::text, true);
\if :seed_chip_projection
INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
VALUES('f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000001',1,:projection_stack);
\endif
DO $$ DECLARE opened jsonb; result jsonb; projection jsonb; tt uuid; session_id uuid; rev bigint; epoch bigint; request_id uuid:=gen_random_uuid(); replay jsonb; BEGIN
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000011','manual',gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'open failed: %',opened; END IF;
 tt:=(opened->>'tournament_table_id')::uuid;
 session_id:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT revision INTO rev FROM public.table_sessions WHERE id=session_id;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,request_id);
 IF current_setting('test.assign_projection_mismatch')::boolean THEN
   IF result->>'ok' IS DISTINCT FROM 'false' OR result->>'error' IS DISTINCT FROM 'chip_projection_mismatch' THEN
     RAISE EXCEPTION 'mismatched projection must deny assign: %',result;
   END IF;
   PERFORM set_config('role','none',true);
   IF EXISTS(SELECT 1 FROM public.tournament_seats WHERE entry_id='f7350000-0000-4000-8000-000000000031')
     OR (SELECT revision FROM public.table_sessions WHERE id=session_id) IS DISTINCT FROM rev
     OR (SELECT status FROM public.tournament_entries WHERE id='f7350000-0000-4000-8000-000000000031') IS DISTINCT FROM 'registered'
     OR (SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='f7350000-0000-4000-8000-000000000003') IS DISTINCT FROM 20001 THEN
     RAISE EXCEPTION 'denied assign mutated canonical state';
   END IF;
   RETURN;
 END IF;
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'initial assign failed: %',result; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,request_id);
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'same payload must replay original receipt'; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,2,rev,request_id);
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
   RAISE EXCEPTION 'changed seat must conflict instead of replay: %',replay;
 END IF;
 replay:=public.floor_assign_entry_to_seat_v4(gen_random_uuid(),tt,1,rev,request_id);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed entry must conflict'; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',gen_random_uuid(),1,rev,request_id);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed table must conflict'; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev+1,request_id);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed revision must conflict'; END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,request_id);
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN
   RAISE EXCEPTION 'another actor cannot replay owner receipt: %',replay;
 END IF;
 PERFORM set_config('request.jwt.claim.sub','f7350000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','none',true);
 INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,current_stack,status,source)
 VALUES('f7350000-0000-4000-8000-000000000032','f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000021','f7350000-0000-4000-8000-000000000001',2,20000,'registered','online');
 SELECT revision INTO rev FROM public.table_sessions WHERE id=session_id;
 PERFORM set_config('role','authenticated',true);
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000032',tt,1,rev,gen_random_uuid());
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'seat_occupied' THEN
   RAISE EXCEPTION 'occupied seat must deny assignment: %',replay;
 END IF;
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM public.tournament_chip_counts WHERE tournament_id='f7350000-0000-4000-8000-000000000003' AND entry_number=2)
   OR (SELECT revision FROM public.table_sessions WHERE id=session_id) IS DISTINCT FROM rev THEN
   RAISE EXCEPTION 'occupied-seat failure must roll back newly materialized projection and revision';
 END IF;
 DELETE FROM public.tournament_entries WHERE id='f7350000-0000-4000-8000-000000000032';
 PERFORM set_config('role','authenticated',true);
 IF current_setting('test.assign_free_sit_roundtrip')::boolean THEN
   PERFORM set_config('role','none',true);
   SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=session_id;
   PERFORM set_config('role','authenticated',true);
   result:=public.floor_free_sit_player_v1('f7350000-0000-4000-8000-000000000031',rev,epoch,20000,gen_random_uuid(),'assign projection regression');
   RAISE NOTICE 'PUBLIC_FREE_SIT_RESULT=%',result;
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'free sit failed: %',result; END IF;
   projection:=public.get_tournament_participation_v1('f7350000-0000-4000-8000-000000000003');
   IF (projection->'counts'->>'waiting')::integer<>1 OR (projection->'counts'->>'live_entry_stack')::bigint<>20000 THEN
     RAISE EXCEPTION 'free sit must preserve waiting entry and stack';
   END IF;
   PERFORM set_config('role','none',true);
   SELECT revision INTO rev FROM public.table_sessions WHERE id=session_id;
   PERFORM set_config('role','authenticated',true);
   result:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,2,rev,gen_random_uuid());
 END IF;
 projection:=public.get_tournament_participation_v1('f7350000-0000-4000-8000-000000000003');
 PERFORM set_config('role','none',true);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'assign failed: %',result; END IF;
 RAISE NOTICE 'ASSIGN_PUBLIC_PROJECTION=%',projection;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'seats') s
   WHERE s->>'entry_id'='f7350000-0000-4000-8000-000000000031'
    AND s->>'participation_status'='seated' AND s->>'table_id'=tt::text
    AND s->>'table_session_id'=session_id::text AND (s->>'chip_count')::bigint=20000) THEN
  RAISE EXCEPTION 'assigned entry must remain valid seated participation with exact tuple';
 END IF;
END $$;
ROLLBACK;
