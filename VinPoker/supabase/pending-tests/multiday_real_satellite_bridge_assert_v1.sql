-- Disposable cross-package test. Redeem and reversal RPCs are the real #1344
-- functions; only Multi-day qualification/final seats are synthetic fixtures.
BEGIN;
SELECT set_config('request.jwt.claim.sub',
 'd1000000-0000-4000-8000-000000000011',true);
DO $$ DECLARE v_event uuid:='e3000000-0000-4000-8000-000000000011';
 v_ticket uuid; v_before jsonb; v_after jsonb; v_out jsonb;
BEGIN
 v_before:=public.multi_day_payout_preview_v1(v_event);
 IF v_before->>'state'<>'READY' OR
    (v_before->>'transferPoolVnd')::numeric<>12000000 OR
    (v_before->>'feesVnd')::numeric<>1200000 OR
    (v_before->>'unpaidObligationVnd')::numeric<>12000000 THEN
   RAISE EXCEPTION 'real_redeem_transfer_not_reconciled: %',v_before;
 END IF;
 SELECT id INTO v_ticket FROM public.satellite_tickets
   WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
     AND serial_no=2;
 v_out:=public.satellite_request_redemption_correction_v1(v_ticket,
   'Disposable Multi-day reversal proof',
   'd9000000-0000-4000-8000-000000000091');
 IF v_out->>'status'<>'held' THEN
   RAISE EXCEPTION 'real_correction_request_failed: %',v_out; END IF;
 v_out:=public.satellite_approve_redemption_reversal_v1(v_ticket,
   'd9000000-0000-4000-8000-000000000091',
   'Disposable approval before target play',
   'd9000000-0000-4000-8000-000000000092');
 IF v_out->>'ok'<>'true' THEN
   RAISE EXCEPTION 'real_reversal_failed: %',v_out; END IF;
 v_after:=public.multi_day_payout_preview_v1(v_event);
 IF v_after->>'state'<>'REQUIRED_SHORTFALL' OR
    (v_after->>'transferPoolVnd')::numeric<>6000000 OR
    (v_after->>'requiredShortfallVnd')::numeric<>6000000 OR
    v_after->>'fundingRevision'=v_before->>'fundingRevision' THEN
   RAISE EXCEPTION 'real_reversal_did_not_reduce_funding: %',v_after;
 END IF;
 BEGIN
   PERFORM public.multi_day_finalize_payout_v1(v_event,
     v_before->>'rulesVersion',v_before->>'fundingRevision',
     v_before->>'qualificationRevision',v_before->>'payoutInputHash',
     'e9000000-0000-4000-8000-000000000091');
   RAISE EXCEPTION 'stale_real_transfer_finalized';
 EXCEPTION WHEN serialization_failure THEN
   IF SQLERRM<>'multi_day_payout_recalculate' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claim.sub',
 'd1000000-0000-4000-8000-000000000011',true);
DO $$ DECLARE v_event uuid:='e3000000-0000-4000-8000-000000000011';
 v_preview jsonb; v_out jsonb;
BEGIN
 v_preview:=public.multi_day_payout_preview_v1(v_event);
 v_out:=public.multi_day_finalize_payout_v1(v_event,
   v_preview->>'rulesVersion',v_preview->>'fundingRevision',
   v_preview->>'qualificationRevision',v_preview->>'payoutInputHash',
   'e9000000-0000-4000-8000-000000000092');
 IF v_out->>'state'<>'FINALIZED_OBLIGATIONS' OR
   (SELECT transfer_pool_vnd FROM public.multi_day_payout_finalizations_v1
     WHERE event_id=v_event)<>12000000 OR
   (SELECT fee_vnd FROM public.multi_day_payout_finalizations_v1
     WHERE event_id=v_event)<>1200000 THEN
   RAISE EXCEPTION 'real_redeem_finalize_mismatch: %',v_out;
 END IF;
END $$;
COMMIT;
SELECT 'multiday_real_satellite_bridge_assert_v1 PASS' AS result;
