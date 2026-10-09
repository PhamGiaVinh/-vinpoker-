-- Appended inside the existing exact-schema inventory fixture transaction.
RESET ROLE;
INSERT INTO public.club_settings(club_id,auto_swing_enabled)
  VALUES('e1700000-0000-4000-8000-000000000002',false)
  ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=false;
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
  VALUES('e1700000-0000-4000-8000-000000000022','e1700000-0000-4000-8000-000000000002',
    'e1700000-0000-4000-8000-000000000012','cash','manual',1,1,'e1700000-0000-4000-8000-000000000001');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
  ('e1700000-0000-4000-8000-000000000032','e1700000-0000-4000-8000-000000000002','OFF fence TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
  VALUES('e1700000-0000-4000-8000-000000000042','e1700000-0000-4000-8000-000000000032',
    'e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
SELECT set_config('request.headers','{}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE result jsonb; replay jsonb; due timestamptz:=now()+interval '30 minutes';
BEGIN
  BEGIN
    result:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',
      'e1700000-0000-4000-8000-000000000012','e1700000-0000-4000-8000-000000000022',
      'e1700000-0000-4000-8000-000000000042',due,'late-automatic-off');
    RAISE EXCEPTION 'test: actual worker acquired OFF';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AUTO_SWING_OFF' THEN RAISE; END IF; END;
  PERFORM set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000098"}',true);
  BEGIN
    result:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',
      'e1700000-0000-4000-8000-000000000012','e1700000-0000-4000-8000-000000000022',
      'e1700000-0000-4000-8000-000000000042',due,'outside-manual-off');
    RAISE EXCEPTION 'test: outside owner bypassed OFF';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEALER_MANUAL_ACQUISITION_FORBIDDEN' THEN RAISE; END IF; END;
  PERFORM set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);
  result:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',
    'e1700000-0000-4000-8000-000000000012','e1700000-0000-4000-8000-000000000022',
    'e1700000-0000-4000-8000-000000000042',due,'verified-manual-off');
  PERFORM pg_temp.assert_true(result->>'outcome'='ok','authorized manual OFF preserves exact-session assignment');
  PERFORM set_config('request.headers','{}',true);
  replay:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',
    'e1700000-0000-4000-8000-000000000012','e1700000-0000-4000-8000-000000000022',
    'e1700000-0000-4000-8000-000000000042',due,'verified-manual-off');
  PERFORM pg_temp.assert_true(replay=result,'committed receipt remains readable OFF without another acquisition');
END;
$test$;
RESET ROLE;
UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='e1700000-0000-4000-8000-000000000002';
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
  VALUES('e1700000-0000-4000-8000-000000000015','e1700000-0000-4000-8000-000000000002','AutoON TEST',15,'cash','inactive','available');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
  VALUES('e1700000-0000-4000-8000-000000000025','e1700000-0000-4000-8000-000000000002',
    'e1700000-0000-4000-8000-000000000015','cash','manual',1,1,'e1700000-0000-4000-8000-000000000001');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
  ('e1700000-0000-4000-8000-000000000033','e1700000-0000-4000-8000-000000000002','AutoON TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
  VALUES('e1700000-0000-4000-8000-000000000043','e1700000-0000-4000-8000-000000000033',
    'e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',
  'e1700000-0000-4000-8000-000000000015','e1700000-0000-4000-8000-000000000025',
  'e1700000-0000-4000-8000-000000000043',now()+interval '30 minutes','auto-on-exact-session')->>'outcome'='ok',
  'automatic ON preserves canonical real assignment and attendance writers');
RESET ROLE;
