-- Disposable PG17, real Multi-day lifecycle RPCs and schema (Cashier receipt
-- rows are fixture evidence, not a claim of live payment integration).
-- Two valid entries per flight: ITM 50% => one paid place per flight;
-- Day2 100% => both sealed bags per flight. One player bags twice.
\set ON_ERROR_STOP on
DO $$ DECLARE
 v_base integer; v_policy text; v_event uuid; v_final uuid; v_flight uuid;
 v_player uuid; v_registration uuid; v_entry uuid; v_session uuid; v_table uuid;
 v_sid integer; v_player_no integer; v_flight_no integer; v_stack bigint;
 v_bags uuid[]; v_preview jsonb; v_out jsonb; v_payout jsonb;
 v_p1 uuid; v_p2 uuid; v_p3 uuid; v_min_count integer; v_min_total numeric;
 v_expected_unpaid numeric; v_expected_unallocated numeric;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 FOR v_base,v_policy IN SELECT * FROM (VALUES (110,'SELECT_LARGEST'),(120,'SUM_STACKS')) x(base,policy) LOOP
   v_event:=format('30000000-0000-0000-0000-%s',lpad(to_hex(v_base),12,'0'))::uuid;
   v_final:=format('40000000-0000-0000-0000-%s',lpad(to_hex(v_base),12,'0'))::uuid;
   v_p1:=format('60000000-0000-0000-0000-%s',lpad(to_hex(v_base+1),12,'0'))::uuid;
   v_p2:=format('60000000-0000-0000-0000-%s',lpad(to_hex(v_base+2),12,'0'))::uuid;
   v_p3:=format('60000000-0000-0000-0000-%s',lpad(to_hex(v_base+3),12,'0'))::uuid;
   INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
   VALUES(v_event,'20000000-0000-0000-0000-000000000001',v_final,50,1000000,100000);
   INSERT INTO public.tournaments(id,club_id,event_id,phase)
   VALUES(v_final,'20000000-0000-0000-0000-000000000001',v_event,'final');
   v_session:=format('70000000-0000-0000-0000-%s',lpad(to_hex(v_base),12,'0'))::uuid;
   v_table:=format('80000000-0000-0000-0000-%s',lpad(to_hex(v_base),12,'0'))::uuid;
   INSERT INTO public.table_sessions(id,tournament_id,revision,game_table_id)
   VALUES(v_session,v_final,0,format('e0000000-0000-0000-0000-%s',lpad(to_hex(v_base),12,'0'))::uuid);
   INSERT INTO public.tournament_tables(id,tournament_id,table_session_id,table_id,
     table_number,max_seats,status)
   VALUES(v_table,v_final,v_session,
     format('e0000000-0000-0000-0000-%s',lpad(to_hex(v_base),12,'0'))::uuid,1,9,'active');
   PERFORM public.multi_day_set_qualification_rules_v2(v_event,v_policy,1,100);
   INSERT INTO public.tournament_prizes(tournament_id,position,amount)
   VALUES(v_final,1,1000000),(v_final,2,1000000);
   FOR v_flight_no IN 1..2 LOOP
     v_sid:=v_base+v_flight_no;
     v_flight:=format('40000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid;
     v_session:=format('70000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid;
     v_table:=format('80000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid;
     INSERT INTO public.tournaments(id,club_id,event_id,phase)
     VALUES(v_flight,'20000000-0000-0000-0000-000000000001',v_event,'flight');
     INSERT INTO public.table_sessions(id,tournament_id,revision,game_table_id)
     VALUES(v_session,v_flight,2,
       format('e0000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid);
     INSERT INTO public.tournament_tables(id,tournament_id,table_session_id,table_id,
       table_number,max_seats,status)
     VALUES(v_table,v_flight,v_session,
       format('e0000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid,1,9,'active');
     INSERT INTO public.dealer_assignments(id,table_session_id,attendance_id,status,version)
     VALUES(format('90000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid,
       v_session,'f0000000-0000-0000-0000-000000000001','assigned',0);
     FOR v_player_no IN 1..2 LOOP
       v_player:=CASE WHEN v_player_no=1 THEN v_p1
         WHEN v_flight_no=1 THEN v_p2 ELSE v_p3 END;
       v_sid:=v_base*100+v_flight_no*10+v_player_no;
       v_registration:=format('b1000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid;
       v_entry:=format('d6000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid;
       v_stack:=CASE WHEN v_flight_no=2 AND v_player_no=1 THEN 200000 ELSE 100000 END;
       INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,
         buy_in,platform_fixed_fee,total_pay,status,confirmed_at,price_snapshot)
       VALUES(v_registration,v_flight,v_player,'20000000-0000-0000-0000-000000000001',
         1000000,0,1100000,'confirmed',now(),
         '{"buy_in":1000000,"rake":100000,"service_fee":0,"platform_fee":0,"total_pay":1100000,"tender":"cash"}'::jsonb);
       INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,
         registration_id,purpose,direction,amount,applied_amount)
       VALUES('20000000-0000-0000-0000-000000000001',v_flight,
         v_registration,'buyin','in',1100000,1100000);
       INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,
         entry_no,status,current_stack)
       VALUES(v_entry,v_flight,v_registration,v_player,1,'seated',v_stack);
       INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,
         entry_number,tournament_table_id,table_session_id,seat_number,is_active,
         table_id,chip_count,status)
       VALUES(format('da000000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid,
         v_flight,v_player,v_entry,1,v_table,v_session,v_player_no,true,
         v_table,v_stack,'active');
       INSERT INTO public.tournament_chip_counts(id,tournament_id,player_id,
         entry_number,chip_count)
       VALUES(format('db100000-0000-0000-0000-%s',lpad(to_hex(v_sid),12,'0'))::uuid,
         v_flight,v_player,1,v_stack);
     END LOOP;
     PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
     PERFORM public.multi_day_end_flight_v1(v_flight,v_flight_no,
       format('c0000000-0000-0000-0000-%s',lpad(to_hex(v_base*1000+v_flight_no*100+1),12,'0'))::uuid);
     PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
     FOR v_player_no IN 1..2 LOOP
       v_player:=CASE WHEN v_player_no=1 THEN v_p1
         WHEN v_flight_no=1 THEN v_p2 ELSE v_p3 END;
       v_stack:=CASE WHEN v_flight_no=2 AND v_player_no=1 THEN 200000 ELSE 100000 END;
       PERFORM public.multi_day_record_bag_v1(v_flight,v_player,
         format('GOLD-%s-%s-%s',v_base,v_flight_no,v_player_no),v_stack,0,
         format('c0000000-0000-0000-0000-%s',lpad(to_hex(v_base*1000+v_flight_no*100+10+v_player_no),12,'0'))::uuid);
     END LOOP;
     PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
     FOR v_player_no IN 1..2 LOOP
       v_player:=CASE WHEN v_player_no=1 THEN v_p1
         WHEN v_flight_no=1 THEN v_p2 ELSE v_p3 END;
       PERFORM public.multi_day_seal_bag_v1(v_flight,v_player,1,
         format('c0000000-0000-0000-0000-%s',lpad(to_hex(v_base*1000+v_flight_no*100+20+v_player_no),12,'0'))::uuid);
     END LOOP;
     PERFORM public.multi_day_close_bagging_v1(v_flight,0,
       format('c0000000-0000-0000-0000-%s',lpad(to_hex(v_base*1000+v_flight_no*100+30),12,'0'))::uuid);
     PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
   END LOOP;
   v_preview:=public.multi_day_qualification_preview_v1(v_event);
   IF v_preview->>'state'<>'READY' OR v_preview->>'itmPercent'<>'50' OR
      v_preview->>'day2Percent'<>'100' OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(v_preview->'flights') f
        WHERE f->>'validEntries'<>'2' OR f->>'itmTarget'<>'1' OR
          f->>'day2Target'<>'2') THEN
     RAISE EXCEPTION 'distinct_quota_not_ready: %',v_preview;
   END IF;
   SELECT array_agg(b.id ORDER BY b.id) INTO v_bags FROM public.chip_bag b
    JOIN public.tournaments t ON t.id=b.tournament_id WHERE t.event_id=v_event;
   IF cardinality(v_bags)<>4 THEN RAISE EXCEPTION 'golden_bag_count_wrong'; END IF;
   v_out:=public.multi_day_lock_qualification_v1(v_event,v_bags,
     v_preview->>'sourceHash',
     format('c0000000-0000-0000-0000-%s',lpad(to_hex(v_base*1000+40),12,'0'))::uuid);
   IF v_out->>'participationCount'<>'3' OR
      (SELECT count(*) FROM public.multi_day_final_participations_v1 WHERE event_id=v_event)<>3 THEN
     RAISE EXCEPTION 'day2_participation_count_wrong: %',v_out;
   END IF;
   SELECT count(*),coalesce(sum(m.amount_vnd),0) INTO v_min_count,v_min_total
    FROM public.multi_day_nonselected_min_cash_v1 m
    JOIN public.multi_day_final_participations_v1 p ON p.id=m.participation_id
    WHERE p.event_id=v_event;
   IF (v_policy='SELECT_LARGEST' AND (v_min_count<>1 OR v_min_total<>1100000)) OR
      (v_policy='SUM_STACKS' AND (v_min_count<>0 OR v_min_total<>0)) THEN
     RAISE EXCEPTION 'nonselected_min_cash_wrong: %, %, %',v_policy,v_min_count,v_min_total;
   END IF;
   v_table:=format('80000000-0000-0000-0000-%s',lpad(to_hex(v_base),12,'0'))::uuid;
   FOR v_player_no IN 1..3 LOOP
     v_player:=CASE v_player_no WHEN 1 THEN v_p1 WHEN 2 THEN v_p2 ELSE v_p3 END;
     PERFORM public.multi_day_seat_final_v1(v_event,v_player,v_table,v_player_no,0,
       format('c0000000-0000-0000-0000-%s',lpad(to_hex(v_base*1000+50+v_player_no),12,'0'))::uuid);
     UPDATE public.tournament_entries SET finished_place=v_player_no
       WHERE tournament_id=v_final AND player_id=v_player;
   END LOOP;
   v_payout:=public.multi_day_payout_preview_v1(v_event);
   v_expected_unpaid:=CASE WHEN v_policy='SELECT_LARGEST' THEN 3300000 ELSE 2200000 END;
   v_expected_unallocated:=4000000-v_expected_unpaid;
   IF v_payout->>'state'<>'READY' OR v_payout->>'itmPlaces'<>'2' OR
      (v_payout->>'directPoolVnd')::numeric<>4000000 OR
      (v_payout->>'feesVnd')::numeric<>400000 OR
      (v_payout->>'unpaidObligationVnd')::numeric<>v_expected_unpaid OR
      (v_payout->>'unallocatedPoolVnd')::numeric<>v_expected_unallocated OR
      (v_payout->'obligations'->2->>'totalVnd')::numeric<>0 OR
      (SELECT count(*) FROM jsonb_array_elements(v_payout->'obligations') o
        WHERE (o->>'participationFloorVnd')::numeric=1100000)<>2 OR
      (SELECT coalesce(sum((o->>'nonselectedBagMinCashVnd')::numeric),0)
        FROM jsonb_array_elements(v_payout->'obligations') o)<>v_min_total THEN
     RAISE EXCEPTION 'distinct_payout_obligations_wrong: %, %',v_policy,v_payout;
   END IF;
   v_out:=public.multi_day_finalize_payout_v1(v_event,
     v_payout->>'rulesVersion',v_payout->>'fundingRevision',
     v_payout->>'qualificationRevision',v_payout->>'payoutInputHash',
     format('93000000-0000-0000-0000-%s',lpad(to_hex(v_base*1000+60),12,'0'))::uuid);
   IF v_out->>'state'<>'FINALIZED_OBLIGATIONS' OR
      (SELECT paid_player_vnd+unpaid_obligation_vnd+club_retained_tie_vnd+
        unallocated_pool_vnd=direct_pool_vnd+transfer_pool_vnd+recorded_overlay_vnd
       FROM public.multi_day_payout_finalizations_v1 WHERE event_id=v_event) IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'distinct_payout_finalize_conservation_failed: %',v_out;
   END IF;
 END LOOP;
END $$;
SELECT 'multiday_distinct_itm_day2_golden_v1 PASS' AS result;
