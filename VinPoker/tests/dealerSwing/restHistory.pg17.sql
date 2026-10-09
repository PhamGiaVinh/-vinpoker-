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
    INSERT INTO public.dealer_assignments(table_id,table_session_id,attendance_id,dealer_id,club_id,status,assigned_at)
    VALUES('e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021','e1700000-0000-4000-8000-000000000041','e1700000-0000-4000-8000-000000000039','e1700000-0000-4000-8000-000000000002','assigned',now());
    RAISE EXCEPTION 'TEST_WRONG_DEALER_WAS_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'DEALER_REST_ATTENDANCE_UNVERIFIED' THEN RAISE; END IF;
  END;
END $$;
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
DO $$ DECLARE a uuid; stamp timestamptz; BEGIN
  SELECT id,rest_history_work_started_at INTO a,stamp FROM public.dealer_assignments
  WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND status='completed' LIMIT 1;
  UPDATE public.dealer_assignments SET rest_history_work_started_at=now()-interval '10 years',
    release_reason='rest_history_verified_break_cleanup_v1' WHERE id=a;
  PERFORM pg_temp.assert_true((SELECT rest_history_work_started_at IS NOT DISTINCT FROM stamp
    AND release_reason IS DISTINCT FROM 'rest_history_verified_break_cleanup_v1'
    FROM public.dealer_assignments WHERE id=a),'metadata cannot forge server proof clock or cleanup marker');
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    UPDATE public.dealer_assignments SET status='assigned',released_at=NULL
    WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND status='completed';
    RAISE EXCEPTION 'TEST_RELEASED_ASSIGNMENT_REUSED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'DEALER_REST_RELEASED_ASSIGNMENT_REUSE' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
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
-- Actual canonical Swing must clean a genuinely rested orphan break without
-- restarting the rest clock at housekeeping time; NULL denormalized dealer is valid.
INSERT INTO public.dealers(id,club_id,full_name,status)
VALUES('e1700000-0000-4000-8000-000000000051','e1700000-0000-4000-8000-000000000002','Rested incoming TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state,last_released_at)
VALUES('e1700000-0000-4000-8000-000000000061','e1700000-0000-4000-8000-000000000051','e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now()-interval '2 hours','available',NULL);
-- Privileged historical fixture only: seed the immutable generation that a
-- real acquisition stamped 60 minutes earlier. All guards are enabled for RPC.
ALTER TABLE public.dealer_assignments DISABLE TRIGGER guard_dealer_automatic_rest_history_v1;
INSERT INTO public.dealer_assignments(id,table_id,attendance_id,dealer_id,club_id,status,assigned_at,updated_at,rest_history_work_started_at)
VALUES('e1700000-0000-4000-8000-000000000071','e1700000-0000-4000-8000-000000000012','e1700000-0000-4000-8000-000000000061',NULL,'e1700000-0000-4000-8000-000000000002','on_break',now()-interval '60 minutes',now()-interval '19 minutes 59 seconds',now()-interval '60 minutes');
ALTER TABLE public.dealer_assignments ENABLE TRIGGER guard_dealer_automatic_rest_history_v1;
INSERT INTO public.dealer_breaks(assignment_id,break_start,break_end,expected_duration_minutes,reason)
VALUES('e1700000-0000-4000-8000-000000000071',now()-interval '20 minutes',now()-interval '5 minutes',15,'auto_break_on_swing');
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; a uuid; v integer; BEGIN
  SELECT id,version INTO a,v FROM public.dealer_assignments
  WHERE attendance_id='e1700000-0000-4000-8000-000000000041' AND status='assigned' AND released_at IS NULL;
  r:=public.worker_perform_swing('e1700000-0000-4000-8000-000000000011','e1700000-0000-4000-8000-000000000021',a,30,true,15,60,v,'e1700000-0000-4000-8000-000000000061',0);
  PERFORM pg_temp.assert_true(r->>'outcome'='ok','canonical Swing accepts actually rested stale on_break cleanup');
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT release_reason='rest_history_verified_break_cleanup_v1' FROM public.dealer_assignments WHERE id='e1700000-0000-4000-8000-000000000071'),'housekeeping receives explicit lifecycle proof marker');
