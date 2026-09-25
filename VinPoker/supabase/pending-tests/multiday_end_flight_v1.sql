-- Run after multiday_end_flight_baseline_v1.sql and forward migration.
-- All fixture rows are synthetic; no historical Chip Ops migration is replayed.
\set ON_ERROR_STOP on
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
INSERT INTO auth.users(id) VALUES('10000000-0000-0000-0000-000000000001');
INSERT INTO public.clubs VALUES('20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001');
INSERT INTO public.tournament_events VALUES('30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002');
INSERT INTO public.tournaments VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','flight',NULL),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','final',NULL),
 ('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',
  NULL,NULL,NULL);
INSERT INTO public.tournament_entries VALUES('50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1);
INSERT INTO public.table_sessions VALUES('70000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',9);
INSERT INTO public.tournament_tables VALUES('80000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001');
INSERT INTO public.dealers VALUES('e0000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002');
INSERT INTO public.dealer_attendance VALUES('f0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001');
INSERT INTO public.dealer_assignments VALUES('90000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001','assigned',NULL,0);
INSERT INTO public.tournament_seats VALUES('a0000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',1,'80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',3,true);
INSERT INTO public.tournament_chip_counts VALUES('b0000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
  1,100000,now());
DO $$ BEGIN
  IF (SELECT enabled FROM public.multi_day_package_release_v1) THEN
    RAISE EXCEPTION 'package_gate_not_default_off';
  END IF;
  BEGIN
    PERFORM public.multi_day_end_flight_v1('40000000-0000-0000-0000-000000000001',1,
      'c0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'gate_off_allowed_end_flight';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'multi_day_package_release_off' THEN RAISE; END IF;
  END;
END $$;
-- Test-only gate transition in disposable DB, never in release migration.
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY['20000000-0000-0000-0000-000000000001'::uuid];
DO $$ DECLARE v_receipt jsonb; BEGIN
  v_receipt:=public.multi_day_end_flight_v1('40000000-0000-0000-0000-000000000001',1,
    'c0000000-0000-0000-0000-000000000001');
  IF v_receipt->>'rosterCount'<>'1' OR v_receipt->>'status'<>'bagging'
     OR (SELECT tracked_stack FROM public.multi_day_flight_roster_v1)<>100000
     OR (SELECT table_session_revision FROM public.multi_day_flight_roster_v1)<>9
     OR (SELECT seat_number FROM public.multi_day_flight_roster_v1)<>3
     OR (SELECT dealer_user_id FROM public.multi_day_flight_roster_v1)
       IS DISTINCT FROM '10000000-0000-0000-0000-000000000002'::uuid
     OR (SELECT count(*) FROM public.day_close)<>1 THEN
    RAISE EXCEPTION 'end_flight_snapshot_wrong: %',v_receipt;
  END IF;
  v_receipt:=public.multi_day_end_flight_v1('40000000-0000-0000-0000-000000000001',1,
    'c0000000-0000-0000-0000-000000000001');
  IF v_receipt->>'idempotent'<>'true' THEN RAISE EXCEPTION 'retry_not_idempotent'; END IF;
  BEGIN
    PERFORM public.multi_day_end_flight_v1('40000000-0000-0000-0000-000000000001',1,
      'c0000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'different_request_allowed';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'multi_day_end_flight_request_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.tournament_hands VALUES('d0000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',1,'in_progress',1);
    RAISE EXCEPTION 'hand_after_end_allowed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'multi_day_end_play_source_frozen' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.tournament_chip_counts SET chip_count=1;
    RAISE EXCEPTION 'count_after_end_allowed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'multi_day_end_play_source_frozen' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.tournament_seats SET is_active=false;
    RAISE EXCEPTION 'seat_after_end_allowed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'multi_day_end_play_roster_frozen' THEN RAISE; END IF;
  END;
  IF (SELECT tracked_stack FROM public.multi_day_flight_roster_v1)<>100000 THEN
    RAISE EXCEPTION 'roster_mutated';
  END IF;
END $$;
INSERT INTO public.tournament_hands VALUES('d0000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000003',NULL,1,'in_progress',1);
SELECT 'multiday_end_flight_v1 PASS' AS result;
