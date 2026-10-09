RESET ROLE;
INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('e1700000-0000-4000-8000-000000000002',true)
ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=true;
UPDATE public.dealer_assignments SET status='completed',released_at=now()-interval '5 minutes',release_reason='rest_history_TEST'
WHERE attendance_id='e1700000-0000-4000-8000-000000000041';
UPDATE public.dealer_attendance SET current_state='available',last_released_at=now()-interval '60 minutes'
WHERE id='e1700000-0000-4000-8000-000000000041';
SELECT set_config('request.headers','{}',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',now()+interval '30 minutes','rest-history-short-key');
    RAISE EXCEPTION 'TEST_AUTO_SHORT_REST_WAS_NOT_BLOCKED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'DEALER_REST_REQUIRED' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.dealer_assignments(table_id,table_session_id,attendance_id,dealer_id,club_id,status,assigned_at)
    VALUES('e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041','e1700000-0000-4000-8000-000000000031','e1700000-0000-4000-8000-000000000002','assigned',now());
    RAISE EXCEPTION 'TEST_DIRECT_SHORT_REST_WAS_NOT_BLOCKED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'DEALER_REST_REQUIRED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND released_at IS NULL),'failed commit left no assignment');
UPDATE public.dealer_attendance SET current_state='on_break',last_released_at=NULL WHERE id='e1700000-0000-4000-8000-000000000041';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.reserve_empty_table_for_dealer_v2('e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',now()+interval '20 minutes','e1700000-0000-4000-8000-000000000002')->>'outcome'='ok','planning reservation does not pull resting dealer');
RESET ROLE;
UPDATE public.dealer_attendance SET current_state='available' WHERE id='e1700000-0000-4000-8000-000000000041';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.execute_empty_table_reservation_v2((SELECT id FROM public.dealer_assignments WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND status='reserved' AND released_at IS NULL),'e1700000-0000-4000-8000-000000000021',now()+interval '30 minutes');
    RAISE EXCEPTION 'TEST_RESERVATION_SHORT_REST_WAS_NOT_BLOCKED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'DEALER_REST_REQUIRED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
UPDATE public.dealer_assignments SET status='swing_skipped',released_at=now() WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND status='reserved';
SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',now()+interval '30 minutes','rest-history-manual-key')->>'outcome'='ok','authorized manual intent retains existing behavior');
RESET ROLE;
UPDATE public.dealer_assignments SET status='completed',released_at=now()-interval '20 minutes' WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND status='assigned';
UPDATE public.dealer_assignments SET released_at=now()-interval '20 minutes' WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND status='completed';
UPDATE public.dealer_attendance SET current_state='available',last_released_at=NULL WHERE id='e1700000-0000-4000-8000-000000000041';
SELECT set_config('request.headers','{}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; due timestamptz:=now()+interval '30 minutes'; BEGIN
  r:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',due,'rest-history-rested-key');
  PERFORM pg_temp.assert_true(r->>'outcome'='ok','15-minute floor uses actual release even with NULL marker');
  PERFORM pg_temp.assert_true(public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002','e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041',due,'rest-history-rested-key')=r,'receipt replay does not acquire twice');
END $$;
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','floor_private.guard_dealer_automatic_rest_history()','EXECUTE'),'internal trigger not a callable API');
