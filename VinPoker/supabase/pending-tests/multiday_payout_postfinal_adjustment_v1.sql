-- Disposable PG17 exact-baseline test, following payout_snapshot_v1 fixture.
-- No live payment occurs; historical payment and finalization remain unchanged.
DO $$ DECLARE v_event uuid:='30000000-0000-0000-0000-00000000000a';
 v_part uuid; v_payment uuid; v_state jsonb; v_out jsonb; v_revision text;
 v_original jsonb; v_original_paid numeric;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 SELECT (x.value->>'participationId')::uuid INTO v_part
 FROM public.multi_day_payout_finalizations_v1 f,
 LATERAL jsonb_array_elements(f.obligations) x(value) WHERE f.event_id=v_event;
 SELECT id INTO v_payment FROM public.tournament_prize_payments
 WHERE tournament_id='40000000-0000-0000-0000-000000000020';
 SELECT obligations,paid_player_vnd INTO v_original,v_original_paid
 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=v_event;
 v_state:=public.multi_day_payout_postfinal_state_v1(v_event);
 v_revision:=v_state->>'revision';
 IF v_state->>'recordedOverlayVnd'<>'650000' OR
    v_state->>'unallocatedPoolVnd'<>'0' THEN
   RAISE EXCEPTION 'initial_accounting_wrong: %',v_state;
 END IF;
 UPDATE public.multi_day_package_release_v1 SET enabled=false;
 BEGIN
   PERFORM public.multi_day_request_payout_correction_v1(v_event,'OBLIGATION_DELTA',
     v_part,NULL,-50000,v_revision,'Correct player entitlement','review-evidence-001',
     'a0000000-0000-0000-0000-000000000101');
   RAISE EXCEPTION 'gate_off_accepted';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN
   PERFORM public.multi_day_request_payout_correction_v1(v_event,'OBLIGATION_DELTA',
     v_part,NULL,-50000,v_revision,'Correct player entitlement','review-evidence-001',
     'a0000000-0000-0000-0000-000000000101');
   RAISE EXCEPTION 'wrong_role_accepted';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_payout_owner_required' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_out:=public.multi_day_request_payout_correction_v1(v_event,'OBLIGATION_DELTA',
   v_part,NULL,-50000,v_revision,'Correct player entitlement','review-evidence-001',
   'a0000000-0000-0000-0000-000000000101');
 IF v_out->>'state'<>'PENDING_APPROVAL' OR v_out->>'idempotent'<>'false' OR
   (public.multi_day_request_payout_correction_v1(v_event,'OBLIGATION_DELTA',
   v_part,NULL,-50000,v_revision,'Correct player entitlement','review-evidence-001',
   'a0000000-0000-0000-0000-000000000101'))->>'idempotent'<>'true' THEN
   RAISE EXCEPTION 'request_retry_wrong';
 END IF;
 BEGIN
   PERFORM public.multi_day_request_payout_correction_v1(v_event,'OBLIGATION_DELTA',
     v_part,NULL,-49000,v_revision,'Correct player entitlement','review-evidence-001',
     'a0000000-0000-0000-0000-000000000101');
   RAISE EXCEPTION 'changed_request_accepted';
 EXCEPTION WHEN unique_violation THEN
   IF SQLERRM<>'multi_day_payout_request_conflict' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=false;
 BEGIN
   PERFORM public.multi_day_approve_payout_correction_v1(
     'a0000000-0000-0000-0000-000000000101',
     'a0000000-0000-0000-0000-000000000201');
   RAISE EXCEPTION 'approval_gate_off_accepted';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN
   PERFORM public.multi_day_approve_payout_correction_v1(
     'a0000000-0000-0000-0000-000000000101',
     'a0000000-0000-0000-0000-000000000201');
   RAISE EXCEPTION 'wrong_club_approval_accepted';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_payout_owner_required' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_out:=public.multi_day_approve_payout_correction_v1(
   'a0000000-0000-0000-0000-000000000101',
   'a0000000-0000-0000-0000-000000000201');
 IF v_out->>'unallocatedPoolVnd'<>'50000' OR
    v_out->>'unpaidObligationVnd'<>'1500000' OR
    (public.multi_day_approve_payout_correction_v1(
      'a0000000-0000-0000-0000-000000000101',
      'a0000000-0000-0000-0000-000000000201'))->>'idempotent'<>'true' THEN
   RAISE EXCEPTION 'obligation_delta_wrong: %',v_out;
 END IF;
 BEGIN
   PERFORM public.multi_day_approve_payout_correction_v1(
     'a0000000-0000-0000-0000-000000000101',
     'a0000000-0000-0000-0000-000000000202');
   RAISE EXCEPTION 'changed_approval_accepted';
 EXCEPTION WHEN unique_violation THEN
   IF SQLERRM<>'multi_day_payout_request_conflict' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_request_payout_correction_v1(v_event,'OBLIGATION_DELTA',
     v_part,NULL,100000,v_revision,'Try unfunded award increase','review-evidence-002',
     'a0000000-0000-0000-0000-000000000102');
   RAISE EXCEPTION 'stale_revision_accepted';
 EXCEPTION WHEN serialization_failure THEN
   IF SQLERRM<>'multi_day_payout_recalculate' THEN RAISE; END IF;
 END;
 v_state:=public.multi_day_payout_postfinal_state_v1(v_event);
 v_revision:=v_state->>'revision';
 PERFORM public.multi_day_request_payout_correction_v1(v_event,'OBLIGATION_DELTA',
   v_part,NULL,100000,v_revision,'Try unfunded award increase','review-evidence-002',
   'a0000000-0000-0000-0000-000000000103');
 BEGIN
   PERFORM public.multi_day_approve_payout_correction_v1(
     'a0000000-0000-0000-0000-000000000103',
     'a0000000-0000-0000-0000-000000000203');
   RAISE EXCEPTION 'unfunded_delta_approved';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_payout_correction_unreconciled' THEN RAISE; END IF;
 END;
 PERFORM public.multi_day_request_payout_correction_v1(v_event,'PAYMENT_REVERSAL',
   v_part,v_payment,-100000,v_revision,'Reverse erroneous paid marker',
   'payment-review-evidence-001','a0000000-0000-0000-0000-000000000104');
 v_out:=public.multi_day_approve_payout_correction_v1(
   'a0000000-0000-0000-0000-000000000104',
   'a0000000-0000-0000-0000-000000000204');
 IF v_out->>'paidPlayerVnd'<>'0' OR v_out->>'unpaidObligationVnd'<>'1600000' OR
    v_out->>'unallocatedPoolVnd'<>'50000' OR
    (SELECT prize_amount FROM public.tournament_prize_payments WHERE id=v_payment)<>100000 OR
    (SELECT obligations FROM public.multi_day_payout_finalizations_v1 WHERE event_id=v_event)<>v_original OR
    (SELECT paid_player_vnd FROM public.multi_day_payout_finalizations_v1 WHERE event_id=v_event)<>v_original_paid THEN
   RAISE EXCEPTION 'payment_reversal_or_original_mutated: %',v_out;
 END IF;
 IF (v_out->>'paidPlayerVnd')::numeric+
    (v_out->>'unpaidObligationVnd')::numeric+
    (v_out->>'unallocatedPoolVnd')::numeric+
    (public.multi_day_payout_postfinal_state_v1(v_event)->>'clubRetainedTieVnd')::numeric<>
    (public.multi_day_payout_postfinal_state_v1(v_event)->>'directPoolVnd')::numeric+
    (public.multi_day_payout_postfinal_state_v1(v_event)->>'transferPoolVnd')::numeric+
    (public.multi_day_payout_postfinal_state_v1(v_event)->>'recordedOverlayVnd')::numeric THEN
   RAISE EXCEPTION 'postfinal_conservation_failed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_corrections_v1
    WHERE event_id=v_event AND kind NOT IN('OBLIGATION_DELTA','PAYMENT_REVERSAL')) THEN
   RAISE EXCEPTION 'unexpected_funding_or_ticket_ledger';
 END IF;
 BEGIN
   UPDATE public.multi_day_payout_corrections_v1 SET delta_vnd=-1
   WHERE request_id='a0000000-0000-0000-0000-000000000104';
   RAISE EXCEPTION 'append_only_correction_updated';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_qualification_immutable' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.multi_day_payout_finalizations_v1 SET paid_player_vnd=0
   WHERE event_id=v_event;
   RAISE EXCEPTION 'original_finalization_updated';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_qualification_immutable' THEN RAISE; END IF;
 END;
 v_revision:=public.multi_day_payout_postfinal_state_v1(v_event)->>'revision';
 PERFORM public.multi_day_request_payout_correction_v1(v_event,'PAYMENT_REVERSAL',
   v_part,v_payment,-100000,v_revision,'Duplicate payment reversal attempt',
   'payment-review-evidence-002','a0000000-0000-0000-0000-000000000105');
 BEGIN
   PERFORM public.multi_day_approve_payout_correction_v1(
     'a0000000-0000-0000-0000-000000000105',
     'a0000000-0000-0000-0000-000000000205');
   RAISE EXCEPTION 'double_payment_reversal_accepted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM NOT IN ('multi_day_payout_payment_already_reversed',
      'multi_day_payout_correction_unreconciled') THEN RAISE; END IF;
 END;
END $$;
SELECT 'multiday_payout_postfinal_adjustment_v1 PASS' AS result;
