-- SOURCE ONLY. Forward correction: Final Day participation floor applies at
-- every rank, including qualifiers outside configured ITM paid positions.
-- ROLLBACK: forward replacement only; preserve finalized snapshots and cash.
CREATE OR REPLACE FUNCTION private.multi_day_payout_unverified_v1(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     v_floor:=v_player.participation_floor_vnd;
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
END $function$;

-- Forward authorization replacement: public.multi_day_set_qualification_rules_v2(uuid,text,numeric,numeric)
CREATE OR REPLACE FUNCTION public.multi_day_set_qualification_rules_v2(p_event_id uuid, p_policy text, p_min_cash_x numeric, p_day2_percent numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 IF NOT (EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_event.club_id AND c.owner_id=v_actor)
    OR public.is_club_floor(v_actor,v_event.club_id)) THEN
   RAISE EXCEPTION 'multi_day_rules_actor_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id
    AND g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
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
END $function$;

-- Forward authorization replacement: private.multi_day_qualification_shared_preview_v1(uuid)
CREATE OR REPLACE FUNCTION private.multi_day_qualification_shared_preview_v1(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_flight record; v_flights jsonb:='[]'::jsonb; v_bags jsonb;
 v_count integer:=0; v_valid integer; v_target integer; v_eligible integer;
 v_ready boolean:=true; v_hash text; v_state text;
BEGIN
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1
  WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_rules_missing' USING ERRCODE='23514'; END IF;
 IF v_actor IS NULL OR NOT (EXISTS(SELECT 1 FROM public.clubs c
     WHERE c.id=v_rules.club_id AND c.owner_id=v_actor)
     OR public.is_club_floor(v_actor,v_rules.club_id)) THEN
   RAISE EXCEPTION 'multi_day_preview_actor_denied' USING ERRCODE='42501';
 END IF;
 FOR v_flight IN SELECT t.id,t.club_id,f.status,f.day_number,f.roster_count,
      f.roster_hash,d.status AS day_status,d.version AS day_version
   FROM public.tournaments t
   LEFT JOIN public.multi_day_flight_ends_v1 f ON f.flight_tournament_id=t.id
   LEFT JOIN public.day_close d ON d.tournament_id=t.id AND d.day_number=f.day_number
   WHERE t.event_id=p_event_id AND t.phase='flight' AND t.deleted_at IS NULL
   ORDER BY t.id LOOP
   v_count:=v_count+1;
   SELECT count(*) INTO v_valid FROM public.tournament_entries e
     WHERE e.tournament_id=v_flight.id AND e.status<>'cancelled';
   v_target:=pg_catalog.ceil(v_valid::numeric*v_rules.itm_percent/100)::integer;
   SELECT count(*),coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('bagId',b.id,'version',b.multi_day_sealed_version,
        'entryId',r.entry_id,'playerId',r.player_id,'stack',b.total_value)
      ORDER BY b.id),'[]'::jsonb)
     INTO v_eligible,v_bags
     FROM public.multi_day_flight_roster_v1 r
     JOIN public.chip_bag b ON b.tournament_id=r.flight_tournament_id
       AND b.player_id=r.player_id AND b.day_number=v_flight.day_number
       AND b.sealed AND b.multi_day_revision=b.multi_day_sealed_version
       AND b.multi_day_roster_hash=v_flight.roster_hash
     WHERE r.flight_tournament_id=v_flight.id AND b.total_value>0;
   IF v_flight.club_id IS DISTINCT FROM v_rules.club_id
      OR v_flight.status IS DISTINCT FROM 'locked'
      OR v_flight.day_status IS DISTINCT FROM 'locked'
      OR v_flight.roster_count IS NULL OR v_eligible<>v_flight.roster_count
      OR v_target<1 OR v_target>v_eligible THEN v_ready:=false; END IF;
   v_flights:=v_flights || pg_catalog.jsonb_build_array(
     pg_catalog.jsonb_build_object('flightId',v_flight.id,
       'status',v_flight.status,'dayStatus',v_flight.day_status,
       'dayVersion',v_flight.day_version,'rosterHash',v_flight.roster_hash,
       'validEntries',v_valid,'day2Target',v_target,'eligibleBags',v_bags));
 END LOOP;
 IF v_count=0 OR EXISTS(SELECT 1 FROM public.tournament_event_qualifiers q
     WHERE q.event_id=p_event_id OR q.final_tournament_id=v_rules.final_tournament_id)
    OR EXISTS(SELECT 1 FROM public.tournament_entries e
       WHERE e.tournament_id=v_rules.final_tournament_id)
    OR EXISTS(SELECT 1 FROM public.tournament_seats s
       WHERE s.tournament_id=v_rules.final_tournament_id)
    OR EXISTS(SELECT 1 FROM public.tournaments t
     WHERE t.id=v_rules.final_tournament_id AND (t.event_id IS DISTINCT FROM p_event_id
       OR t.phase IS DISTINCT FROM 'final' OR t.club_id IS DISTINCT FROM v_rules.club_id
       OR t.deleted_at IS NOT NULL)) THEN v_ready:=false; END IF;
 v_state:=CASE WHEN EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
     WHERE l.event_id=p_event_id) THEN 'LOCKED'
    WHEN v_ready THEN 'READY' ELSE 'PLANNED' END;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'eventId',p_event_id,'finalId',v_rules.final_tournament_id,
   'policy',v_rules.policy,'itmPercent',v_rules.itm_percent,
   'minCashX',v_rules.min_cash_x,'buyIn',v_rules.buy_in_vnd,
   'rake',v_rules.rake_vnd,'flights',v_flights)::text);
 RETURN pg_catalog.jsonb_build_object('state',v_state,'sourceHash',v_hash,
   'policy',v_rules.policy,'flights',v_flights,'flightCount',v_count,
   'fundingState','NOT_VERIFIED','payoutFinalization','HELD');
END $function$;

-- Forward authorization replacement: public.multi_day_lock_qualification_v1(uuid,uuid[],text,uuid)
CREATE OR REPLACE FUNCTION public.multi_day_lock_qualification_v1(p_event_id uuid, p_bag_ids uuid[], p_expected_source_hash text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_preview jsonb; v_prior public.multi_day_qualification_locks_v1%ROWTYPE;
 v_selection_hash text; v_flight record; v_selected integer; v_total integer;
 v_player record; v_bags jsonb; v_stack numeric; v_selected_bag uuid;
 v_floor numeric; v_participation_id uuid; v_count integer:=0; v_receipt jsonb;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL
    OR p_expected_source_hash !~ '^[0-9a-f]{32}$'
    OR p_bag_ids IS NULL OR pg_catalog.cardinality(p_bag_ids)=0 THEN
   RAISE EXCEPTION 'multi_day_lock_request_invalid' USING ERRCODE='22023';
 END IF;
 -- Event lock is the common fence for concurrent flight-set/registration
 -- changes. It is taken before source reads and held through all inserts.
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_event_missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1
   WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_rules_missing' USING ERRCODE='23514'; END IF;
 IF NOT (EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_rules.club_id
      AND c.owner_id=v_actor) OR public.is_club_floor(v_actor,v_rules.club_id)) THEN
   RAISE EXCEPTION 'multi_day_lock_actor_denied' USING ERRCODE='42501';
 END IF;
 SELECT pg_catalog.md5(pg_catalog.array_to_string(
   ARRAY(SELECT x::text FROM pg_catalog.unnest(p_bag_ids) AS x ORDER BY x),','))
   INTO v_selection_hash;
 SELECT * INTO v_prior FROM public.multi_day_qualification_locks_v1
   WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.event_id IS DISTINCT FROM p_event_id OR v_prior.actor_id IS DISTINCT FROM v_actor
      OR v_prior.source_hash IS DISTINCT FROM p_expected_source_hash
      OR v_prior.selection_hash IS DISTINCT FROM v_selection_hash THEN
     RAISE EXCEPTION 'multi_day_lock_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt || pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
     WHERE l.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_qualification_already_locked' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id
     AND g.enabled AND v_rules.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 v_preview:=public.multi_day_qualification_preview_v1(p_event_id);
 IF v_preview->>'sourceHash' IS DISTINCT FROM p_expected_source_hash THEN
   RAISE EXCEPTION 'multi_day_qualification_stale_source' USING ERRCODE='40001';
 END IF;
 IF v_preview->>'state'<>'READY' THEN
   RAISE EXCEPTION 'multi_day_qualification_not_ready' USING ERRCODE='23514';
 END IF;
 IF pg_catalog.cardinality(p_bag_ids)<>
    (SELECT count(DISTINCT x) FROM pg_catalog.unnest(p_bag_ids) AS x)
    OR EXISTS(SELECT 1 FROM pg_catalog.unnest(p_bag_ids) AS x WHERE x IS NULL) THEN
   RAISE EXCEPTION 'multi_day_qualification_duplicate_bag' USING ERRCODE='22023';
 END IF;
 -- Each flight must nominate exactly its server-derived Day2 quota. Every
 -- selected bag must be an eligible sealed bag in the frozen projection.
 FOR v_flight IN SELECT * FROM pg_catalog.jsonb_array_elements(v_preview->'flights') LOOP
   SELECT count(*) INTO v_selected FROM pg_catalog.jsonb_array_elements(v_flight.value->'eligibleBags') b
     WHERE (b->>'bagId')::uuid=ANY(p_bag_ids);
   IF v_selected<>(v_flight.value->>'day2Target')::integer THEN
     RAISE EXCEPTION 'multi_day_qualification_quota_mismatch' USING ERRCODE='23514';
   END IF;
   v_total:=coalesce(v_total,0)+v_selected;
 END LOOP;
 IF v_total<>pg_catalog.cardinality(p_bag_ids) THEN
   RAISE EXCEPTION 'multi_day_qualification_bag_not_eligible' USING ERRCODE='23514';
 END IF;
 SELECT count(DISTINCT b.player_id) INTO v_count FROM public.chip_bag b
   WHERE b.id=ANY(p_bag_ids);
 v_floor:=(v_rules.buy_in_vnd::numeric+v_rules.rake_vnd::numeric)*v_rules.min_cash_x;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'eventId',p_event_id,
   'finalTournamentId',v_rules.final_tournament_id,'sourceHash',p_expected_source_hash,
   'selectionHash',v_selection_hash,'policy',v_rules.policy,
   'participationCount',v_count,'fundingState','NOT_VERIFIED',
   'seatingState','HELD','payoutFinalization','HELD','idempotent',false);
 INSERT INTO public.multi_day_qualification_locks_v1(event_id,request_id,actor_id,
     source_hash,selection_hash,flight_ids,participation_count,receipt)
 VALUES(p_event_id,p_request_id,v_actor,p_expected_source_hash,v_selection_hash,
    ARRAY(SELECT (f->>'flightId')::uuid FROM pg_catalog.jsonb_array_elements(v_preview->'flights') f),
    v_count,v_receipt);
 FOR v_player IN SELECT DISTINCT b.player_id FROM public.chip_bag b
      WHERE b.id=ANY(p_bag_ids) ORDER BY b.player_id LOOP
   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
       'bagId',b.id,'bagVersion',b.multi_day_sealed_version,
       'flightId',b.tournament_id,'sourceEntryId',r.entry_id,'stack',b.total_value)
       ORDER BY b.tournament_id,b.id),sum(b.total_value)::numeric
     INTO v_bags,v_stack
     FROM public.chip_bag b JOIN public.multi_day_flight_roster_v1 r
      ON r.flight_tournament_id=b.tournament_id AND r.player_id=b.player_id
     WHERE b.id=ANY(p_bag_ids) AND b.player_id=v_player.player_id;
   IF v_rules.policy='SELECT_LARGEST' THEN
     SELECT b.id,b.total_value INTO v_selected_bag,v_stack FROM public.chip_bag b
       WHERE b.id=ANY(p_bag_ids) AND b.player_id=v_player.player_id
       ORDER BY b.total_value DESC,b.id LIMIT 1;
   ELSE v_selected_bag:=NULL; END IF;
   IF v_stack IS NULL OR v_stack<=0 OR v_stack>2147483647 THEN
     RAISE EXCEPTION 'multi_day_qualification_stack_invalid' USING ERRCODE='22003';
   END IF;
   INSERT INTO public.multi_day_final_participations_v1(event_id,final_tournament_id,
      player_id,policy,carried_stack,participation_floor_vnd,source_bags,selected_bag_id)
   VALUES(p_event_id,v_rules.final_tournament_id,v_player.player_id,v_rules.policy,
      v_stack::bigint,v_floor,v_bags,v_selected_bag)
   RETURNING id INTO v_participation_id;
   IF v_rules.policy='SELECT_LARGEST' THEN
     INSERT INTO public.multi_day_nonselected_min_cash_v1(participation_id,bag_id,
       bag_version,source_entry_id,amount_vnd)
     SELECT v_participation_id,b.id,b.multi_day_sealed_version,r.entry_id,v_floor
     FROM public.chip_bag b JOIN public.multi_day_flight_roster_v1 r
       ON r.flight_tournament_id=b.tournament_id AND r.player_id=b.player_id
     WHERE b.id=ANY(p_bag_ids) AND b.player_id=v_player.player_id
       AND b.id<>v_selected_bag;
   END IF;
 END LOOP;
 RETURN v_receipt;
END $function$;

-- Forward authorization replacement: private.multi_day_floor_shared_read_v1(uuid)
CREATE OR REPLACE FUNCTION private.multi_day_floor_shared_read_v1(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_lock public.multi_day_qualification_locks_v1%ROWTYPE;
 v_final public.multi_day_payout_finalizations_v1%ROWTYPE;
 v_pending jsonb;
BEGIN
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id;
 IF NOT FOUND OR v_actor IS NULL OR NOT (EXISTS(SELECT 1 FROM public.clubs c
   WHERE c.id=v_event.club_id AND c.owner_id=v_actor)
   OR public.is_club_floor(v_actor,v_event.club_id)) THEN
   RAISE EXCEPTION 'multi_day_floor_actor_denied' USING ERRCODE='42501';
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
END $function$;
