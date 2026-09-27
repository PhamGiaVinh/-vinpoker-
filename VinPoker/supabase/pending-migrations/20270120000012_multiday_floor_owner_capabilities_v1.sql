-- SOURCE ONLY. The server projects owner-only payout authorities; the client
-- never infers them from profile, role names, or package release state.
-- ROLLBACK: replace this read RPC in a forward migration; do not alter ledger.
CREATE OR REPLACE FUNCTION public.multi_day_floor_read_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_read jsonb; v_day2 numeric; v_owner boolean;
BEGIN
 v_read:=private.multi_day_floor_shared_read_v1(p_event_id);
 SELECT r.day2_percent INTO v_day2 FROM public.multi_day_qualification_rules_v1 r
 WHERE r.event_id=p_event_id;
 SELECT EXISTS(SELECT 1 FROM public.clubs c
   WHERE c.id=(v_read->>'clubId')::uuid AND c.owner_id=auth.uid()) INTO v_owner;
 IF v_day2 IS NOT NULL THEN
   v_read:=pg_catalog.jsonb_set(v_read,'{rules,day2Percent}',pg_catalog.to_jsonb(v_day2));
 END IF;
 RETURN v_read||pg_catalog.jsonb_build_object('capabilities',
   pg_catalog.jsonb_build_object('canFinalizePayout',v_owner,
     'canRequestAdjustment',v_owner,'canApproveAdjustment',v_owner));
END $$;

-- TD/Floor may inspect the finalized accounting revision; linked correction
-- request and approval RPCs keep their independent owner-only checks.
CREATE OR REPLACE FUNCTION public.multi_day_payout_postfinal_state_v1(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_final public.multi_day_payout_finalizations_v1%ROWTYPE;
 v_revision text; v_rows jsonb; v_paid numeric; v_unpaid numeric;
 v_unallocated numeric; v_correction jsonb;
BEGIN
 SELECT * INTO v_final FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 IF NOT FOUND OR v_actor IS NULL OR NOT (EXISTS(SELECT 1 FROM public.clubs c
     WHERE c.id=v_final.club_id AND c.owner_id=v_actor)
     OR public.is_club_floor(v_actor,v_final.club_id)) THEN
   RAISE EXCEPTION 'multi_day_payout_read_actor_denied' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',c.id,'requestId',c.request_id,'kind',c.kind,
   'participationId',c.participation_id,'originalPaymentId',c.original_payment_id,
   'deltaVnd',c.delta_vnd,'previousRevision',c.previous_revision)
   ORDER BY c.approval_seq),'[]'::jsonb)
 INTO v_correction FROM public.multi_day_payout_corrections_v1 c
 WHERE c.event_id=p_event_id;
 SELECT c.resulting_revision INTO v_revision
 FROM public.multi_day_payout_corrections_v1 c WHERE c.event_id=p_event_id
 ORDER BY c.approval_seq DESC LIMIT 1;
 IF v_revision IS NULL THEN
   v_revision:=pg_catalog.md5(pg_catalog.jsonb_build_object(
     'finalization',v_final.payout_input_hash)::text);
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'playerId',o.value->>'playerId','participationId',o.value->>'participationId',
   'originalTotalVnd',(o.value->>'totalVnd')::numeric::bigint,
   'originalPaidVnd',(o.value->>'paidVnd')::numeric::bigint,
   'obligationDeltaVnd',coalesce(d.obligation_delta,0)::bigint,
   'paymentReversedVnd',coalesce(d.payment_reversed,0)::bigint,
   'currentTotalVnd',((o.value->>'totalVnd')::numeric+coalesce(d.obligation_delta,0))::bigint,
   'currentPaidVnd',((o.value->>'paidVnd')::numeric-coalesce(d.payment_reversed,0))::bigint,
   'currentUnpaidVnd',((o.value->>'unpaidVnd')::numeric+
      coalesce(d.obligation_delta,0)+coalesce(d.payment_reversed,0))::bigint)
   ORDER BY o.value->>'participationId'),'[]'::jsonb),
   coalesce(sum((o.value->>'paidVnd')::numeric-coalesce(d.payment_reversed,0)),0),
   coalesce(sum((o.value->>'unpaidVnd')::numeric+coalesce(d.obligation_delta,0)+
      coalesce(d.payment_reversed,0)),0)
 INTO v_rows,v_paid,v_unpaid
 FROM pg_catalog.jsonb_array_elements(v_final.obligations) o(value)
 LEFT JOIN LATERAL (SELECT
   sum(CASE WHEN c.kind='OBLIGATION_DELTA' THEN c.delta_vnd ELSE 0 END) obligation_delta,
   sum(CASE WHEN c.kind='PAYMENT_REVERSAL' THEN -c.delta_vnd ELSE 0 END) payment_reversed
   FROM public.multi_day_payout_corrections_v1 c
   WHERE c.event_id=p_event_id AND c.participation_id=(o.value->>'participationId')::uuid) d ON true;
 v_unallocated:=v_final.direct_pool_vnd::numeric+v_final.transfer_pool_vnd::numeric+
   v_final.recorded_overlay_vnd::numeric-v_paid-v_unpaid-v_final.club_retained_tie_vnd;
 IF v_unallocated<0 OR v_paid<0 OR v_unpaid<0 OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_rows) x(value)
      WHERE (x.value->>'currentTotalVnd')::numeric<0 OR
        (x.value->>'currentPaidVnd')::numeric<0 OR
        (x.value->>'currentUnpaidVnd')::numeric<0) THEN
   RAISE EXCEPTION 'multi_day_payout_correction_unreconciled' USING ERRCODE='23514';
 END IF;
 RETURN pg_catalog.jsonb_build_object('eventId',p_event_id,'revision',v_revision,
   'directPoolVnd',v_final.direct_pool_vnd,'transferPoolVnd',v_final.transfer_pool_vnd,
   'recordedOverlayVnd',v_final.recorded_overlay_vnd,'requiredShortfallVnd',0,
   'paidPlayerVnd',v_paid::bigint,'unpaidObligationVnd',v_unpaid::bigint,
   'clubRetainedTieVnd',v_final.club_retained_tie_vnd,
   'unallocatedPoolVnd',v_unallocated::bigint,'obligations',v_rows,
   'corrections',v_correction,'paymentExecution','NOT_PERFORMED');
END $function$;
