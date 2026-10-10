\set ON_ERROR_STOP on
-- Actual >default-limit workload, fixture-only inserts and transaction rollback.
BEGIN;
INSERT INTO public.clubs(id,owner_id) VALUES('00000000-0000-0000-0000-000000999010','00000000-0000-0000-0000-000000000001');
INSERT INTO public.tournaments(id,club_id,name,status) VALUES('00000000-0000-0000-0000-000000999131','00000000-0000-0000-0000-000000999010','Retry fairness TEST','active');
INSERT INTO public.game_tables(id,club_id,table_name,table_number,operational_status)
SELECT ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000999010','Retry fairness TEST '||i,i,'available' FROM generate_series(1,51) i;
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,control_mode,revision,opened_by)
SELECT ('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000999010',('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'tournament','00000000-0000-0000-0000-000000999131','manual',1,'00000000-0000-0000-0000-000000000001' FROM generate_series(1,51) i;
INSERT INTO public.tournament_tables(id,tournament_id,game_table_id,table_session_id,table_number,max_seats,status)
SELECT ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000999131',('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,i,9,'active' FROM generate_series(1,51) i;
INSERT INTO public.tracker_voice_configs(tournament_table_id,table_session_id,correction_state)
SELECT ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'correction_pending' FROM generate_series(1,50) i;
INSERT INTO floor_private.table_mode_requests_v1(table_session_id,tournament_table_id,actor_id,target_mode,initial_epoch)
SELECT s.id,t.id,'00000000-0000-0000-0000-000000000001','tracker',s.control_epoch
FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id
WHERE s.id BETWEEN '20000000-0000-0000-0000-000000000001' AND '20000000-0000-0000-0000-000000000051';
\if :{?SEED_MODE_FAIRNESS_ONLY}
COMMIT;
\else
SELECT floor_private.resolve_pending_table_modes_v1(50);
SELECT floor_private.resolve_pending_table_modes_v1(50);
SELECT public.floor_table_v3_assert((SELECT control_mode='tracker' FROM public.table_sessions WHERE id='20000000-0000-0000-0000-000000000051'),'ready request beyond 50 blocked requests must resolve within two ticks');
SELECT public.floor_table_v3_assert((SELECT count(*)=50 FROM floor_private.table_mode_requests_v1 WHERE status='pending' AND table_session_id BETWEEN '20000000-0000-0000-0000-000000000001' AND '20000000-0000-0000-0000-000000000050'),'blocked requests retained without bypass');
ROLLBACK;
\endif
