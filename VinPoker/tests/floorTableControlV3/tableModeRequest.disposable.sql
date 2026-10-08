\set ON_ERROR_STOP on
-- Run after criticalConsistency.disposable.sql; this is an isolated CI database.
ALTER TABLE public.tracker_voice_configs ADD COLUMN IF NOT EXISTS tournament_table_id uuid;
ALTER TABLE public.tracker_voice_configs ADD COLUMN IF NOT EXISTS correction_state text DEFAULT 'ready';
CREATE TABLE IF NOT EXISTS public.tracker_floor_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hand_id uuid,correction_required boolean,status text);
\ir ../../supabase/migrations/20270128000013_floor_mode_request_safe_boundary_v1.sql
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,operational_status)
VALUES('00000000-0000-0000-0000-000000000570','00000000-0000-0000-0000-000000000010','TEST Mode',70,'available');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,control_mode,revision,opened_by)
VALUES('00000000-0000-0000-0000-000000000670','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000570','tournament','00000000-0000-0000-0000-000000000131','manual',1,'00000000-0000-0000-0000-000000000001');
INSERT INTO public.tournament_tables(id,tournament_id,game_table_id,table_session_id,table_number,max_seats,status)
VALUES('00000000-0000-0000-0000-000000000770','00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000570','00000000-0000-0000-0000-000000000670',70,9,'active');
INSERT INTO public.tournament_seats(tournament_id,player_id,tournament_table_id,table_session_id,seat_number,chip_count,is_active)
VALUES('00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000770','00000000-0000-0000-0000-000000000670',1,30000,true);
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; replay jsonb; rid uuid:=gen_random_uuid(); BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(result->>'outcome'='applied','occupied table changes mode');
  replay:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(replay=result,'lost response replay returns receipt');
  replay:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'manual',s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(replay->>'error'='IDEMPOTENCY_CONFLICT','changed payload conflicts');
  PERFORM public.floor_table_v3_assert((SELECT sum(chip_count)=30000 FROM public.tournament_seats WHERE table_session_id=s.id AND is_active),'chips preserved');
END $$;
INSERT INTO public.tournament_hands(id,tournament_id,table_id,tournament_table_id,table_session_id,status)
VALUES('00000000-0000-0000-0000-000000009970','00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000770','00000000-0000-0000-0000-000000000770','00000000-0000-0000-0000-000000000670','in_progress');
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'manual',s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'outcome'='pending' AND result->'blockers' ? 'active_hand','active hand queues change');
END $$;
UPDATE public.tournament_hands SET status='completed' WHERE id='00000000-0000-0000-0000-000000009970';
SELECT public.floor_table_v3_assert((SELECT control_mode='manual' FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670'),'change applies without an open client');
INSERT INTO public.tracker_voice_configs(tournament_table_id,correction_state) VALUES('00000000-0000-0000-0000-000000000770','correction_pending');
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; rid uuid; BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->'blockers' ? 'correction_pending','correction blocks mode change');
  rid:=(result->>'request_id')::uuid;
  result:=public.floor_cancel_table_control_mode_request_v1('00000000-0000-0000-0000-000000000770',s.id,rid);
  PERFORM public.floor_table_v3_assert(result->>'outcome'='cancelled','operator cancels pending change');
  result:=public.floor_cancel_table_control_mode_request_v1('00000000-0000-0000-0000-000000000770',s.id,rid);
  PERFORM public.floor_table_v3_assert(result->>'outcome'='cancelled','cancel retry is safe');
END $$;
SELECT public.floor_table_v3_assert(NOT has_function_privilege('anon','public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)','EXECUTE'),'anonymous cannot mutate mode');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false);
SELECT public.floor_table_v3_assert(public.floor_get_table_control_mode_request_v1('00000000-0000-0000-0000-000000000770','00000000-0000-0000-0000-000000000670')->>'error'='actor_not_allowed','outsider cannot read requests');
