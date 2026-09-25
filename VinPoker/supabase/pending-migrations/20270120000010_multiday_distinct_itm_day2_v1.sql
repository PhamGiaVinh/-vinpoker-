-- SOURCE ONLY. Distinct frozen ITM and Day2 percentages for package events.
-- Existing single-percentage rows seed Day2 from their immutable ITM value;
-- this preserves their historical quota and does not revise an entered event.
-- ROLLBACK: revoke the four-argument rules RPC in a forward migration. Preserve
-- both frozen percentages, locks, source hashes and payout records.
BEGIN;
LOCK TABLE public.multi_day_qualification_rules_v1 IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.multi_day_qualification_rules_v1
 ADD COLUMN IF NOT EXISTS day2_percent numeric;
DO $seed$ BEGIN
 IF EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
   JOIN public.tournament_events e ON e.id=r.event_id
   WHERE r.day2_percent IS NULL AND
     (r.itm_percent IS DISTINCT FROM e.itm_percent OR
      r.itm_percent<=0 OR r.itm_percent>100)) THEN
   RAISE EXCEPTION 'multi_day_historical_percentage_not_seedable' USING ERRCODE='23514';
 END IF;
END $seed$;
-- The row trigger is suspended only while this ACCESS EXCLUSIVE migration lock
-- protects the semantic-preserving backfill. It is restored before COMMIT.
ALTER TABLE public.multi_day_qualification_rules_v1
 DISABLE TRIGGER multi_day_rules_immutable_v1;
UPDATE public.multi_day_qualification_rules_v1
 SET day2_percent=itm_percent WHERE day2_percent IS NULL;
ALTER TABLE public.multi_day_qualification_rules_v1
 ENABLE TRIGGER multi_day_rules_immutable_v1;
ALTER TABLE public.multi_day_qualification_rules_v1
 ALTER COLUMN day2_percent SET NOT NULL;
DO $constraint$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint
   WHERE conrelid='public.multi_day_qualification_rules_v1'::regclass
     AND conname='multi_day_day2_percent_range_v1') THEN
   ALTER TABLE public.multi_day_qualification_rules_v1
    ADD CONSTRAINT multi_day_day2_percent_range_v1
    CHECK(day2_percent>0 AND day2_percent<=100 AND itm_percent<=day2_percent);
 END IF;
END $constraint$;
COMMIT;

-- The old writer cannot create another ambiguous single-percentage row.
CREATE OR REPLACE FUNCTION public.multi_day_set_qualification_rules_v1(
 p_event_id uuid,p_policy text,p_min_cash_x numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'multi_day_day2_percent_required' USING ERRCODE='22023';
END $$;


CREATE FUNCTION public.multi_day_set_qualification_rules_v2(
 p_event_id uuid,p_policy text,p_min_cash_x numeric,p_day2_percent numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_prior public.multi_day_qualification_rules_v1%ROWTYPE;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR
    p_policy NOT IN('SELECT_LARGEST','SUM_STACKS') OR
    p_min_cash_x IS NULL OR p_min_cash_x<0 OR p_min_cash_x>100 OR
    p_day2_percent IS NULL OR p_day2_percent<=0 OR p_day2_percent>100 THEN
   RAISE EXCEPTION 'multi_day_rules_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.final_tournament_id IS NULL OR
    v_event.itm_percent IS NULL OR v_event.itm_percent<=0 OR
    v_event.itm_percent>p_day2_percent OR v_event.buy_in IS NULL OR
    v_event.rake_amount IS NULL THEN
   RAISE EXCEPTION 'multi_day_itm_day2_invalid' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_event.club_id AND c.owner_id=v_actor)
    OR NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id
        AND g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_rules_actor_or_gate_denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_prior FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 IF FOUND THEN
   IF (v_prior.policy,v_prior.min_cash_x,v_prior.itm_percent,v_prior.day2_percent)
      IS DISTINCT FROM (p_policy,p_min_cash_x,v_event.itm_percent,p_day2_percent) THEN
      RAISE EXCEPTION 'multi_day_rules_immutable' USING ERRCODE='23514';
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'idempotent',true,
     'itmPercent',v_prior.itm_percent,'day2Percent',v_prior.day2_percent);
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_entries x JOIN public.tournaments t
       ON t.id=x.tournament_id WHERE t.event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.tournament_registrations x JOIN public.tournaments t
       ON t.id=x.tournament_id WHERE t.event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_rules_after_source' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.multi_day_qualification_rules_v1
   (event_id,club_id,final_tournament_id,policy,itm_percent,day2_percent,
    min_cash_x,buy_in_vnd,rake_vnd,configured_by)
 VALUES(p_event_id,v_event.club_id,v_event.final_tournament_id,p_policy,
   v_event.itm_percent,p_day2_percent,p_min_cash_x,v_event.buy_in,v_event.rake_amount,v_actor);
 RETURN pg_catalog.jsonb_build_object('ok',true,'idempotent',false,
   'itmPercent',v_event.itm_percent,'day2Percent',p_day2_percent);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_set_qualification_rules_v2(
 uuid,text,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_set_qualification_rules_v2(
 uuid,text,numeric,numeric) TO authenticated;

-- Preserve the old classifier and every existing source/seat consistency
-- check. Refine its flight quota and hash through a new public entry point.
ALTER FUNCTION public.multi_day_qualification_preview_v1(uuid) SET SCHEMA private;
ALTER FUNCTION private.multi_day_qualification_preview_v1(uuid)
 RENAME TO multi_day_qualification_shared_preview_v1;
REVOKE ALL ON FUNCTION private.multi_day_qualification_shared_preview_v1(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.multi_day_qualification_preview_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_base jsonb; v_flights jsonb:='[]'::jsonb; v_flight jsonb;
 v_itm integer; v_day2 integer; v_ready boolean;
BEGIN
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 IF NOT FOUND OR v_rules.day2_percent IS NULL OR
    v_rules.itm_percent>v_rules.day2_percent THEN
   RAISE EXCEPTION 'multi_day_rules_missing' USING ERRCODE='23514';
 END IF;
 v_base:=private.multi_day_qualification_shared_preview_v1(p_event_id);
 v_ready:=v_base->>'state'='READY';
 FOR v_flight IN SELECT value FROM pg_catalog.jsonb_array_elements(v_base->'flights') x(value) LOOP
   v_itm:=pg_catalog.ceil((v_flight->>'validEntries')::numeric*v_rules.itm_percent/100)::integer;
   v_day2:=pg_catalog.ceil((v_flight->>'validEntries')::numeric*v_rules.day2_percent/100)::integer;
   IF v_day2>pg_catalog.jsonb_array_length(v_flight->'eligibleBags') THEN v_ready:=false; END IF;
   v_flights:=v_flights||pg_catalog.jsonb_build_array(
     v_flight||pg_catalog.jsonb_build_object('itmTarget',v_itm,'day2Target',v_day2));
 END LOOP;
 RETURN v_base||pg_catalog.jsonb_build_object(
   'state',CASE WHEN v_base->>'state'='LOCKED' THEN 'LOCKED'
       WHEN v_ready THEN 'READY' ELSE 'PLANNED' END,
   'itmPercent',v_rules.itm_percent,'day2Percent',v_rules.day2_percent,
   'flights',v_flights,
   'sourceHash',pg_catalog.md5(pg_catalog.jsonb_build_object(
     'priorSource',v_base->>'sourceHash','itm',v_rules.itm_percent,
     'day2',v_rules.day2_percent,'flights',v_flights)::text));
END $$;
REVOKE ALL ON FUNCTION public.multi_day_qualification_preview_v1(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_qualification_preview_v1(uuid) TO authenticated;

-- Forward replacement of the pre-bank-proof projection. Migration 07's
-- public bank-proof wrapper still calls this private classifier unchanged.
CREATE OR REPLACE FUNCTION private.multi_day_payout_unverified_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_lock public.multi_day_qualification_locks_v1%ROWTYPE;
 v_reg record; v_group record; v_player record; v_transfer record;
 v_source jsonb:='[]'::jsonb; v_overlay_rows jsonb:='[]'::jsonb;
 v_obligations jsonb:='[]'::jsonb; v_prize_rows jsonb:='[]'::jsonb;
 v_tie_batches jsonb:='[]'::jsonb;
 v_qualification_rows jsonb:='[]'::jsonb; v_payment_rows jsonb:='[]'::jsonb;
 v_direct numeric:=0; v_transfer_pool numeric:=0; v_fee numeric:=0;
 v_recorded_overlay numeric:=0; v_paid numeric:=0; v_unpaid numeric:=0;
 v_tie_remainder numeric:=0; v_required numeric; v_unallocated numeric;
 v_ledger numeric; v_movement_rows jsonb; v_count integer; v_next_rank integer:=1;
 v_itm_places integer; v_required_positions integer;
 v_group_size integer; v_rank_amounts bigint[]; v_rank_total bigint;
 v_split jsonb; v_per_player bigint; v_group_remainder bigint;
 v_min_cash numeric; v_floor numeric; v_obligation numeric; v_player_paid numeric;
 v_rules_version text; v_funding_revision text; v_qualification_revision text;
 v_input_hash text; v_tender text; v_transfer_id uuid;
 v_target_rake bigint; v_target_service_fee bigint; v_ticket_status text;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL THEN
   RAISE EXCEPTION 'multi_day_payout_auth_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 SELECT * INTO v_lock FROM public.multi_day_qualification_locks_v1 WHERE event_id=p_event_id;
 IF v_rules.event_id IS NULL OR v_lock.event_id IS NULL OR
    NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_rules.club_id AND
       (c.owner_id=v_actor OR public.is_club_floor(v_actor,v_rules.club_id))) THEN
   RAISE EXCEPTION 'multi_day_payout_actor_or_qualification_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_rules.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 IF v_rules.day2_percent IS NULL OR v_rules.itm_percent>v_rules.day2_percent THEN
   RAISE EXCEPTION 'multi_day_itm_day2_invalid' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(pg_catalog.ceil(x.valid_entries*v_rules.itm_percent/100)),0)::integer
 INTO v_itm_places FROM (
   SELECT t.id,count(e.id) FILTER (WHERE e.status<>'cancelled')::numeric valid_entries
   FROM public.tournaments t LEFT JOIN public.tournament_entries e ON e.tournament_id=t.id
   WHERE t.event_id=p_event_id AND t.phase='flight' AND t.deleted_at IS NULL
   GROUP BY t.id) x;
 IF v_itm_places<1 OR v_itm_places>v_lock.participation_count THEN
   RAISE EXCEPTION 'multi_day_payout_itm_capacity_invalid' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_prizes q
   WHERE q.tournament_id=v_rules.final_tournament_id AND
     q.position>v_itm_places AND q.amount<>0) THEN
   RAISE EXCEPTION 'multi_day_payout_non_itm_prize' USING ERRCODE='23514';
 END IF;
 IF to_regclass('public.satellite_ticket_value_transfers') IS NULL OR
    to_regclass('public.satellite_redemption_reversals') IS NULL OR
    to_regclass('public.satellite_tickets') IS NULL OR
    to_regprocedure('public.satellite_redeem_ticket_v1(uuid,uuid,uuid,uuid)') IS NULL OR
    to_regprocedure('public.satellite_approve_redemption_reversal_v1(uuid,uuid,text,uuid)') IS NULL THEN
   RAISE EXCEPTION 'multi_day_payout_transfer_dependency_missing' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournaments t WHERE t.event_id=p_event_id
    AND t.phase='flight' AND NOT EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
      WHERE f.flight_tournament_id=t.id AND f.status='locked')) OR
    EXISTS(SELECT 1 FROM public.tournaments t WHERE t.event_id=p_event_id
      AND t.phase='flight' AND NOT t.id=ANY(v_lock.flight_ids)) OR
    (SELECT count(*) FROM public.tournaments t WHERE t.event_id=p_event_id
      AND t.phase='flight')<>pg_catalog.cardinality(v_lock.flight_ids) THEN
   RAISE EXCEPTION 'multi_day_payout_flight_set_stale' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_registrations r
    JOIN public.tournaments t ON t.id=r.tournament_id
    WHERE t.event_id=p_event_id AND t.phase='flight'
      AND r.status='confirmed' AND NOT EXISTS(SELECT 1 FROM public.tournament_entries e
        WHERE e.registration_id=r.id AND e.tournament_id=r.tournament_id
          AND e.player_id=r.player_id AND e.status<>'cancelled')) OR
    EXISTS(SELECT 1 FROM public.tournament_entries e
      JOIN public.tournaments t ON t.id=e.tournament_id
      LEFT JOIN public.tournament_registrations r ON r.id=e.registration_id
      WHERE t.event_id=p_event_id AND t.phase='flight' AND e.status<>'cancelled'
        AND (r.id IS NULL OR r.status<>'confirmed' OR r.confirmed_at IS NULL
          OR r.tournament_id<>e.tournament_id OR r.player_id<>e.player_id)) OR
    EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
      LEFT JOIN public.tournament_registrations r ON r.id=m.registration_id
      JOIN public.tournaments t ON t.id=coalesce(m.tournament_id,r.tournament_id)
      WHERE t.event_id=p_event_id AND t.phase='flight'
        AND m.purpose IN('buyin','refund') AND
        (r.id IS NULL OR r.tournament_id<>t.id OR
          m.club_id IS DISTINCT FROM v_rules.club_id)) OR
    EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers x
      JOIN public.tournaments t ON t.id=x.target_tournament_id
      LEFT JOIN public.tournament_registrations r ON r.id=x.registration_id
      WHERE t.event_id=p_event_id AND t.phase='flight' AND
        (r.id IS NULL OR r.tournament_id<>t.id OR
         x.club_id IS DISTINCT FROM v_rules.club_id)) THEN
   RAISE EXCEPTION 'multi_day_payout_source_unmatched' USING ERRCODE='23514';
 END IF;
 FOR v_reg IN
   SELECT r.*,e.id entry_id,e.player_id entry_player,t.club_id flight_club
   FROM public.tournament_registrations r
   JOIN public.tournament_entries e ON e.registration_id=r.id
      AND e.tournament_id=r.tournament_id AND e.status<>'cancelled'
   JOIN public.tournaments t ON t.id=r.tournament_id
   WHERE t.event_id=p_event_id AND t.phase='flight'
   ORDER BY r.id,e.id
 LOOP
   IF v_reg.status<>'confirmed' OR v_reg.confirmed_at IS NULL OR
      v_reg.club_id IS DISTINCT FROM v_rules.club_id OR
      v_reg.flight_club IS DISTINCT FROM v_rules.club_id OR
      v_reg.entry_player IS DISTINCT FROM v_reg.player_id OR
      v_reg.buy_in IS NULL OR v_reg.buy_in<=0 OR
      v_reg.platform_fixed_fee IS NULL OR v_reg.platform_fixed_fee<0 OR
      v_reg.total_pay IS NULL OR v_reg.total_pay<v_reg.buy_in OR
      (v_reg.price_snapshot IS NOT NULL AND
        (v_reg.price_snapshot->>'buy_in')::numeric IS DISTINCT FROM v_reg.buy_in OR
        (v_reg.price_snapshot->>'total_pay')::numeric IS DISTINCT FROM v_reg.total_pay OR
        (v_reg.price_snapshot->>'platform_fee')::numeric
          IS DISTINCT FROM v_reg.platform_fixed_fee OR
        (v_reg.price_snapshot->>'rake')::numeric IS NULL OR
        (v_reg.price_snapshot->>'service_fee')::numeric IS NULL OR
        (v_reg.price_snapshot->>'rake')::numeric<0 OR
        (v_reg.price_snapshot->>'service_fee')::numeric<0 OR
        (v_reg.price_snapshot->>'rake')::numeric IS DISTINCT FROM
          trunc((v_reg.price_snapshot->>'rake')::numeric) OR
        (v_reg.price_snapshot->>'service_fee')::numeric IS DISTINCT FROM
          trunc((v_reg.price_snapshot->>'service_fee')::numeric) OR
        v_reg.total_pay::numeric IS DISTINCT FROM
          (v_reg.price_snapshot->>'buy_in')::numeric+
          (v_reg.price_snapshot->>'rake')::numeric+
          (v_reg.price_snapshot->>'service_fee')::numeric+
          (v_reg.price_snapshot->>'platform_fee')::numeric) OR
      (SELECT count(*) FROM public.tournament_entries e
         WHERE e.registration_id=v_reg.id AND e.status<>'cancelled')<>1 THEN
     RAISE EXCEPTION 'multi_day_payout_source_inconsistent' USING ERRCODE='23514';
   END IF;
   SELECT count(*) INTO v_count FROM public.satellite_ticket_value_transfers x
     WHERE x.registration_id=v_reg.id;
   SELECT coalesce(sum(CASE WHEN m.direction='in' AND m.purpose='buyin'
      THEN m.applied_amount WHEN m.direction='out' AND m.purpose='refund'
      THEN -m.applied_amount ELSE 0 END),0) INTO v_ledger
     FROM public.cashier_buyin_movements m WHERE m.registration_id=v_reg.id;
   SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'id',m.id,'purpose',m.purpose,'direction',m.direction,
     'appliedVnd',m.applied_amount) ORDER BY m.id),'[]'::jsonb)
     INTO v_movement_rows FROM public.cashier_buyin_movements m
     WHERE m.registration_id=v_reg.id;
   IF v_count=1 THEN
     SELECT x.*,k.status ticket_status INTO v_transfer
       FROM public.satellite_ticket_value_transfers x
       JOIN public.satellite_tickets k ON k.id=x.ticket_id
       WHERE x.registration_id=v_reg.id;
     IF NOT FOUND OR v_transfer.ticket_status<>'redeemed' OR
        v_transfer.target_tournament_id IS DISTINCT FROM v_reg.tournament_id OR
        v_transfer.club_id IS DISTINCT FROM v_rules.club_id OR
        v_transfer.target_buy_in_vnd IS DISTINCT FROM v_reg.buy_in OR
        v_transfer.target_credit_vnd IS DISTINCT FROM v_reg.total_pay OR
        v_transfer.target_rake_vnd IS DISTINCT FROM
          (v_reg.price_snapshot->>'rake')::bigint OR
        v_transfer.target_service_fee_vnd IS DISTINCT FROM
          (v_reg.price_snapshot->>'service_fee')::bigint OR
        v_reg.platform_fixed_fee<>0 OR
        v_transfer.source_debit_vnd IS DISTINCT FROM v_transfer.target_credit_vnd OR
        v_reg.price_snapshot->>'tender' IS DISTINCT FROM 'satellite_ticket' OR v_ledger<>0 OR
        EXISTS(SELECT 1 FROM public.satellite_redemption_reversals z
          WHERE z.original_transfer_id=v_transfer.id) THEN
       RAISE EXCEPTION 'multi_day_payout_ticket_unreconciled' USING ERRCODE='23514';
     END IF;
     v_tender:='TICKET_TRANSFER'; v_transfer_id:=v_transfer.id;
     v_target_rake:=v_transfer.target_rake_vnd;
     v_target_service_fee:=v_transfer.target_service_fee_vnd;
     v_ticket_status:=v_transfer.ticket_status;
     v_transfer_pool:=v_transfer_pool+v_transfer.target_buy_in_vnd;
   ELSIF v_count=0 THEN
     IF v_reg.price_snapshot->>'tender'='satellite_ticket' OR
        (v_reg.price_snapshot IS NOT NULL AND v_ledger<>v_reg.total_pay) OR
        (v_reg.price_snapshot IS NULL AND v_ledger<>0) THEN
       RAISE EXCEPTION 'multi_day_payout_direct_unreconciled' USING ERRCODE='23514';
     END IF;
     v_tender:='CONFIRMED_DIRECT'; v_transfer_id:=NULL;
     v_target_rake:=NULL; v_target_service_fee:=NULL; v_ticket_status:=NULL;
     v_direct:=v_direct+v_reg.buy_in;
   ELSE
     RAISE EXCEPTION 'multi_day_payout_duplicate_transfer' USING ERRCODE='23514';
   END IF;
   v_fee:=v_fee+v_reg.total_pay-v_reg.buy_in;
   v_source:=v_source||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'registrationId',v_reg.id,'entryId',v_reg.entry_id,'flightId',v_reg.tournament_id,
     'playerId',v_reg.player_id,'tender',v_tender,'transferId',v_transfer_id,
     'ticketStatus',v_ticket_status,'targetRakeVnd',v_target_rake,
     'targetServiceFeeVnd',v_target_service_fee,
     'poolVnd',v_reg.buy_in,'feeVnd',v_reg.total_pay-v_reg.buy_in,
     'totalVnd',v_reg.total_pay,'ledgerNetVnd',v_ledger,
     'registrationStatus',v_reg.status,'confirmedAt',v_reg.confirmed_at,
     'priceSnapshot',v_reg.price_snapshot,
     'movementRows',v_movement_rows));
 END LOOP;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',o.id,'kind',o.kind,'amountVnd',o.amount_vnd,'evidenceRef',o.evidence_ref,
      'reversesId',o.reverses_id,'adjustsId',o.adjusts_id) ORDER BY o.created_at,o.id),'[]'::jsonb),
    coalesce(sum(CASE WHEN o.kind='REVERSAL' THEN -o.amount_vnd ELSE o.amount_vnd END),0)
 INTO v_overlay_rows,v_recorded_overlay
 FROM public.multi_day_overlay_funding_v1 o WHERE o.event_id=p_event_id;
 IF v_recorded_overlay<0 THEN
   RAISE EXCEPTION 'multi_day_payout_overlay_negative' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'playerId',p.player_id,'participationId',p.id,'sourceBags',p.source_bags,
    'seedRevision',s.seed_revision,'seedStack',s.seed_stack,'entryId',s.entry_id)
    ORDER BY p.player_id),'[]'::jsonb)
 INTO v_qualification_rows FROM public.multi_day_final_participations_v1 p
 LEFT JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
 WHERE p.event_id=p_event_id;
 IF EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p
   LEFT JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
   LEFT JOIN public.tournament_entries e ON e.id=s.entry_id
   WHERE p.event_id=p_event_id AND (s.entry_id IS NULL OR e.finished_place IS NULL
     OR e.player_id<>p.player_id OR e.tournament_id<>v_rules.final_tournament_id)) OR
   EXISTS(SELECT 1 FROM public.tournament_entries e
     WHERE e.tournament_id=v_rules.final_tournament_id AND e.finished_place IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s
         WHERE s.entry_id=e.id)) THEN
   RAISE EXCEPTION 'multi_day_payout_results_not_ready' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_final_adjustments_v1 a
   JOIN public.multi_day_final_participations_v1 p ON p.id=a.participation_id
   WHERE p.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_payout_adjustment_pending' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'position',q.position,'amountVnd',q.amount) ORDER BY q.position),'[]'::jsonb)
 INTO v_prize_rows FROM public.tournament_prizes q
 WHERE q.tournament_id=v_rules.final_tournament_id;
 PERFORM private.multi_day_payout_validate_positions_v1(v_rules.final_tournament_id);
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',m.id,'playerId',m.recipient_ref,'amountVnd',m.prize_amount,'status',m.status)
    ORDER BY m.id),'[]'::jsonb)
 INTO v_payment_rows FROM public.tournament_prize_payments m
 WHERE m.tournament_id=v_rules.final_tournament_id;
 IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m
    WHERE m.tournament_id=v_rules.final_tournament_id AND
      (m.status<>'paid' OR m.prize_amount<0 OR m.prize_amount<>trunc(m.prize_amount)
       OR m.recipient_ref IS NULL OR NOT EXISTS(
         SELECT 1 FROM public.multi_day_final_participations_v1 p
          WHERE p.event_id=p_event_id AND p.player_id=m.recipient_ref))) THEN
   RAISE EXCEPTION 'multi_day_payout_payment_unmatched' USING ERRCODE='23514';
 END IF;
 FOR v_group IN SELECT e.finished_place rank,count(*)::integer player_count
    FROM public.multi_day_final_participations_v1 p
    JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
    JOIN public.tournament_entries e ON e.id=s.entry_id
    WHERE p.event_id=p_event_id
    GROUP BY e.finished_place ORDER BY e.finished_place LOOP
   v_group_size:=v_group.player_count;
   IF v_group.rank<>v_next_rank OR v_group_size<1 THEN
     RAISE EXCEPTION 'multi_day_payout_rank_gap' USING ERRCODE='23514';
   END IF;
   IF v_next_rank<=v_itm_places AND
      v_next_rank+v_group_size-1>v_itm_places THEN
     RAISE EXCEPTION 'multi_day_payout_itm_boundary_tie' USING ERRCODE='23514';
   END IF;
   SELECT array_agg(coalesce(q.amount,0)::bigint ORDER BY rank_no),
     count(q.id) FILTER (WHERE rank_no<=v_itm_places)
     INTO v_rank_amounts,v_count
   FROM pg_catalog.generate_series(v_next_rank,v_next_rank+v_group_size-1) rank_no
   LEFT JOIN public.tournament_prizes q
     ON q.tournament_id=v_rules.final_tournament_id AND q.position=rank_no;
   v_required_positions:=greatest(least(v_next_rank+v_group_size-1,
     v_itm_places)-v_next_rank+1,0);
   IF v_count<>v_required_positions THEN
     RAISE EXCEPTION 'multi_day_payout_rank_amount_missing' USING ERRCODE='23514';
   END IF;
   IF v_group_size>1 THEN
     v_split:=public.multi_day_equal_tie_entitlement_v1(v_rank_amounts,v_group_size);
     v_per_player:=(v_split->>'perPlayerVnd')::bigint;
     v_group_remainder:=(v_split->>'clubRetainedRemainderVnd')::bigint;
     v_tie_remainder:=v_tie_remainder+v_group_remainder;
     v_tie_batches:=v_tie_batches||pg_catalog.jsonb_build_array(
       pg_catalog.jsonb_build_object('firstRank',v_next_rank,
       'occupiedRankAmountsVnd',v_rank_amounts,'playerCount',v_group_size,
       'perPlayerVnd',v_per_player,'clubRetainedRemainderVnd',v_group_remainder));
   ELSE v_per_player:=v_rank_amounts[1]; END IF;
   FOR v_player IN SELECT p.* FROM public.multi_day_final_participations_v1 p
     JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
     JOIN public.tournament_entries e ON e.id=s.entry_id
     WHERE p.event_id=p_event_id AND e.finished_place=v_group.rank
     ORDER BY p.player_id LOOP
     SELECT coalesce(sum(m.amount_vnd),0) INTO v_min_cash
       FROM public.multi_day_nonselected_min_cash_v1 m
       WHERE m.participation_id=v_player.id AND m.status='PENDING_FUNDING';
     v_floor:=CASE WHEN v_group.rank<=v_itm_places
       THEN v_player.participation_floor_vnd ELSE 0 END;
     IF v_floor<>trunc(v_floor) OR v_min_cash<>trunc(v_min_cash) THEN
       RAISE EXCEPTION 'multi_day_payout_fractional_obligation' USING ERRCODE='23514';
     END IF;
     IF v_player.policy='SUM_STACKS' AND v_min_cash<>0 THEN
       RAISE EXCEPTION 'multi_day_payout_sum_stacks_extra_cash' USING ERRCODE='23514';
     END IF;
     v_obligation:=greatest(v_per_player::numeric,v_floor)+v_min_cash;
     SELECT coalesce(sum(m.prize_amount),0) INTO v_player_paid
       FROM public.tournament_prize_payments m
       WHERE m.tournament_id=v_rules.final_tournament_id
         AND m.recipient_ref=v_player.player_id AND m.status='paid';
     IF v_player_paid>v_obligation THEN
       RAISE EXCEPTION 'multi_day_payout_overpaid' USING ERRCODE='23514';
     END IF;
     v_paid:=v_paid+v_player_paid;
     v_unpaid:=v_unpaid+v_obligation-v_player_paid;
     v_obligations:=v_obligations||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
       'playerId',v_player.player_id,'participationId',v_player.id,'rank',v_group.rank,
       'rankAwardVnd',v_per_player,'participationFloorVnd',v_floor,
       'nonselectedBagMinCashVnd',v_min_cash,'totalVnd',v_obligation,
       'paidVnd',v_player_paid,'unpaidVnd',v_obligation-v_player_paid));
   END LOOP;
   v_next_rank:=v_next_rank+v_group_size;
 END LOOP;
 IF v_next_rank=1 THEN
   RAISE EXCEPTION 'multi_day_payout_no_results' USING ERRCODE='23514';
 END IF;
 -- A seeded historical row has identical economics and must retain its
 -- pre-migration rules revision; independently configured rows bind Day2.
 v_rules_version:=pg_catalog.md5((pg_catalog.jsonb_build_object(
   'policy',v_rules.policy,'itm',v_rules.itm_percent,
   'minCashX',v_rules.min_cash_x,'buyIn',v_rules.buy_in_vnd,
   'rake',v_rules.rake_vnd) || CASE
     WHEN v_rules.day2_percent=v_rules.itm_percent THEN '{}'::jsonb
     ELSE pg_catalog.jsonb_build_object('day2',v_rules.day2_percent)
   END)::text);
 v_funding_revision:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'sources',v_source,'overlay',v_overlay_rows)::text);
 v_qualification_revision:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'sourceHash',v_lock.source_hash,'selectionHash',v_lock.selection_hash,
   'participants',v_qualification_rows)::text);
 v_input_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'rules',v_rules_version,'funding',v_funding_revision,
   'qualification',v_qualification_revision,'prizes',v_prize_rows,
   'payments',v_payment_rows,'obligations',v_obligations,
   'tieBatches',v_tie_batches)::text);
 v_required:=greatest(v_paid+v_unpaid+v_tie_remainder-
   v_direct-v_transfer_pool-v_recorded_overlay,0);
 v_unallocated:=greatest(v_direct+v_transfer_pool+v_recorded_overlay-
   v_paid-v_unpaid-v_tie_remainder,0);
 IF greatest(v_direct,v_transfer_pool,v_fee,v_recorded_overlay,v_paid,v_unpaid,
     v_tie_remainder,v_required,v_unallocated)>9007199254740991 THEN
   RAISE EXCEPTION 'multi_day_payout_amount_overflow' USING ERRCODE='22003';
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'eventId',p_event_id,
   'finalTournamentId',v_rules.final_tournament_id,
   'itmPercent',v_rules.itm_percent,'day2Percent',v_rules.day2_percent,
   'itmPlaces',v_itm_places,
   'state',CASE WHEN v_required>0 THEN 'REQUIRED_SHORTFALL' ELSE 'READY' END,
   'rulesVersion',v_rules_version,'fundingRevision',v_funding_revision,
   'qualificationRevision',v_qualification_revision,'payoutInputHash',v_input_hash,
   'directPoolVnd',v_direct::bigint,'transferPoolVnd',v_transfer_pool::bigint,
   'feesVnd',v_fee::bigint,'recordedOverlayVnd',v_recorded_overlay::bigint,
   'requiredShortfallVnd',v_required::bigint,'paidPlayerVnd',v_paid::bigint,
   'unpaidObligationVnd',v_unpaid::bigint,
   'clubRetainedTieVnd',v_tie_remainder::bigint,
   'unallocatedPoolVnd',v_unallocated::bigint,
   'obligations',v_obligations,'tieBatches',v_tie_batches,
   'sourceSnapshot',pg_catalog.jsonb_build_object(
     'registrations',v_source,'overlayRecords',v_overlay_rows,
     'prizePositions',v_prize_rows,'payments',v_payment_rows));
END $$;

-- Keep the original owner-scope and correction/finalization projection, and
-- replace only its historical Day2 alias with the frozen rules value.
ALTER FUNCTION public.multi_day_floor_read_v1(uuid) SET SCHEMA private;
ALTER FUNCTION private.multi_day_floor_read_v1(uuid) RENAME TO multi_day_floor_shared_read_v1;
REVOKE ALL ON FUNCTION private.multi_day_floor_shared_read_v1(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.multi_day_floor_read_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_read jsonb; v_day2 numeric;
BEGIN
 v_read:=private.multi_day_floor_shared_read_v1(p_event_id);
 SELECT r.day2_percent INTO v_day2 FROM public.multi_day_qualification_rules_v1 r
 WHERE r.event_id=p_event_id;
 IF v_day2 IS NULL THEN RETURN v_read; END IF;
 RETURN pg_catalog.jsonb_set(v_read,'{rules,day2Percent}',pg_catalog.to_jsonb(v_day2));
END $$;
REVOKE ALL ON FUNCTION public.multi_day_floor_read_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_floor_read_v1(uuid) TO authenticated,service_role;
