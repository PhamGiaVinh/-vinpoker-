-- SOURCE ONLY. Depends on payout snapshot/source proof v1 and Satellite #1344.
-- Original finalization, obligations JSON, and historical payment rows stay immutable.
-- This ledger changes accounting entitlements only; it never executes a payment.
-- ROLLBACK: revoke these RPCs in a forward migration; retain all evidence rows.

CREATE TABLE IF NOT EXISTS public.multi_day_payout_correction_requests_v1 (
 request_id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES public.multi_day_payout_finalizations_v1(event_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 kind text NOT NULL CHECK(kind IN('OBLIGATION_DELTA','PAYMENT_REVERSAL')),
 participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id) ON DELETE RESTRICT,
 original_payment_id uuid,
 delta_vnd bigint NOT NULL CHECK(delta_vnd<>0 AND abs(delta_vnd::numeric)<=9007199254740991),
 expected_revision text NOT NULL CHECK(expected_revision ~ '^[0-9a-f]{32}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 8 AND 200),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='OBLIGATION_DELTA' AND original_payment_id IS NULL) OR
       (kind='PAYMENT_REVERSAL' AND original_payment_id IS NOT NULL AND delta_vnd<0))
);
CREATE TABLE IF NOT EXISTS public.multi_day_payout_corrections_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 approval_seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_id uuid NOT NULL UNIQUE REFERENCES public.multi_day_payout_correction_requests_v1(request_id) ON DELETE RESTRICT,
 event_id uuid NOT NULL REFERENCES public.multi_day_payout_finalizations_v1(event_id) ON DELETE RESTRICT,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 approval_request_id uuid NOT NULL UNIQUE,
 approval_hash text NOT NULL CHECK(approval_hash ~ '^[0-9a-f]{32}$'),
 kind text NOT NULL CHECK(kind IN('OBLIGATION_DELTA','PAYMENT_REVERSAL')),
 participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id) ON DELETE RESTRICT,
 original_payment_id uuid,
 delta_vnd bigint NOT NULL CHECK(delta_vnd<>0),
 previous_revision text NOT NULL CHECK(previous_revision ~ '^[0-9a-f]{32}$'),
 resulting_revision text NOT NULL CHECK(resulting_revision ~ '^[0-9a-f]{32}$'),
 resulting_paid_vnd bigint NOT NULL CHECK(resulting_paid_vnd>=0),
 resulting_unpaid_vnd bigint NOT NULL CHECK(resulting_unpaid_vnd>=0),
 resulting_unallocated_vnd bigint NOT NULL CHECK(resulting_unallocated_vnd>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS multi_day_payout_corrections_event_v1
 ON public.multi_day_payout_corrections_v1(event_id,approval_seq);
CREATE UNIQUE INDEX IF NOT EXISTS multi_day_payout_payment_reversed_once_v1
 ON public.multi_day_payout_corrections_v1(original_payment_id)
 WHERE original_payment_id IS NOT NULL;
ALTER TABLE public.multi_day_payout_correction_requests_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multi_day_payout_corrections_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_payout_correction_requests_v1,
 public.multi_day_payout_corrections_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_payout_correction_request_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_payout_correction_requests_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TRIGGER multi_day_payout_correction_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_payout_corrections_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

-- Authoritative event-payout accounting only. Satellite ticket awards remain
-- solely in satellite_award_plans / satellite_award_issues / satellite_tickets;
-- redeemed ticket transfer funding was already pinned in the original source.
CREATE FUNCTION public.multi_day_payout_postfinal_state_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_final public.multi_day_payout_finalizations_v1%ROWTYPE;
 v_revision text; v_rows jsonb; v_paid numeric; v_unpaid numeric;
 v_unallocated numeric; v_correction jsonb;
BEGIN
 SELECT * INTO v_final FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 IF NOT FOUND OR v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs c
     WHERE c.id=v_final.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_payout_owner_required' USING ERRCODE='42501';
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
END $$;
REVOKE ALL ON FUNCTION public.multi_day_payout_postfinal_state_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_payout_postfinal_state_v1(uuid)
 TO authenticated,service_role;

CREATE FUNCTION public.multi_day_request_payout_correction_v1(
 p_event_id uuid,p_kind text,p_participation_id uuid,p_original_payment_id uuid,
 p_delta_vnd bigint,p_expected_revision text,p_reason text,p_evidence_ref text,
 p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_final public.multi_day_payout_finalizations_v1%ROWTYPE;
 v_prior public.multi_day_payout_correction_requests_v1%ROWTYPE;
 v_obligation jsonb; v_payment public.tournament_prize_payments%ROWTYPE;
 v_hash text;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL OR
    p_kind NOT IN('OBLIGATION_DELTA','PAYMENT_REVERSAL') OR
    p_participation_id IS NULL OR p_delta_vnd IS NULL OR p_delta_vnd=0 OR
    abs(p_delta_vnd::numeric)>9007199254740991 OR
    p_expected_revision !~ '^[0-9a-f]{32}$' OR
    length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500 OR
    length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 8 AND 200 OR
    (p_kind='OBLIGATION_DELTA' AND p_original_payment_id IS NOT NULL) OR
    (p_kind='PAYMENT_REVERSAL' AND (p_original_payment_id IS NULL OR p_delta_vnd>=0)) THEN
   RAISE EXCEPTION 'multi_day_payout_correction_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c
   WHERE c.id=v_event.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_payout_owner_required' USING ERRCODE='42501';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('event',p_event_id,'kind',p_kind,
   'participation',p_participation_id,'payment',p_original_payment_id,
   'delta',p_delta_vnd,'revision',p_expected_revision,
   'reason',btrim(p_reason),'evidence',btrim(p_evidence_ref))::text);
 SELECT * INTO v_prior FROM public.multi_day_payout_correction_requests_v1
   WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.actor_id<>v_actor OR v_prior.event_id<>p_event_id OR
      v_prior.payload_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_payout_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'requestId',p_request_id,
     'state','PENDING_APPROVAL','idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_final FROM public.multi_day_payout_finalizations_v1
   WHERE event_id=p_event_id AND club_id=v_event.club_id;
 IF NOT FOUND OR (public.multi_day_payout_postfinal_state_v1(p_event_id)->>'revision')
     IS DISTINCT FROM p_expected_revision THEN
   RAISE EXCEPTION 'multi_day_payout_recalculate' USING ERRCODE='40001';
 END IF;
 SELECT x.value INTO v_obligation FROM pg_catalog.jsonb_array_elements(v_final.obligations) x(value)
   WHERE (x.value->>'participationId')::uuid=p_participation_id;
 IF v_obligation IS NULL OR NOT EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p
   WHERE p.id=p_participation_id AND p.event_id=p_event_id AND
     p.player_id=(v_obligation->>'playerId')::uuid) THEN
   RAISE EXCEPTION 'multi_day_payout_original_obligation_missing' USING ERRCODE='23514';
 END IF;
 IF p_kind='PAYMENT_REVERSAL' THEN
   SELECT * INTO v_payment FROM public.tournament_prize_payments
     WHERE id=p_original_payment_id AND tournament_id=v_final.final_tournament_id
       AND recipient_ref=(v_obligation->>'playerId')::uuid AND status='paid';
   IF NOT FOUND OR v_payment.prize_amount<>trunc(v_payment.prize_amount) OR
      v_payment.prize_amount<>-p_delta_vnd OR
      NOT (v_final.source_snapshot->'payments' @> pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id',p_original_payment_id))) THEN
     RAISE EXCEPTION 'multi_day_payout_original_payment_missing' USING ERRCODE='23514';
   END IF;
 END IF;
 INSERT INTO public.multi_day_payout_correction_requests_v1(request_id,event_id,
   actor_id,kind,participation_id,original_payment_id,delta_vnd,
   expected_revision,reason,evidence_ref,payload_hash)
 VALUES(p_request_id,p_event_id,v_actor,p_kind,p_participation_id,
   p_original_payment_id,p_delta_vnd,p_expected_revision,btrim(p_reason),
   btrim(p_evidence_ref),v_hash);
 RETURN pg_catalog.jsonb_build_object('ok',true,'requestId',p_request_id,
   'state','PENDING_APPROVAL','idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_request_payout_correction_v1(
 uuid,text,uuid,uuid,bigint,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_request_payout_correction_v1(
 uuid,text,uuid,uuid,bigint,text,text,text,uuid) TO authenticated,service_role;

CREATE FUNCTION public.multi_day_approve_payout_correction_v1(
 p_request_id uuid,p_approval_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_request public.multi_day_payout_correction_requests_v1%ROWTYPE;
 v_event public.tournament_events%ROWTYPE; v_prior public.multi_day_payout_corrections_v1%ROWTYPE;
 v_before jsonb; v_after jsonb; v_hash text; v_id uuid; v_target jsonb;
 v_next_revision text; v_next_paid bigint; v_next_unpaid bigint;
 v_next_unallocated bigint;
BEGIN
 IF v_actor IS NULL OR p_request_id IS NULL OR p_approval_request_id IS NULL THEN
   RAISE EXCEPTION 'multi_day_payout_correction_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_request FROM public.multi_day_payout_correction_requests_v1
   WHERE request_id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_payout_correction_request_missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_event FROM public.tournament_events WHERE id=v_request.event_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c
   WHERE c.id=v_event.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_payout_owner_required' USING ERRCODE='42501';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('request',p_request_id,
   'approval',p_approval_request_id)::text);
 SELECT * INTO v_prior FROM public.multi_day_payout_corrections_v1
   WHERE approval_request_id=p_approval_request_id OR request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.request_id<>p_request_id OR v_prior.actor_id<>v_actor OR
      v_prior.approval_request_id<>p_approval_request_id OR v_prior.approval_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_payout_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'correctionId',v_prior.id,
     'revision',v_prior.resulting_revision,'idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 v_before:=public.multi_day_payout_postfinal_state_v1(v_request.event_id);
 IF v_before->>'revision' IS DISTINCT FROM v_request.expected_revision THEN
   RAISE EXCEPTION 'multi_day_payout_recalculate' USING ERRCODE='40001';
 END IF;
 -- Validate resulting per-player and event equation before the append-only insert.
 SELECT x.value INTO v_target FROM pg_catalog.jsonb_array_elements(v_before->'obligations') x(value)
   WHERE (x.value->>'participationId')::uuid=v_request.participation_id;
 IF v_target IS NULL OR
    (v_request.kind='OBLIGATION_DELTA' AND
      ((v_target->>'currentTotalVnd')::numeric+v_request.delta_vnd<
         (v_target->>'currentPaidVnd')::numeric OR
       (v_before->>'unallocatedPoolVnd')::numeric-v_request.delta_vnd<0)) OR
    (v_request.kind='PAYMENT_REVERSAL' AND
      (v_target->>'currentPaidVnd')::numeric+v_request.delta_vnd<0) THEN
   RAISE EXCEPTION 'multi_day_payout_correction_unreconciled' USING ERRCODE='23514';
 END IF;
 IF v_request.kind='PAYMENT_REVERSAL' AND EXISTS(
   SELECT 1 FROM public.multi_day_payout_corrections_v1 c
   WHERE c.original_payment_id=v_request.original_payment_id) THEN
   RAISE EXCEPTION 'multi_day_payout_payment_already_reversed' USING ERRCODE='23514';
 END IF;
 v_id:=gen_random_uuid();
 v_next_revision:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'previous',v_request.expected_revision,'request',p_request_id,
   'approval',p_approval_request_id,'kind',v_request.kind,
   'participation',v_request.participation_id,'payment',v_request.original_payment_id,
   'delta',v_request.delta_vnd)::text);
 v_next_paid:=(v_before->>'paidPlayerVnd')::bigint+
   CASE WHEN v_request.kind='PAYMENT_REVERSAL' THEN v_request.delta_vnd ELSE 0 END;
 v_next_unpaid:=(v_before->>'unpaidObligationVnd')::bigint+
   CASE WHEN v_request.kind='OBLIGATION_DELTA' THEN v_request.delta_vnd
        ELSE -v_request.delta_vnd END;
 v_next_unallocated:=(v_before->>'unallocatedPoolVnd')::bigint-
   CASE WHEN v_request.kind='OBLIGATION_DELTA' THEN v_request.delta_vnd ELSE 0 END;
 -- One immutable append. The event lock ensures a competing approval cannot
 -- slip between the before/after snapshots.
 INSERT INTO public.multi_day_payout_corrections_v1(id,request_id,event_id,
   club_id,actor_id,approval_request_id,approval_hash,kind,participation_id,
   original_payment_id,delta_vnd,previous_revision,resulting_revision,
   resulting_paid_vnd,resulting_unpaid_vnd,resulting_unallocated_vnd)
 VALUES(v_id,p_request_id,v_request.event_id,v_event.club_id,v_actor,
   p_approval_request_id,v_hash,v_request.kind,v_request.participation_id,
   v_request.original_payment_id,v_request.delta_vnd,v_request.expected_revision,
   v_next_revision,v_next_paid,v_next_unpaid,v_next_unallocated);
 v_after:=public.multi_day_payout_postfinal_state_v1(v_request.event_id);
 IF v_after->>'revision'<>v_next_revision OR
    (v_after->>'paidPlayerVnd')::bigint<>v_next_paid OR
    (v_after->>'unpaidObligationVnd')::bigint<>v_next_unpaid OR
    (v_after->>'unallocatedPoolVnd')::bigint<>v_next_unallocated THEN
   RAISE EXCEPTION 'multi_day_payout_correction_unreconciled' USING ERRCODE='23514';
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'correctionId',v_id,
   'revision',v_after->>'revision','paidPlayerVnd',v_after->'paidPlayerVnd',
   'unpaidObligationVnd',v_after->'unpaidObligationVnd',
   'unallocatedPoolVnd',v_after->'unallocatedPoolVnd',
   'paymentExecution','NOT_PERFORMED','idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_approve_payout_correction_v1(uuid,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_approve_payout_correction_v1(uuid,uuid)
 TO authenticated,service_role;
