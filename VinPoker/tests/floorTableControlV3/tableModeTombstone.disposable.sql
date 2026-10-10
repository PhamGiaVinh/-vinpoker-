\set ON_ERROR_STOP on
-- Run after tableModeRequest.disposable.sql in an isolated PostgreSQL database.
-- All fixture changes roll back; this never targets a linked Supabase project.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE public.tracker_voice_configs SET correction_state='ready'
WHERE tournament_table_id='00000000-0000-0000-0000-000000000770';
-- Receipt reconciliation remains available after tombstoning; it is not a new write.
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; replay jsonb; key uuid:=gen_random_uuid(); BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,key);
  PERFORM public.floor_table_v3_assert(result->>'outcome'='applied','open tour mode regression');
  UPDATE public.tournaments SET deleted_at=now() WHERE id=s.tournament_id;
  replay:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,key);
  PERFORM public.floor_table_v3_assert(replay=result,'committed receipt replay after deletion');
  replay:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'manual',s.revision,s.control_epoch,key);
  PERFORM public.floor_table_v3_assert(replay->>'error'='IDEMPOTENCY_CONFLICT','deleted tour still rejects changed receipt payload');
  UPDATE public.tournaments SET deleted_at=NULL WHERE id=s.tournament_id;
  SELECT * INTO s FROM public.table_sessions WHERE id=s.id;
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'manual',s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'outcome'='applied','restore local fixture mode');
END $$;
UPDATE public.tournaments SET deleted_at=now()
WHERE id='00000000-0000-0000-0000-000000000131';
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'ok'='false',
    'deleted tournament rejects new mode intent; observed '||result::text);
  PERFORM public.floor_table_v3_assert((SELECT control_mode=s.control_mode AND control_epoch=s.control_epoch AND revision=s.revision FROM public.table_sessions WHERE id=s.id),
    'rejected intent preserves mode epoch revision');
  PERFORM public.floor_table_v3_assert((SELECT sum(chip_count)=30000 FROM public.tournament_seats WHERE table_session_id=s.id AND is_active), 'tombstone rejection preserves chips');
END $$;
DO $$ BEGIN
  PERFORM public.floor_table_v3_assert(public.floor_get_table_control_mode_request_v1('00000000-0000-0000-0000-000000000770','00000000-0000-0000-0000-000000000670')->>'ok'='false','deleted tour pending read denied');
  BEGIN
    PERFORM public.get_floor_tournament_table_inventory_v1('00000000-0000-0000-0000-000000000131');
    RAISE EXCEPTION 'deleted tour inventory unexpectedly accessible';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.floor_table_v3_assert(NOT has_function_privilege('anon','public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)','EXECUTE'),'anon remains denied');
  PERFORM public.floor_table_v3_assert(has_function_privilege('authenticated','public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)','EXECUTE'),'authenticated grant preserved');
  PERFORM public.floor_table_v3_assert(NOT has_function_privilege('authenticated','floor_private.expire_tournament_mode_requests_v1()','EXECUTE'),'private callback not browser granted');
END $$;
ROLLBACK;
