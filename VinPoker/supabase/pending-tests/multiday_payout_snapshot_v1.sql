-- Disposable PG17 contract fixture. Real package RPCs are used for flight
-- closure, qualification, seating, overlay, preview and finalize. Satellite
-- #1344 tables are interface fixtures, not its full Redeem runtime.
DO $$ DECLARE v_event uuid:='30000000-0000-0000-0000-00000000000a';
 v_flight uuid:='40000000-0000-0000-0000-000000000021';
 v_final uuid:='40000000-0000-0000-0000-000000000020';
 v_player uuid:='60000000-0000-0000-0000-000000000021';
 v_bag uuid; v_preview jsonb; v_out jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
 VALUES(v_event,'20000000-0000-0000-0000-000000000001',v_final,100,1000000,100000);
 INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
 (v_flight,'20000000-0000-0000-0000-000000000001',v_event,'flight'),
 (v_final,'20000000-0000-0000-0000-000000000001',v_event,'final');
 -- Historical paid amount fixture; production must match recipient_ref to
 -- the qualified player. It is counted once, then remaining is unpaid.
 INSERT INTO public.tournament_prize_payments(tournament_id,recipient_ref,
   status,prize_amount)
 VALUES(v_final,v_player,'paid',100000);
 PERFORM public.multi_day_set_qualification_rules_v1(v_event,'SUM_STACKS',1.5);
 INSERT INTO public.tournament_prizes(tournament_id,position,amount)
 VALUES(v_final,1,1000000);
 INSERT INTO public.tournament_prizes(id,tournament_id,position,amount)
 VALUES('a1000000-0000-0000-0000-000000000021',v_final,1,1000000);
 BEGIN
   PERFORM private.multi_day_payout_validate_positions_v1(v_final);
   RAISE EXCEPTION 'duplicate_configured_position_accepted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_payout_positions_invalid' THEN RAISE; END IF;
 END;
 DELETE FROM public.tournament_prizes
   WHERE id='a1000000-0000-0000-0000-000000000021';
 INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,
   buy_in,platform_fixed_fee,total_pay,status,confirmed_at,price_snapshot)
 VALUES('b0000000-0000-0000-0000-000000000021',v_flight,v_player,
   '20000000-0000-0000-0000-000000000001',1000000,0,1100000,
   'confirmed',now(),'{"buy_in":1000000,"rake":100000,"service_fee":0,"platform_fee":0,"total_pay":1100000,"tender":"cash"}'::jsonb);
 INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,
   registration_id,purpose,direction,amount,applied_amount)
 VALUES('20000000-0000-0000-0000-000000000001',v_flight,
   'b0000000-0000-0000-0000-000000000021','buyin','in',1100000,1100000);
 INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,
    status,current_stack)
 VALUES('d5000000-0000-0000-0000-000000000021',v_flight,
   'b0000000-0000-0000-0000-000000000021',v_player,1,'seated',100000);
 INSERT INTO public.table_sessions(id,tournament_id,revision,game_table_id)
 VALUES('70000000-0000-0000-0000-000000000021',v_flight,2,
   'e0000000-0000-0000-0000-000000000021'),
 ('70000000-0000-0000-0000-000000000020',v_final,0,
   'e0000000-0000-0000-0000-000000000020');
 INSERT INTO public.tournament_tables(id,tournament_id,table_session_id,table_id,
   table_number,max_seats,status) VALUES
 ('80000000-0000-0000-0000-000000000021',v_flight,
  '70000000-0000-0000-0000-000000000021',
  'e0000000-0000-0000-0000-000000000021',1,9,'active'),
 ('80000000-0000-0000-0000-000000000020',v_final,
  '70000000-0000-0000-0000-000000000020',
  'e0000000-0000-0000-0000-000000000020',1,9,'active');
 INSERT INTO public.dealer_assignments(id,table_session_id,attendance_id,status,version)
 VALUES('90000000-0000-0000-0000-000000000021',
   '70000000-0000-0000-0000-000000000021',
   'f0000000-0000-0000-0000-000000000001','assigned',0);
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,
   entry_number,tournament_table_id,table_session_id,seat_number,is_active,
   table_id,chip_count,status)
 VALUES('da000000-0000-0000-0000-000000000021',v_flight,v_player,
  'd5000000-0000-0000-0000-000000000021',1,
  '80000000-0000-0000-0000-000000000021',
  '70000000-0000-0000-0000-000000000021',1,true,
  '80000000-0000-0000-0000-000000000021',100000,'active');
 INSERT INTO public.tournament_chip_counts(id,tournament_id,player_id,entry_number,chip_count)
 VALUES('db100000-0000-0000-0000-000000000021',v_flight,v_player,1,100000);
 PERFORM public.multi_day_end_flight_v1(v_flight,1,
   'c0000000-0000-0000-0000-000000000a11');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 PERFORM public.multi_day_record_bag_v1(v_flight,v_player,'PAYOUT-21',100000,0,
   'c0000000-0000-0000-0000-000000000a12');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
 PERFORM public.multi_day_seal_bag_v1(v_flight,v_player,1,
   'c0000000-0000-0000-0000-000000000a13');
 PERFORM public.multi_day_close_bagging_v1(v_flight,0,
   'c0000000-0000-0000-0000-000000000a14');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_preview:=public.multi_day_qualification_preview_v1(v_event);
 SELECT id INTO v_bag FROM public.chip_bag WHERE tournament_id=v_flight;
 PERFORM public.multi_day_lock_qualification_v1(v_event,ARRAY[v_bag],
   v_preview->>'sourceHash','c0000000-0000-0000-0000-000000000a15');
 PERFORM public.multi_day_seat_final_v1(v_event,v_player,
  '80000000-0000-0000-0000-000000000020',1,0,
  'c0000000-0000-0000-0000-000000000a16');
 UPDATE public.tournament_entries SET finished_place=1
 WHERE tournament_id=v_final AND player_id=v_player;
 v_preview:=public.multi_day_payout_preview_v1(v_event);
 IF v_preview->>'state'<>'REQUIRED_SHORTFALL' OR
    v_preview->>'recordedOverlayVnd'<>'0' OR
    (v_preview->>'requiredShortfallVnd')::numeric<>650000 OR
    v_preview->>'directPoolVnd'<>'1000000' OR
    v_preview->>'feesVnd'<>'100000' OR
    (v_preview->>'paidPlayerVnd')::numeric<>100000 OR
    (v_preview->>'unpaidObligationVnd')::numeric<>1550000 THEN
   RAISE EXCEPTION 'payout_required_not_recorded: %',v_preview;
 END IF;
 BEGIN
   PERFORM public.multi_day_finalize_payout_v1(v_event,
     v_preview->>'rulesVersion',v_preview->>'fundingRevision',
     v_preview->>'qualificationRevision',v_preview->>'payoutInputHash',
     '93000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'unfunded_payout_finalized';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_payout_shortfall_unfunded' THEN RAISE; END IF;
 END;
 INSERT INTO public.bank_transactions(id,provider,api_verified_at,transfer_type,
   amount,status,account_number,club_id) VALUES
 ('ba000000-0000-0000-0000-000000000021','sepay',now(),'in',650000,
   'unmatched','proof-account-1','20000000-0000-0000-0000-000000000001');
 PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',650000,
   'bank-evidence-payout-21','Owner received GTD overlay',NULL,NULL,
   '92000000-0000-0000-0000-000000000021',
   'ba000000-0000-0000-0000-000000000021');
 BEGIN
   PERFORM public.multi_day_finalize_payout_v1(v_event,
     v_preview->>'rulesVersion',v_preview->>'fundingRevision',
     v_preview->>'qualificationRevision',v_preview->>'payoutInputHash',
     '93000000-0000-0000-0000-000000000002');
   RAISE EXCEPTION 'stale_payout_finalized';
 EXCEPTION WHEN serialization_failure THEN
   IF SQLERRM<>'multi_day_payout_recalculate' THEN RAISE; END IF;
 END;
 v_preview:=public.multi_day_payout_preview_v1(v_event);
 IF v_preview->>'state'<>'READY' OR
    (v_preview->>'recordedOverlayVnd')::numeric<>650000 OR
    (v_preview->>'requiredShortfallVnd')::numeric<>0 OR
    (v_preview->>'unallocatedPoolVnd')::numeric<>0 THEN
   RAISE EXCEPTION 'recorded_overlay_not_reconciled: %',v_preview;
 END IF;
 v_out:=public.multi_day_finalize_payout_v1(v_event,
   v_preview->>'rulesVersion',v_preview->>'fundingRevision',
   v_preview->>'qualificationRevision',v_preview->>'payoutInputHash',
   '93000000-0000-0000-0000-000000000003');
 IF v_out->>'state'<>'FINALIZED_OBLIGATIONS' OR
    (SELECT direct_pool_vnd+transfer_pool_vnd+recorded_overlay_vnd
       FROM public.multi_day_payout_finalizations_v1 WHERE event_id=v_event)<>
    (SELECT paid_player_vnd+unpaid_obligation_vnd+club_retained_tie_vnd+
       unallocated_pool_vnd FROM public.multi_day_payout_finalizations_v1
       WHERE event_id=v_event) THEN
   RAISE EXCEPTION 'payout_conservation_failed: %',v_out;
 END IF;
 IF (public.multi_day_finalize_payout_v1(v_event,
   v_preview->>'rulesVersion',v_preview->>'fundingRevision',
   v_preview->>'qualificationRevision',v_preview->>'payoutInputHash',
   '93000000-0000-0000-0000-000000000003'))->>'idempotent'<>'true' THEN
   RAISE EXCEPTION 'payout_retry_failed';
 END IF;
 INSERT INTO public.bank_transactions(id,provider,api_verified_at,transfer_type,
   amount,status,account_number,club_id) VALUES
 ('ba000000-0000-0000-0000-000000000022','sepay',now(),'in',1,
   'unmatched','proof-account-1','20000000-0000-0000-0000-000000000001');
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',1,
     'bank-evidence-after-final','Late overlay must adjust',NULL,NULL,
     '92000000-0000-0000-0000-000000000022',
     'ba000000-0000-0000-0000-000000000022');
   RAISE EXCEPTION 'post_finalize_overlay_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_payout_linked_adjustment_required' THEN RAISE; END IF;
 END;
 v_out:=public.multi_day_request_payout_adjustment_v1(v_event,'FUNDING',1,
   'bank-evidence-post-final','Late receipt needs linked adjustment',
   '94000000-0000-0000-0000-000000000021');
 IF v_out->>'state'<>'OWNER_APPROVED_HELD' OR
    v_out->>'snapshotChanged'<>'false' OR
    (SELECT recorded_overlay_vnd FROM public.multi_day_payout_finalizations_v1
      WHERE event_id=v_event)<>650000 THEN
   RAISE EXCEPTION 'post_final_adjustment_mutated_snapshot: %',v_out;
 END IF;
 IF (public.multi_day_request_payout_adjustment_v1(v_event,'FUNDING',1,
   'bank-evidence-post-final','Late receipt needs linked adjustment',
   '94000000-0000-0000-0000-000000000021'))->>'idempotent'<>'true' THEN
   RAISE EXCEPTION 'post_final_adjustment_retry_failed';
 END IF;
END $$;
SELECT 'multiday_payout_snapshot_v1 PASS' AS result;
