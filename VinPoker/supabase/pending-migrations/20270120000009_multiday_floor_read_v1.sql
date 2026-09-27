-- SOURCE ONLY. Owner-scoped read projection for Floor; no table grants or mutation.
-- ROLLBACK: revoke this read RPC in a forward migration; preserve source tables.
CREATE FUNCTION public.multi_day_floor_read_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_lock public.multi_day_qualification_locks_v1%ROWTYPE;
 v_final public.multi_day_payout_finalizations_v1%ROWTYPE;
 v_pending jsonb;
BEGIN
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id;
 IF NOT FOUND OR v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs c
   WHERE c.id=v_event.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_floor_owner_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 SELECT * INTO v_lock FROM public.multi_day_qualification_locks_v1 WHERE event_id=p_event_id;
 SELECT * INTO v_final FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'requestId',r.request_id,'kind',r.kind,'participationId',r.participation_id,
   'originalPaymentId',r.original_payment_id,'deltaVnd',r.delta_vnd,
   'expectedRevision',r.expected_revision,'reason',r.reason,
   'evidenceRef',r.evidence_ref,'createdAt',r.created_at,
   'state',CASE WHEN c.id IS NULL THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END)
   ORDER BY r.created_at,r.request_id),'[]'::jsonb)
 INTO v_pending FROM public.multi_day_payout_correction_requests_v1 r
 LEFT JOIN public.multi_day_payout_corrections_v1 c ON c.request_id=r.request_id
 WHERE r.event_id=p_event_id;
 RETURN pg_catalog.jsonb_build_object('eventId',p_event_id,
   'clubId',v_event.club_id,'finalTournamentId',v_event.final_tournament_id,
   'eventItmPercent',v_event.itm_percent,
   'releaseEnabled',EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     WHERE g.id AND g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)),
   'rules',CASE WHEN v_rules.event_id IS NULL THEN NULL ELSE
     pg_catalog.jsonb_build_object('policy',v_rules.policy,
       'itmPercent',v_rules.itm_percent,'day2Percent',v_rules.itm_percent,
       'minCashX',v_rules.min_cash_x,'buyInVnd',v_rules.buy_in_vnd,
       'rakeVnd',v_rules.rake_vnd,'configuredAt',v_rules.configured_at) END,
   'qualification',CASE WHEN v_lock.event_id IS NULL THEN NULL ELSE
     pg_catalog.jsonb_build_object('sourceHash',v_lock.source_hash,
       'selectionHash',v_lock.selection_hash,
       'participationCount',v_lock.participation_count,
       'lockedAt',v_lock.locked_at) END,
   'finalization',CASE WHEN v_final.event_id IS NULL THEN NULL ELSE
     pg_catalog.jsonb_build_object('requestId',v_final.request_id,
       'payoutInputHash',v_final.payout_input_hash,
       'finalizedAt',v_final.finalized_at,'state','FINALIZED_OBLIGATIONS',
       'rulesVersion',v_final.rules_version,
       'fundingRevision',v_final.funding_revision,
       'qualificationRevision',v_final.qualification_revision,
       'directPoolVnd',v_final.direct_pool_vnd,
       'transferPoolVnd',v_final.transfer_pool_vnd,'feesVnd',v_final.fee_vnd,
       'recordedOverlayVnd',v_final.recorded_overlay_vnd,
       'requiredShortfallVnd',v_final.required_shortfall_vnd,
       'paidPlayerVnd',v_final.paid_player_vnd,
       'unpaidObligationVnd',v_final.unpaid_obligation_vnd,
       'clubRetainedTieVnd',v_final.club_retained_tie_vnd,
       'unallocatedPoolVnd',v_final.unallocated_pool_vnd,
       'obligations',v_final.obligations,
       'sourceSnapshot',v_final.source_snapshot) END,
   'correctionRequests',v_pending);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_floor_read_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_floor_read_v1(uuid) TO authenticated,service_role;
