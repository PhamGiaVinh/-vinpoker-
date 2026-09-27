-- PG17 synthetic source fixture using the real new End Flight, bag edit,
-- seal and close RPCs. Legacy qualifier function is represented at its write
-- seam; this is not a full live Cashier/payout integration test.
\set ON_ERROR_STOP on
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
VALUES
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000008',100,1000000,100000),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-00000000000b',100,1000000,100000);
INSERT INTO public.tournaments(id,club_id,event_id,phase)
VALUES
 ('40000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','flight'),
 ('40000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','flight'),
 ('40000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','final'),
 ('40000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','flight'),
 ('40000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','flight'),
 ('40000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','final');
DO $$ BEGIN
 UPDATE public.multi_day_package_release_v1 SET enabled=false;
 BEGIN
   PERFORM public.multi_day_set_qualification_rules_v1(
     '30000000-0000-0000-0000-000000000002','SELECT_LARGEST',1.5);
   RAISE EXCEPTION 'qualification_rules_gate_off_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_rules_actor_or_gate_denied' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 PERFORM public.multi_day_set_qualification_rules_v1(
   '30000000-0000-0000-0000-000000000002','SELECT_LARGEST',1.5);
 PERFORM public.multi_day_set_qualification_rules_v1(
   '30000000-0000-0000-0000-000000000003','SUM_STACKS',1.5);
 BEGIN
   PERFORM public.multi_day_set_qualification_rules_v1(
     '30000000-0000-0000-0000-000000000002','SUM_STACKS',1.5);
   RAISE EXCEPTION 'late_policy_change_allowed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_rules_immutable' THEN RAISE; END IF;
 END;
END $$;

-- Two flights per event, the same player in both flights. This is the
-- distinction between largest-bag selection and sum-of-bags.
DO $$ DECLARE n integer; v_tid uuid; v_pid uuid; v_stack bigint; BEGIN
 FOR n IN 6..10 LOOP
   IF n=8 THEN CONTINUE; END IF;
   v_tid:=format('40000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid;
   v_pid:=CASE WHEN n IN(6,7) THEN '60000000-0000-0000-0000-000000000006'::uuid
     ELSE '60000000-0000-0000-0000-000000000009'::uuid END;
   v_stack:=CASE n WHEN 6 THEN 100000 WHEN 7 THEN 150000
     WHEN 9 THEN 200000 ELSE 300000 END;
   INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no)
     VALUES(format('50000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       v_tid,v_pid,1);
   INSERT INTO public.table_sessions(id,tournament_id,revision)
     VALUES(format('70000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       v_tid,2);
   INSERT INTO public.tournament_tables(id,tournament_id,table_session_id)
     VALUES(format('80000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       v_tid,format('70000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid);
   INSERT INTO public.dealer_assignments(id,table_session_id,attendance_id,status,version)
     VALUES(format('90000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       format('70000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       'f0000000-0000-0000-0000-000000000001','assigned',0);
   INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,
     entry_number,tournament_table_id,table_session_id,seat_number,is_active)
     VALUES(format('a0000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       v_tid,v_pid,format('50000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       1,format('80000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       format('70000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,1,true);
   INSERT INTO public.tournament_chip_counts(id,tournament_id,player_id,entry_number,chip_count)
     VALUES(format('b0000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid,
       v_tid,v_pid,1,v_stack);
 END LOOP;
END $$;

DO $$ DECLARE v_preview jsonb; BEGIN
 v_preview:=public.multi_day_qualification_preview_v1(
   '30000000-0000-0000-0000-000000000002');
 IF v_preview->>'state'<>'PLANNED' OR v_preview->>'flightCount'<>'2' THEN
   RAISE EXCEPTION 'planned_preview_wrong: %',v_preview;
 END IF;
 BEGIN
   PERFORM public.advance_flight_qualifiers(
     '40000000-0000-0000-0000-000000000006',
     ARRAY['60000000-0000-0000-0000-000000000006'::uuid]);
   RAISE EXCEPTION 'legacy_qualifier_bypassed_gate';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_legacy_qualifier_held' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_lock_qualification_v1(
     '30000000-0000-0000-0000-000000000002',
     ARRAY['00000000-0000-0000-0000-000000000001'::uuid],
     v_preview->>'sourceHash','c0000000-0000-0000-0000-000000000101');
   RAISE EXCEPTION 'lock_before_all_flights_closed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_qualification_not_ready' THEN RAISE; END IF;
 END;
END $$;

-- Positive source lifecycle uses only production-shaped public RPCs.
DO $$ DECLARE n integer; v_tid uuid; v_pid uuid; v_stack bigint;
 v_day integer; v_result jsonb; BEGIN
 FOR n IN 6..10 LOOP
   IF n=8 THEN CONTINUE; END IF;
   v_tid:=format('40000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid;
   v_pid:=CASE WHEN n IN(6,7) THEN '60000000-0000-0000-0000-000000000006'::uuid
     ELSE '60000000-0000-0000-0000-000000000009'::uuid END;
   v_stack:=CASE n WHEN 6 THEN 100000 WHEN 7 THEN 150000
     WHEN 9 THEN 200000 ELSE 300000 END;
   v_day:=CASE WHEN n IN(6,9) THEN 1 ELSE 2 END;
   PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
   v_result:=public.multi_day_end_flight_v1(v_tid,v_day,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(100+n*10+1),12,'0'))::uuid);
   PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
   v_result:=public.multi_day_record_bag_v1(v_tid,v_pid,format('Q-%s',n),v_stack,0,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(100+n*10+2),12,'0'))::uuid);
   PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
   v_result:=public.multi_day_seal_bag_v1(v_tid,v_pid,1,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(100+n*10+3),12,'0'))::uuid);
   v_result:=public.multi_day_close_bagging_v1(v_tid,0,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(100+n*10+4),12,'0'))::uuid);
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
END $$;

DO $$ DECLARE v_preview jsonb; v_receipt jsonb; v_bags uuid[]; v_hash text;
 v_selected uuid; BEGIN
 v_preview:=public.multi_day_qualification_preview_v1(
   '30000000-0000-0000-0000-000000000002');
 IF v_preview->>'state'<>'READY' OR v_preview->'flights'->0->>'day2Target'<>'1' THEN
   RAISE EXCEPTION 'locked_flight_preview_wrong: %',v_preview;
 END IF;
 v_hash:=v_preview->>'sourceHash';
 SELECT array_agg(id ORDER BY id) INTO v_bags FROM public.chip_bag
   WHERE tournament_id IN ('40000000-0000-0000-0000-000000000006'::uuid,
     '40000000-0000-0000-0000-000000000007'::uuid);
 BEGIN
   PERFORM public.multi_day_lock_qualification_v1(
     '30000000-0000-0000-0000-000000000002',v_bags,
     md5('stale'),'c0000000-0000-0000-0000-000000000201');
   RAISE EXCEPTION 'stale_hash_accepted';
 EXCEPTION WHEN serialization_failure THEN
   IF SQLERRM<>'multi_day_qualification_stale_source' THEN RAISE; END IF;
 END;
 v_receipt:=public.multi_day_lock_qualification_v1(
   '30000000-0000-0000-0000-000000000002',v_bags,v_hash,
   'c0000000-0000-0000-0000-000000000201');
 SELECT id INTO v_selected FROM public.chip_bag
   WHERE tournament_id='40000000-0000-0000-0000-000000000007';
 IF v_receipt->>'participationCount'<>'1'
    OR (SELECT carried_stack FROM public.multi_day_final_participations_v1
      WHERE event_id='30000000-0000-0000-0000-000000000002')<>150000
    OR (SELECT selected_bag_id FROM public.multi_day_final_participations_v1
      WHERE event_id='30000000-0000-0000-0000-000000000002')<>v_selected
    OR (SELECT count(*) FROM public.multi_day_nonselected_min_cash_v1)<>1
    OR (SELECT amount_vnd FROM public.multi_day_nonselected_min_cash_v1)<>1650000
    OR (SELECT participation_floor_vnd FROM public.multi_day_final_participations_v1
      WHERE event_id='30000000-0000-0000-0000-000000000002')<>1650000
    OR (SELECT count(*) FROM public.multi_day_final_participations_v1 p,
       pg_catalog.jsonb_array_elements(p.source_bags) b
       WHERE p.event_id='30000000-0000-0000-0000-000000000002'
         AND b->>'bagVersion'='2')<>2 THEN
   RAISE EXCEPTION 'select_largest_golden_wrong: %',v_receipt;
 END IF;
 v_receipt:=public.multi_day_lock_qualification_v1(
   '30000000-0000-0000-0000-000000000002',v_bags,v_hash,
   'c0000000-0000-0000-0000-000000000201');
 IF v_receipt->>'idempotent'<>'true' THEN RAISE EXCEPTION 'lock_retry_not_idempotent'; END IF;
 BEGIN
   PERFORM public.multi_day_lock_qualification_v1(
     '30000000-0000-0000-0000-000000000002',ARRAY[v_bags[1]],v_hash,
     'c0000000-0000-0000-0000-000000000201');
   RAISE EXCEPTION 'changed_payload_accepted';
 EXCEPTION WHEN unique_violation THEN
   IF SQLERRM<>'multi_day_lock_request_conflict' THEN RAISE; END IF;
 END;
 BEGIN
   INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no)
     VALUES('50000000-0000-0000-0000-000000000008',
       '40000000-0000-0000-0000-000000000008',
       '60000000-0000-0000-0000-000000000006',1);
   RAISE EXCEPTION 'legacy_final_entry_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_final_seating_held' THEN RAISE; END IF;
 END;
 BEGIN
   INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,
     seat_number,is_active)
   VALUES('a0000000-0000-0000-0000-000000000008',
     '40000000-0000-0000-0000-000000000008',
     '60000000-0000-0000-0000-000000000006',1,1,true);
   RAISE EXCEPTION 'legacy_final_seat_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_final_seating_held' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.chip_bag SET total_value=1,multi_day_revision=3,
      multi_day_sealed_version=3
     WHERE id=v_selected;
   RAISE EXCEPTION 'sealed_bag_version_mutated';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_bag_revision_or_seal_invalid' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.multi_day_final_participations_v1 SET carried_stack=1
     WHERE event_id='30000000-0000-0000-0000-000000000002';
   RAISE EXCEPTION 'participation_overwrite_allowed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_qualification_immutable' THEN RAISE; END IF;
 END;
END $$;

DO $$ DECLARE v_preview jsonb; v_bags uuid[]; v_receipt jsonb; BEGIN
 v_preview:=public.multi_day_qualification_preview_v1(
   '30000000-0000-0000-0000-000000000003');
 SELECT array_agg(id ORDER BY id) INTO v_bags FROM public.chip_bag
   WHERE tournament_id IN('40000000-0000-0000-0000-000000000009'::uuid,
     '40000000-0000-0000-0000-00000000000a'::uuid);
 v_receipt:=public.multi_day_lock_qualification_v1(
   '30000000-0000-0000-0000-000000000003',v_bags,
   v_preview->>'sourceHash','c0000000-0000-0000-0000-000000000202');
 IF (SELECT carried_stack FROM public.multi_day_final_participations_v1
       WHERE event_id='30000000-0000-0000-0000-000000000003')<>500000
    OR (SELECT selected_bag_id FROM public.multi_day_final_participations_v1
       WHERE event_id='30000000-0000-0000-0000-000000000003') IS NOT NULL
    OR (SELECT count(*) FROM public.multi_day_nonselected_min_cash_v1)<>1
    OR (SELECT count(*) FROM public.tournament_registrations)<>0 THEN
   RAISE EXCEPTION 'sum_stacks_golden_or_finance_wrong: %',v_receipt;
 END IF;
END $$;

-- Legacy unconfigured event remains on its old path with release OFF; a
-- package event remains held even after the flag is turned OFF again.
UPDATE public.multi_day_package_release_v1 SET enabled=false;
DO $$ BEGIN
 BEGIN
  PERFORM public.advance_flight_qualifiers(
    '40000000-0000-0000-0000-000000000006',
    ARRAY['60000000-0000-0000-0000-000000000006'::uuid]);
  RAISE EXCEPTION 'package_legacy_bypass_after_gate_off';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'multi_day_legacy_qualifier_held' THEN RAISE; END IF;
 END;
END $$;
SELECT 'multiday_qualification_v1 PASS' AS result;

INSERT INTO public.tournament_events(id,club_id,final_tournament_id)
 VALUES('30000000-0000-0000-0000-000000000006',
 '20000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-000000000013');
INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
 ('40000000-0000-0000-0000-000000000012',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000006','flight'),
 ('40000000-0000-0000-0000-000000000013',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000006','final');
SELECT public.advance_flight_qualifiers(
 '40000000-0000-0000-0000-000000000012',
 ARRAY['60000000-0000-0000-0000-000000000012'::uuid]);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.tournament_event_qualifiers
     WHERE event_id='30000000-0000-0000-0000-000000000006')<>1 THEN
   RAISE EXCEPTION 'legacy_gate_off_regression';
 END IF;
 BEGIN
   INSERT INTO public.tournament_event_qualifiers(event_id,flight_tournament_id,
      final_tournament_id,club_id,player_id,carried_stack)
   VALUES('30000000-0000-0000-0000-000000000006',
      '40000000-0000-0000-0000-000000000006',
      '40000000-0000-0000-0000-000000000013',
      '20000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000006',1);
   RAISE EXCEPTION 'mismatched_event_qualifier_bypass';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_legacy_qualifier_held' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.tournament_event_qualifiers
     SET flight_tournament_id='40000000-0000-0000-0000-000000000006'
     WHERE event_id='30000000-0000-0000-0000-000000000006';
   RAISE EXCEPTION 'legacy_qualifier_repoint_bypass';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_legacy_qualifier_held' THEN RAISE; END IF;
 END;
END $$;

-- Planned Day2 quota is ceiling(valid source entries * ITM%), per flight;
-- cancelled attempts do not count. This event has no locked bag and cannot
-- qualify, but its planned quota must be visible without inventing chips.
UPDATE public.multi_day_package_release_v1 SET enabled=true;
INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent)
 VALUES('30000000-0000-0000-0000-000000000007',
 '20000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-000000000015',50);
INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
 ('40000000-0000-0000-0000-000000000014',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000007','flight'),
 ('40000000-0000-0000-0000-000000000015',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000007','final');
SELECT public.multi_day_set_qualification_rules_v1(
 '30000000-0000-0000-0000-000000000007','SUM_STACKS',1.5);
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status)
SELECT format('50000000-0000-0000-0000-%s',lpad(to_hex(n+32),12,'0'))::uuid,
 '40000000-0000-0000-0000-000000000014'::uuid,
 format('60000000-0000-0000-0000-%s',lpad(to_hex(n+32),12,'0'))::uuid,
 1,CASE WHEN n=4 THEN 'cancelled' ELSE 'seated' END
FROM generate_series(1,4) n;
DO $$ DECLARE v_preview jsonb; BEGIN
 v_preview:=public.multi_day_qualification_preview_v1(
   '30000000-0000-0000-0000-000000000007');
 IF v_preview->>'state'<>'PLANNED'
   OR v_preview->'flights'->0->>'validEntries'<>'3'
   OR v_preview->'flights'->0->>'day2Target'<>'2' THEN
   RAISE EXCEPTION 'day2_ceil_planned_wrong: %',v_preview;
 END IF;
END $$;

-- Dedicated ready events for the two commit-order race directions.
DO $$ DECLARE n integer; v_event uuid; v_flight uuid; v_final uuid;
 v_player uuid; v_result jsonb; v_stack bigint:=90000; BEGIN
 FOR n IN 4..5 LOOP
   v_event:=format('30000000-0000-0000-0000-%s',lpad(to_hex(n),12,'0'))::uuid;
   v_flight:=format('40000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid;
   v_final:=format('40000000-0000-0000-0000-%s',lpad(to_hex(2*n+5),12,'0'))::uuid;
   v_player:=format('60000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid;
   INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
    VALUES(v_event,'20000000-0000-0000-0000-000000000001',v_final,100,1000000,100000);
   INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
     (v_flight,'20000000-0000-0000-0000-000000000001',v_event,'flight'),
     (v_final,'20000000-0000-0000-0000-000000000001',v_event,'final');
   PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
   PERFORM public.multi_day_set_qualification_rules_v1(v_event,'SUM_STACKS',1.5);
   INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no)
    VALUES(format('50000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,
      v_flight,v_player,1);
   INSERT INTO public.table_sessions(id,tournament_id,revision)
    VALUES(format('70000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,v_flight,2);
   INSERT INTO public.tournament_tables(id,tournament_id,table_session_id)
    VALUES(format('80000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,v_flight,
      format('70000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid);
   INSERT INTO public.dealer_assignments(id,table_session_id,attendance_id,status,version)
    VALUES(format('90000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,
      format('70000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,
      'f0000000-0000-0000-0000-000000000001','assigned',0);
   INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,
      entry_number,tournament_table_id,table_session_id,seat_number,is_active)
    VALUES(format('a0000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,
      v_flight,v_player,format('50000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,
      1,format('80000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,
      format('70000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,1,true);
   INSERT INTO public.tournament_chip_counts(id,tournament_id,player_id,entry_number,chip_count)
    VALUES(format('b0000000-0000-0000-0000-%s',lpad(to_hex(2*n+4),12,'0'))::uuid,
      v_flight,v_player,1,v_stack);
   v_result:=public.multi_day_end_flight_v1(v_flight,1,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(300+n*10+1),12,'0'))::uuid);
   PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
   v_result:=public.multi_day_record_bag_v1(v_flight,v_player,format('R-%s',n),v_stack,0,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(300+n*10+2),12,'0'))::uuid);
   PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
   v_result:=public.multi_day_seal_bag_v1(v_flight,v_player,1,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(300+n*10+3),12,'0'))::uuid);
   v_result:=public.multi_day_close_bagging_v1(v_flight,0,
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(300+n*10+4),12,'0'))::uuid);
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
END $$;
UPDATE public.multi_day_package_release_v1 SET enabled=false;
DO $$ DECLARE v_preview jsonb; v_bag uuid; BEGIN
 v_preview:=public.multi_day_qualification_preview_v1(
   '30000000-0000-0000-0000-000000000004');
 SELECT b.id INTO v_bag FROM public.chip_bag b
   WHERE b.tournament_id='40000000-0000-0000-0000-00000000000c';
 BEGIN
   PERFORM public.multi_day_lock_qualification_v1(
     '30000000-0000-0000-0000-000000000004',ARRAY[v_bag],
     v_preview->>'sourceHash','c0000000-0000-0000-0000-000000000400');
   RAISE EXCEPTION 'gate_off_qualification_lock_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
END $$;
UPDATE public.multi_day_package_release_v1 SET enabled=true;
CREATE TABLE public.multi_day_qualification_race_fixture_v1(
 event_id uuid PRIMARY KEY, source_hash text NOT NULL,bag_id uuid NOT NULL);
INSERT INTO public.multi_day_qualification_race_fixture_v1
SELECT e.id,public.multi_day_qualification_preview_v1(e.id)->>'sourceHash',b.id
FROM public.tournament_events e JOIN public.tournaments t ON t.event_id=e.id
  AND t.phase='flight' JOIN public.chip_bag b ON b.tournament_id=t.id
WHERE e.id IN('30000000-0000-0000-0000-000000000004'::uuid,
 '30000000-0000-0000-0000-000000000005'::uuid);
