-- Contract fixture for #1344 ticket transfer fields, with real Multi-day
-- lifecycle RPCs. It does not run the Satellite Redeem implementation.
DO $$ DECLARE v_event uuid:='30000000-0000-0000-0000-00000000000b';
 v_flight uuid:='40000000-0000-0000-0000-000000000031';
 v_final uuid:='40000000-0000-0000-0000-000000000030';
 v_p1 uuid:='60000000-0000-0000-0000-000000000031';
 v_p2 uuid:='60000000-0000-0000-0000-000000000032';
 v_bags uuid[]; v_preview jsonb; v_split jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 BEGIN
   PERFORM public.multi_day_payout_preview_v1(
     '30000000-0000-0000-0000-00000000000c');
   RAISE EXCEPTION 'historical_cross_flight_movement_counted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_payout_source_unmatched' THEN RAISE; END IF;
 END;
 INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
 VALUES(v_event,'20000000-0000-0000-0000-000000000001',v_final,100,1000000,100000);
 INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
 (v_flight,'20000000-0000-0000-0000-000000000001',v_event,'flight'),
 (v_final,'20000000-0000-0000-0000-000000000001',v_event,'final');
 -- Distinct rank positions; tied player results are not duplicate positions.
 PERFORM public.multi_day_set_qualification_rules_v1(v_event,'SUM_STACKS',0);
 INSERT INTO public.tournament_prizes(tournament_id,position,amount)
 VALUES(v_final,1,1000001),(v_final,2,0);
 INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,
   buy_in,platform_fixed_fee,total_pay,status,confirmed_at,price_snapshot) VALUES
 ('b0000000-0000-0000-0000-000000000031',v_flight,v_p1,
  '20000000-0000-0000-0000-000000000001',1000000,0,1100000,'confirmed',now(),
  '{"buy_in":1000000,"rake":100000,"service_fee":0,"platform_fee":0,"total_pay":1100000,"tender":"cash"}'::jsonb),
 ('b0000000-0000-0000-0000-000000000032',v_flight,v_p2,
  '20000000-0000-0000-0000-000000000001',1000000,0,1100000,'confirmed',now(),
  '{"buy_in":1000000,"rake":100000,"service_fee":0,"platform_fee":0,"total_pay":1100000,"tender":"satellite_ticket"}'::jsonb);
 INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,
   registration_id,purpose,direction,amount,applied_amount)
 VALUES('20000000-0000-0000-0000-000000000001',v_flight,
   'b0000000-0000-0000-0000-000000000031','buyin','in',1100000,1100000);
 INSERT INTO public.satellite_tickets(id,status)
 VALUES('c1000000-0000-0000-0000-000000000032','redeemed');
 INSERT INTO public.satellite_ticket_value_transfers(id,ticket_id,
   source_tournament_id,target_tournament_id,registration_id,club_id,
   source_debit_vnd,target_credit_vnd,target_buy_in_vnd,target_rake_vnd,
   target_service_fee_vnd)
 VALUES('c2000000-0000-0000-0000-000000000032',
  'c1000000-0000-0000-0000-000000000032',
  '40000000-0000-0000-0000-000000000001',v_flight,
  'b0000000-0000-0000-0000-000000000032',
  '20000000-0000-0000-0000-000000000001',1100000,1100000,1000000,100000,0);
 INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,
   entry_no,status,current_stack) VALUES
 ('d5000000-0000-0000-0000-000000000031',v_flight,
  'b0000000-0000-0000-0000-000000000031',v_p1,1,'seated',100000),
 ('d5000000-0000-0000-0000-000000000032',v_flight,
  'b0000000-0000-0000-0000-000000000032',v_p2,1,'seated',100000);
 INSERT INTO public.table_sessions(id,tournament_id,revision,game_table_id) VALUES
 ('70000000-0000-0000-0000-000000000031',v_flight,2,
  'e0000000-0000-0000-0000-000000000031'),
 ('70000000-0000-0000-0000-000000000030',v_final,0,
  'e0000000-0000-0000-0000-000000000030');
 INSERT INTO public.tournament_tables(id,tournament_id,table_session_id,table_id,
   table_number,max_seats,status) VALUES
 ('80000000-0000-0000-0000-000000000031',v_flight,
  '70000000-0000-0000-0000-000000000031',
  'e0000000-0000-0000-0000-000000000031',1,9,'active'),
 ('80000000-0000-0000-0000-000000000030',v_final,
  '70000000-0000-0000-0000-000000000030',
  'e0000000-0000-0000-0000-000000000030',1,9,'active');
 INSERT INTO public.dealer_assignments(id,table_session_id,attendance_id,status,version)
 VALUES('90000000-0000-0000-0000-000000000031',
  '70000000-0000-0000-0000-000000000031',
  'f0000000-0000-0000-0000-000000000001','assigned',0);
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,
   entry_number,tournament_table_id,table_session_id,seat_number,is_active,
   table_id,chip_count,status) VALUES
 ('da000000-0000-0000-0000-000000000031',v_flight,v_p1,
  'd5000000-0000-0000-0000-000000000031',1,
  '80000000-0000-0000-0000-000000000031',
  '70000000-0000-0000-0000-000000000031',1,true,
  '80000000-0000-0000-0000-000000000031',100000,'active'),
 ('da000000-0000-0000-0000-000000000032',v_flight,v_p2,
  'd5000000-0000-0000-0000-000000000032',1,
  '80000000-0000-0000-0000-000000000031',
  '70000000-0000-0000-0000-000000000031',2,true,
  '80000000-0000-0000-0000-000000000031',100000,'active');
 INSERT INTO public.tournament_chip_counts(id,tournament_id,player_id,entry_number,chip_count)
 VALUES('db100000-0000-0000-0000-000000000031',v_flight,v_p1,1,100000),
 ('db100000-0000-0000-0000-000000000032',v_flight,v_p2,1,100000);
 PERFORM public.multi_day_end_flight_v1(v_flight,1,
   'c0000000-0000-0000-0000-000000000b11');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 PERFORM public.multi_day_record_bag_v1(v_flight,v_p1,'TIE-31',100000,0,
   'c0000000-0000-0000-0000-000000000b12');
 PERFORM public.multi_day_record_bag_v1(v_flight,v_p2,'TIE-32',100000,0,
   'c0000000-0000-0000-0000-000000000b13');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
 PERFORM public.multi_day_seal_bag_v1(v_flight,v_p1,1,
   'c0000000-0000-0000-0000-000000000b14');
 PERFORM public.multi_day_seal_bag_v1(v_flight,v_p2,1,
   'c0000000-0000-0000-0000-000000000b15');
 PERFORM public.multi_day_close_bagging_v1(v_flight,0,
   'c0000000-0000-0000-0000-000000000b16');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_preview:=public.multi_day_qualification_preview_v1(v_event);
 SELECT array_agg(id ORDER BY id) INTO v_bags FROM public.chip_bag WHERE tournament_id=v_flight;
 PERFORM public.multi_day_lock_qualification_v1(v_event,v_bags,
   v_preview->>'sourceHash','c0000000-0000-0000-0000-000000000b17');
 PERFORM public.multi_day_seat_final_v1(v_event,v_p1,
  '80000000-0000-0000-0000-000000000030',1,0,
  'c0000000-0000-0000-0000-000000000b18');
 PERFORM public.multi_day_seat_final_v1(v_event,v_p2,
  '80000000-0000-0000-0000-000000000030',2,0,
  'c0000000-0000-0000-0000-000000000b19');
 UPDATE public.tournament_entries SET finished_place=1
 WHERE tournament_id=v_final AND player_id IN(v_p1,v_p2);
 v_preview:=public.multi_day_payout_preview_v1(v_event);
 IF v_preview->>'state'<>'READY' OR
    (v_preview->>'directPoolVnd')::numeric<>1000000 OR
    (v_preview->>'transferPoolVnd')::numeric<>1000000 OR
    (v_preview->>'feesVnd')::numeric<>200000 OR
    (v_preview->>'clubRetainedTieVnd')::numeric<>1 OR
    v_preview->'tieBatches'->0->'occupiedRankAmountsVnd'<>'[1000001, 0]'::jsonb OR
    (v_preview->'tieBatches'->0->>'clubRetainedRemainderVnd')::numeric<>1 OR
    (v_preview->>'unpaidObligationVnd')::numeric<>1000000 OR
    (v_preview->>'unallocatedPoolVnd')::numeric<>999999 THEN
   RAISE EXCEPTION 'transfer_or_tie_reconciliation_failed: %',v_preview;
 END IF;
 v_split:=public.multi_day_equal_tie_entitlement_v1(ARRAY[1000000,1000000]::bigint[],2);
 IF v_split->>'occupiedRankTotalVnd'<>'2000000' OR
    v_split->>'perPlayerVnd'<>'1000000' THEN
   RAISE EXCEPTION '47_to_45_equal_value_rank_rows_collapsed'; END IF;
 -- A confirmed legacy row with no canonical receipt is not pool funding.
 UPDATE public.tournament_registrations SET price_snapshot=NULL
   WHERE id='b0000000-0000-0000-0000-000000000031';
 BEGIN
   PERFORM public.multi_day_payout_preview_v1(v_event);
   RAISE EXCEPTION 'legacy_confirmed_unfunded_counted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_payout_legacy_funding_unverified' THEN RAISE; END IF;
 END;
 UPDATE public.tournament_registrations
   SET price_snapshot='{"buy_in":1000000,"rake":100000,"service_fee":0,"platform_fee":0,"total_pay":1100000,"tender":"cash"}'::jsonb
   WHERE id='b0000000-0000-0000-0000-000000000031';
 -- A wrong flight on a pre-existing movement must not be hidden by COALESCE.
 BEGIN
   INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,
     registration_id,purpose,direction,amount,applied_amount)
   VALUES('20000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-000000000001',
     'b0000000-0000-0000-0000-000000000031','buyin','in',1,1);
   RAISE EXCEPTION 'cross_flight_movement_inserted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_movement_source_mismatch' THEN RAISE; END IF;
 END;
 BEGIN
   INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,
     registration_id,purpose,direction,amount,applied_amount)
   VALUES('20000000-0000-0000-0000-000000000002',v_flight,
     'b0000000-0000-0000-0000-000000000031','buyin','in',1,1);
   RAISE EXCEPTION 'cross_club_movement_inserted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_movement_source_mismatch' THEN RAISE; END IF;
 END;
 -- Orphan Cashier source rows are NOT zero-valued source contributions.
 BEGIN
   INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,purpose,direction,
     amount,applied_amount)
   VALUES('20000000-0000-0000-0000-000000000001',v_flight,'buyin','in',1,1);
   PERFORM public.multi_day_payout_preview_v1(v_event);
   RAISE EXCEPTION 'orphan_cashier_movement_accepted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_payout_source_unmatched' THEN RAISE; END IF;
 END;
 -- A reversed voucher cannot still fund the same target.
 BEGIN
   INSERT INTO public.satellite_redemption_reversals(request_id,original_transfer_id,
     target_tournament_id,registration_id,target_debit_vnd)
   VALUES(gen_random_uuid(),'c2000000-0000-0000-0000-000000000032',v_flight,
      'b0000000-0000-0000-0000-000000000032',1100000);
   PERFORM public.multi_day_payout_preview_v1(v_event);
   RAISE EXCEPTION 'reversed_ticket_counted_as_funding';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_payout_ticket_unreconciled' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN
   PERFORM public.multi_day_finalize_payout_v1(v_event,
     v_preview->>'rulesVersion',v_preview->>'fundingRevision',
     v_preview->>'qualificationRevision',v_preview->>'payoutInputHash',
     '93000000-0000-0000-0000-000000000031');
   RAISE EXCEPTION 'wrong_club_owner_finalized';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_payout_owner_required' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 UPDATE public.multi_day_package_release_v1 SET enabled=false;
 BEGIN
   PERFORM public.multi_day_finalize_payout_v1(v_event,
     v_preview->>'rulesVersion',v_preview->>'fundingRevision',
     v_preview->>'qualificationRevision',v_preview->>'payoutInputHash',
     '93000000-0000-0000-0000-000000000032');
   RAISE EXCEPTION 'gate_off_finalized';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
END $$;
CREATE TABLE public.multi_day_payout_race_fixture_v1(
 event_id uuid PRIMARY KEY,rules_version text,funding_revision text,
 qualification_revision text,payout_input_hash text);
INSERT INTO public.multi_day_payout_race_fixture_v1
SELECT '30000000-0000-0000-0000-00000000000b'::uuid,
 p->>'rulesVersion',p->>'fundingRevision',p->>'qualificationRevision',
 p->>'payoutInputHash'
FROM public.multi_day_payout_preview_v1(
 '30000000-0000-0000-0000-00000000000b') p;
SELECT 'multiday_payout_transfer_tie_v1 PASS' AS result;
