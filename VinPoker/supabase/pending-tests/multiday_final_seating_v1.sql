-- Disposable exact-column fixture, not live Floor/Cashier E2E. Positive path
-- keeps all package guards enabled; only test release-row changes exercise OFF.
DO $$
DECLARE v_event uuid:='30000000-0000-0000-0000-000000000002';
 v_player uuid:='60000000-0000-0000-0000-000000000006';
 v_table uuid:='80000000-0000-0000-0000-000000000008';
 v_req uuid:='91000000-0000-0000-0000-000000000001';
 v_result jsonb; v_entry uuid; v_seat uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 -- Gate OFF is server-enforced for a qualified source.
 UPDATE public.multi_day_package_release_v1 SET enabled=false;
 BEGIN
   PERFORM public.multi_day_seat_final_v1(v_event,v_player,v_table,1,0,v_req);
   RAISE EXCEPTION 'expected_gate_off';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 v_result:=public.multi_day_seat_final_v1(v_event,v_player,v_table,1,0,v_req);
 IF v_result->>'state'<>'SEATED' OR (v_result->>'seedStack')::bigint<>150000 OR
    v_result->>'newBuyInVnd'<>'0' OR v_result->>'denominationIssuance'<>'NONE' THEN
   RAISE EXCEPTION 'final_seat_bad_receipt: %',v_result;
 END IF;
 v_entry:=(v_result->>'entryId')::uuid; v_seat:=(v_result->>'seatId')::uuid;
 IF (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='40000000-0000-0000-0000-000000000008'
       AND player_id=v_player)<>1 OR
    (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='40000000-0000-0000-0000-000000000008'
       AND player_id=v_player)<>1 OR
    (SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id=v_entry)<>1 OR
    (SELECT count(*) FROM public.seat_assignment_history WHERE entry_id=v_entry)<>1 OR
    (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='40000000-0000-0000-0000-000000000008')<>0 THEN
   RAISE EXCEPTION 'final_seat_duplicate_or_cash';
 END IF;
 IF NOT (SELECT (public.multi_day_seat_final_v1(v_event,v_player,v_table,1,0,v_req))->>'idempotent'='true') THEN
   RAISE EXCEPTION 'final_seat_retry_failed';
 END IF;
 BEGIN
   PERFORM public.multi_day_seat_final_v1(v_event,v_player,v_table,2,0,v_req);
   RAISE EXCEPTION 'expected_changed_payload_conflict';
 EXCEPTION WHEN unique_violation THEN
   IF SQLERRM<>'multi_day_final_request_conflict' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_seat_final_v1(v_event,v_player,v_table,2,0,gen_random_uuid());
   RAISE EXCEPTION 'expected_second_seat_denied';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_final_player_already_seated' THEN RAISE; END IF;
 END;
 -- Direct service-role/RLS-style writes have no private one-use intent.
 BEGIN
   INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,source,status,
     current_stack,seat_id,table_id,seat_number)
   VALUES(gen_random_uuid(),'40000000-0000-0000-0000-000000000008',gen_random_uuid(),
     1,'staff','seated',1,gen_random_uuid(),'e0000000-0000-0000-0000-000000000008',3);
   RAISE EXCEPTION 'expected_legacy_entry_denied';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_final_write_not_authorized' THEN RAISE; END IF;
 END;
 BEGIN
   INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,entry_number,
     table_id,tournament_table_id,table_session_id,seat_number,chip_count,is_active,status)
   VALUES(gen_random_uuid(),'40000000-0000-0000-0000-000000000008',v_player,
     v_entry,1,v_table,v_table,'70000000-0000-0000-0000-000000000008',2,1,true,'active');
   RAISE EXCEPTION 'expected_legacy_seat_denied';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_final_write_not_authorized' THEN RAISE; END IF;
 END;
 -- Normal gameplay state update is permitted, identity changes are not.
 UPDATE public.tournament_entries SET current_stack=140000 WHERE id=v_entry;
 UPDATE public.tournament_seats SET chip_count=140000 WHERE id=v_seat;
 BEGIN
   UPDATE public.tournament_entries SET player_id=gen_random_uuid() WHERE id=v_entry;
   RAISE EXCEPTION 'expected_identity_immutable';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_final_identity_immutable' THEN RAISE; END IF;
 END;
 INSERT INTO public.tournament_hands(id,tournament_id,table_session_id,hand_number,status)
 VALUES(gen_random_uuid(),'40000000-0000-0000-0000-000000000008',
   '70000000-0000-0000-0000-000000000008',1,'completed');
 v_result:=public.multi_day_correct_final_seed_v1(v_event,v_player,160000,0,
   'Verified discrepancy after play','count-photo-001',
   '91000000-0000-0000-0000-000000000002');
 IF v_result->>'state'<>'OWNER_APPROVED_HELD' OR v_result->>'liveStackChanged'<>'false'
    OR (SELECT current_stack FROM public.tournament_entries WHERE id=v_entry)<>140000
    OR (SELECT chip_count FROM public.tournament_seats WHERE id=v_seat)<>140000
    OR (SELECT count(*) FROM public.multi_day_final_adjustments_v1
       WHERE participation_id=(SELECT participation_id FROM public.multi_day_final_seatings_v1
         WHERE entry_id=v_entry))<>1 THEN
   RAISE EXCEPTION 'post_use_adjustment_not_held: %',v_result;
 END IF;
 IF NOT (SELECT (public.multi_day_correct_final_seed_v1(v_event,v_player,160000,0,
    'Verified discrepancy after play','count-photo-001',
    '91000000-0000-0000-0000-000000000002'))->>'idempotent'='true') THEN
   RAISE EXCEPTION 'adjustment_retry_failed';
 END IF;
END $$;

DO $$
DECLARE v_event uuid:='30000000-0000-0000-0000-000000000003';
 v_player uuid:='60000000-0000-0000-0000-000000000009';
 v_table uuid:='80000000-0000-0000-0000-00000000000b';
 v_result jsonb;
BEGIN
 INSERT INTO public.clubs(id,owner_id) VALUES('20000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000002');
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN
   PERFORM public.multi_day_seat_final_v1(v_event,v_player,v_table,1,0,gen_random_uuid());
   RAISE EXCEPTION 'expected_wrong_role_denied';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_final_seat_actor_denied' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_correct_final_seed_v1(v_event,v_player,510000,0,
    'Verified count correction','count-photo-002',gen_random_uuid());
   RAISE EXCEPTION 'expected_wrong_owner_denied';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_final_correction_owner_required' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_result:=public.multi_day_correct_final_seed_v1(v_event,v_player,510000,0,
    'Verified count correction','count-photo-002',
    '91000000-0000-0000-0000-000000000003');
 IF v_result->>'state'<>'REVISED_PRE_SEAT' OR v_result->>'seedRevision'<>'1' THEN
   RAISE EXCEPTION 'preseat_revision_failed: %',v_result;
 END IF;
 BEGIN
   PERFORM public.multi_day_seat_final_v1(v_event,v_player,v_table,1,0,gen_random_uuid());
   RAISE EXCEPTION 'expected_stale_revision';
 EXCEPTION WHEN serialization_failure THEN
   IF SQLERRM<>'multi_day_final_seed_stale' THEN RAISE; END IF;
 END;
 v_result:=public.multi_day_seat_final_v1(v_event,v_player,v_table,1,1,
   '91000000-0000-0000-0000-000000000004');
 IF v_result->>'seedStack'<>'510000' OR v_result->>'seedRevision'<>'1' THEN
   RAISE EXCEPTION 'revised_seat_failed: %',v_result;
 END IF;
END $$;

SELECT 'multi_day_final_seating_v1 PASS' AS result;
