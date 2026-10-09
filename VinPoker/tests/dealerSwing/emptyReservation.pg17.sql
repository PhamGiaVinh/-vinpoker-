RESET ROLE;
INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('e1700000-0000-4000-8000-000000000002',true)
ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=true;
SELECT set_config('request.headers','{}',true);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
VALUES('e2300000-0000-4000-8000-000000000010','e1700000-0000-4000-8000-000000000002','Reservation TEST',23,'cash','inactive','available');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
VALUES('e2300000-0000-4000-8000-000000000020','e1700000-0000-4000-8000-000000000002','e2300000-0000-4000-8000-000000000010','cash','manual',1,1,'e1700000-0000-4000-8000-000000000001');
INSERT INTO public.dealers(id,club_id,full_name,status)
VALUES('e2300000-0000-4000-8000-000000000030','e1700000-0000-4000-8000-000000000002','Reservation dealer TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state,last_released_at)
VALUES('e2300000-0000-4000-8000-000000000040','e2300000-0000-4000-8000-000000000030','e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'on_break',now()-interval '20 minutes');
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; replay jsonb; rid uuid; BEGIN
 result:=public.reserve_empty_table_for_dealer_v2('e2300000-0000-4000-8000-000000000010','e2300000-0000-4000-8000-000000000020','e2300000-0000-4000-8000-000000000040',now(),'e1700000-0000-4000-8000-000000000002');
 PERFORM pg_temp.assert_true(result->>'outcome'='ok','canonical open session works despite inactive physical marker');
 rid:=(result->>'reservation_id')::uuid;
 replay:=public.reserve_empty_table_for_dealer_v2('e2300000-0000-4000-8000-000000000010','e2300000-0000-4000-8000-000000000020','e2300000-0000-4000-8000-000000000040',now(),'e1700000-0000-4000-8000-000000000002');
 PERFORM pg_temp.assert_true(replay->>'reservation_id'=rid::text AND replay->>'outcome'='already_reserved','retry preserves one reservation');
 PERFORM pg_temp.assert_true(public.execute_empty_table_reservation_v2(rid,'e2300000-0000-4000-8000-000000000020',now()+interval '30 minutes')->>'outcome'='dealer_not_ready','resting dealer not pulled early');
 PERFORM pg_temp.assert_true(public.execute_empty_table_reservation_v2(rid,'e1700000-0000-4000-8000-000000000021',now())->>'outcome'='table_session_changed','wrong session cannot execute');
END $$;
RESET ROLE;
UPDATE public.dealer_attendance SET current_state='available',last_released_at=now()-interval '5 minutes' WHERE id='e2300000-0000-4000-8000-000000000040';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.execute_empty_table_reservation_v2((SELECT id FROM public.dealer_assignments WHERE table_id='e2300000-0000-4000-8000-000000000010' AND status='reserved'),'e2300000-0000-4000-8000-000000000020',now()+interval '30 minutes')->>'outcome'='dealer_rest_required','server rest floor cannot be bypassed');
RESET ROLE;
UPDATE public.dealer_attendance SET last_released_at=now()-interval '20 minutes' WHERE id='e2300000-0000-4000-8000-000000000040';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.execute_empty_table_reservation_v2((SELECT id FROM public.dealer_assignments WHERE table_id='e2300000-0000-4000-8000-000000000010' AND status='reserved'),'e2300000-0000-4000-8000-000000000020',now()+interval '30 minutes')->>'outcome'='ok','available rested dealer executes exact session');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_assignments WHERE table_id='e2300000-0000-4000-8000-000000000010' AND table_session_id='e2300000-0000-4000-8000-000000000020' AND status='assigned'),'one assignment in exact session');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.reserve_empty_table_for_dealer_v2(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'anonymous acquisition denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.execute_empty_table_reservation_v2(uuid,uuid,timestamptz)','EXECUTE'),'authenticated caller cannot forge service context');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','public.execute_empty_table_reservation(uuid,timestamptz)','EXECUTE'),'unfenced legacy acquisition retired');
