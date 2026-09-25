-- SOURCE ONLY. Depends on package migrations 00-05, tie helper 20270119000001,
-- and Satellite #1344 transfer + reversal tables. Never replay #1344 here.
-- Finalize records immutable obligations; it does NOT send or mark payments.
-- ROLLBACK: revoke preview/finalize in a forward migration. Keep snapshots.
DO $preflight$ BEGIN
 IF to_regclass('public.satellite_ticket_value_transfers') IS NULL OR
    to_regclass('public.satellite_redemption_reversals') IS NULL OR
    to_regclass('public.satellite_tickets') IS NULL OR
    to_regprocedure('public.satellite_redeem_ticket_v1(uuid,uuid,uuid,uuid)') IS NULL OR
    to_regprocedure('public.satellite_approve_redemption_reversal_v1(uuid,uuid,text,uuid)') IS NULL OR
    to_regclass('public.cashier_buyin_movements') IS NULL OR
    to_regclass('public.multi_day_overlay_funding_v1') IS NULL OR
    to_regprocedure('public.multi_day_equal_tie_entitlement_v1(bigint[],integer)') IS NULL THEN
   RAISE EXCEPTION 'multi_day_payout_transfer_or_cashier_dependency_missing'
     USING ERRCODE='23514';
 END IF;
END $preflight$;

-- Forward refinement of migration 04: prize ranks may be authored before the
-- first source flight ends (GTD is published pre-open). A configured payout
-- run or payment still cannot use the legacy path once package rules are on.
CREATE OR REPLACE FUNCTION private.multi_day_legacy_payout_hold_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tournament uuid; v_event uuid; v_pass integer;
BEGIN
 FOR v_pass IN 1..CASE WHEN TG_OP='UPDATE' THEN 2 ELSE 1 END LOOP
   v_tournament:=CASE WHEN v_pass=1 AND TG_OP<>'INSERT'
     THEN OLD.tournament_id ELSE NEW.tournament_id END;
   SELECT e.id INTO v_event FROM public.tournaments t
     JOIN public.tournament_events e ON e.id=t.event_id
     WHERE t.id=v_tournament AND t.phase='final' FOR SHARE OF e;
   IF v_event IS NOT NULL AND (
      EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=v_event)
      OR EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 q
        WHERE q.event_id=v_event)
      OR (TG_TABLE_NAME<>'tournament_prizes' AND
        EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
          JOIN public.multi_day_package_release_v1 g ON g.id AND g.enabled
            AND r.club_id=ANY(g.allowed_club_ids) WHERE r.event_id=v_event))) THEN
     RAISE EXCEPTION 'multi_day_verified_payout_writer_required' USING ERRCODE='42501';
   END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TABLE IF NOT EXISTS public.multi_day_payout_finalizations_v1 (
 event_id uuid PRIMARY KEY REFERENCES public.tournament_events(id) ON DELETE RESTRICT,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
 final_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{32}$'),
 rules_version text NOT NULL CHECK(rules_version ~ '^[0-9a-f]{32}$'),
 funding_revision text NOT NULL CHECK(funding_revision ~ '^[0-9a-f]{32}$'),
 qualification_revision text NOT NULL CHECK(qualification_revision ~ '^[0-9a-f]{32}$'),
 payout_input_hash text NOT NULL CHECK(payout_input_hash ~ '^[0-9a-f]{32}$'),
 direct_pool_vnd bigint NOT NULL CHECK(direct_pool_vnd>=0),
 transfer_pool_vnd bigint NOT NULL CHECK(transfer_pool_vnd>=0),
 fee_vnd bigint NOT NULL CHECK(fee_vnd>=0),
 recorded_overlay_vnd bigint NOT NULL CHECK(recorded_overlay_vnd>=0),
 required_shortfall_vnd bigint NOT NULL DEFAULT 0 CHECK(required_shortfall_vnd=0),
 paid_player_vnd bigint NOT NULL DEFAULT 0 CHECK(paid_player_vnd>=0),
 unpaid_obligation_vnd bigint NOT NULL CHECK(unpaid_obligation_vnd>=0),
 club_retained_tie_vnd bigint NOT NULL CHECK(club_retained_tie_vnd>=0),
 unallocated_pool_vnd bigint NOT NULL CHECK(unallocated_pool_vnd>=0),
 obligations jsonb NOT NULL CHECK(jsonb_typeof(obligations)='array'),
 tie_batches jsonb NOT NULL CHECK(jsonb_typeof(tie_batches)='array'),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
 receipt jsonb NOT NULL,
 finalized_at timestamptz NOT NULL DEFAULT now(),
 CHECK(direct_pool_vnd::numeric+transfer_pool_vnd::numeric+recorded_overlay_vnd::numeric
   =paid_player_vnd::numeric+unpaid_obligation_vnd::numeric+
    club_retained_tie_vnd::numeric+unallocated_pool_vnd::numeric)
);
ALTER TABLE public.multi_day_payout_finalizations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_payout_finalizations_v1
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_payout_finalization_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_payout_finalizations_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

-- After an immutable payout snapshot, all financial source changes need a
-- separately linked adjustment. Direct inserts cannot silently drift it.
CREATE FUNCTION private.multi_day_payout_source_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid; v_tournament uuid; v_old_event uuid;
BEGIN
 IF TG_TABLE_NAME='multi_day_overlay_funding_v1' THEN
   v_event:=NEW.event_id;
 ELSIF TG_TABLE_NAME='satellite_redemption_reversals' THEN
   v_tournament:=NEW.target_tournament_id;
 ELSIF TG_TABLE_NAME='satellite_ticket_value_transfers' THEN
   v_tournament:=NEW.target_tournament_id;
 ELSIF TG_TABLE_NAME='cashier_buyin_movements' THEN
   v_tournament:=NEW.tournament_id;
   IF v_tournament IS NULL AND NEW.registration_id IS NOT NULL THEN
     SELECT r.tournament_id INTO v_tournament FROM public.tournament_registrations r
       WHERE r.id=NEW.registration_id;
   END IF;
 ELSE
   v_tournament:=NEW.tournament_id;
 END IF;
 IF v_event IS NULL THEN
   SELECT t.event_id INTO v_event FROM public.tournaments t
    WHERE t.id=v_tournament AND t.phase IN('flight','final');
 END IF;
 IF v_event IS NOT NULL THEN
   PERFORM 1 FROM public.tournament_events e WHERE e.id=v_event FOR SHARE;
   IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f
       WHERE f.event_id=v_event) THEN
     RAISE EXCEPTION 'multi_day_payout_linked_adjustment_required' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_payout_source_fence_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_overlay_payout_fence_v1 BEFORE INSERT
 ON public.multi_day_overlay_funding_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_payout_source_fence_v1();
CREATE TRIGGER multi_day_cashier_payout_fence_v1 BEFORE INSERT
 ON public.cashier_buyin_movements FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_payout_source_fence_v1();
CREATE TRIGGER multi_day_ticket_transfer_payout_fence_v1 BEFORE INSERT
 ON public.satellite_ticket_value_transfers FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_payout_source_fence_v1();
CREATE TRIGGER multi_day_ticket_reversal_payout_fence_v1 BEFORE INSERT
 ON public.satellite_redemption_reversals FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_payout_source_fence_v1();

CREATE FUNCTION private.multi_day_payout_row_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid; v_old_event uuid; v_new_event uuid; v_relevant boolean:=true;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='tournament_entries' THEN
     v_relevant:=(OLD.tournament_id,OLD.player_id,OLD.registration_id,
       OLD.entry_no,OLD.status,OLD.finished_place)
       IS DISTINCT FROM
       (NEW.tournament_id,NEW.player_id,NEW.registration_id,
        NEW.entry_no,NEW.status,NEW.finished_place);
   ELSE
     v_relevant:=(OLD.tournament_id,OLD.player_id,OLD.status,OLD.buy_in,
       OLD.platform_fixed_fee,OLD.total_pay,OLD.confirmed_at,OLD.price_snapshot)
       IS DISTINCT FROM
       (NEW.tournament_id,NEW.player_id,NEW.status,NEW.buy_in,
        NEW.platform_fixed_fee,NEW.total_pay,NEW.confirmed_at,NEW.price_snapshot);
   END IF;
   IF NOT v_relevant THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP<>'INSERT' THEN
   SELECT t.event_id INTO v_old_event FROM public.tournaments t
     WHERE t.id=OLD.tournament_id AND t.phase IN('flight','final');
 END IF;
 IF TG_OP<>'DELETE' THEN
   SELECT t.event_id INTO v_new_event FROM public.tournaments t
     WHERE t.id=NEW.tournament_id AND t.phase IN('flight','final');
 END IF;
 FOR v_event IN SELECT DISTINCT x FROM pg_catalog.unnest(ARRAY[v_old_event,v_new_event]) x
      WHERE x IS NOT NULL ORDER BY x LOOP
   IF NOT EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=v_event)
      AND NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 q
        WHERE q.event_id=v_event) THEN
     CONTINUE;
   END IF;
   PERFORM 1 FROM public.tournament_events e WHERE e.id=v_event FOR SHARE;
   IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f
      WHERE f.event_id=v_event) THEN
     RAISE EXCEPTION 'multi_day_payout_linked_adjustment_required' USING ERRCODE='42501';
   END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_payout_row_fence_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_entry_payout_fence_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_entries FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_payout_row_fence_v1();
CREATE TRIGGER multi_day_registration_payout_fence_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_registrations FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_payout_row_fence_v1();

CREATE FUNCTION private.multi_day_payout_validate_positions_v1(p_final uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.tournament_prizes q
    WHERE q.tournament_id=p_final
      AND (q.position<1 OR q.amount<0 OR q.amount<>trunc(q.amount))) OR
    EXISTS(SELECT 1 FROM public.tournament_prizes q
      WHERE q.tournament_id=p_final
      GROUP BY q.position HAVING count(*)>1) THEN
   RAISE EXCEPTION 'multi_day_payout_positions_invalid' USING ERRCODE='23514';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_payout_validate_positions_v1(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.multi_day_payout_preview_v1(p_event_id uuid)
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
      v_reg.total_pay IS DISTINCT FROM v_reg.buy_in+v_reg.platform_fixed_fee OR
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
        v_transfer.target_rake_vnd+v_transfer.target_service_fee_vnd
          IS DISTINCT FROM v_reg.platform_fixed_fee OR
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
   v_fee:=v_fee+v_reg.platform_fixed_fee;
   v_source:=v_source||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'registrationId',v_reg.id,'entryId',v_reg.entry_id,'flightId',v_reg.tournament_id,
     'playerId',v_reg.player_id,'tender',v_tender,'transferId',v_transfer_id,
     'ticketStatus',v_ticket_status,'targetRakeVnd',v_target_rake,
     'targetServiceFeeVnd',v_target_service_fee,
     'poolVnd',v_reg.buy_in,'feeVnd',v_reg.platform_fixed_fee,
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
   SELECT array_agg(q.amount::bigint ORDER BY q.position),count(*)
     INTO v_rank_amounts,v_count FROM public.tournament_prizes q
     WHERE q.tournament_id=v_rules.final_tournament_id
       AND q.position BETWEEN v_next_rank AND v_next_rank+v_group_size-1;
   IF v_count<>v_group_size THEN
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
 v_rules_version:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'policy',v_rules.policy,'itm',v_rules.itm_percent,'minCashX',v_rules.min_cash_x,
   'buyIn',v_rules.buy_in_vnd,'rake',v_rules.rake_vnd)::text);
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
REVOKE ALL ON FUNCTION public.multi_day_payout_preview_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_payout_preview_v1(uuid)
 TO authenticated,service_role;

CREATE FUNCTION public.multi_day_finalize_payout_v1(
 p_event_id uuid,p_expected_rules_version text,p_expected_funding_revision text,
 p_expected_qualification_revision text,p_expected_payout_input_hash text,
 p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_prior public.multi_day_payout_finalizations_v1%ROWTYPE;
 v_preview jsonb; v_hash text; v_receipt jsonb;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL OR
    p_expected_rules_version IS NULL OR p_expected_funding_revision IS NULL OR
    p_expected_qualification_revision IS NULL OR p_expected_payout_input_hash IS NULL OR
    p_expected_rules_version !~ '^[0-9a-f]{32}$' OR
    p_expected_funding_revision !~ '^[0-9a-f]{32}$' OR
    p_expected_qualification_revision !~ '^[0-9a-f]{32}$' OR
    p_expected_payout_input_hash !~ '^[0-9a-f]{32}$' THEN
   RAISE EXCEPTION 'multi_day_payout_finalize_invalid' USING ERRCODE='22023';
 END IF;
 -- Common event fence is first. Writers take event SHARE at their existing
 -- entry/registration/movement seam; no registration or tournament row is
 -- locked here, so Cashier reg-first cannot cycle against this operation.
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c
    WHERE c.id=v_event.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_payout_owner_required' USING ERRCODE='42501';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('event',p_event_id,
   'rules',p_expected_rules_version,'funding',p_expected_funding_revision,
   'qualification',p_expected_qualification_revision,
   'input',p_expected_payout_input_hash)::text);
 SELECT * INTO v_prior FROM public.multi_day_payout_finalizations_v1
    WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.event_id IS DISTINCT FROM p_event_id OR
      v_prior.actor_id IS DISTINCT FROM v_actor OR v_prior.request_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_payout_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt||pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f
    WHERE f.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_payout_already_finalized' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 BEGIN
   v_preview:=public.multi_day_payout_preview_v1(p_event_id);
 EXCEPTION WHEN check_violation THEN
   RAISE EXCEPTION 'multi_day_payout_recalculate' USING ERRCODE='40001';
 END;
 IF v_preview->>'rulesVersion' IS DISTINCT FROM p_expected_rules_version OR
    v_preview->>'fundingRevision' IS DISTINCT FROM p_expected_funding_revision OR
    v_preview->>'qualificationRevision' IS DISTINCT FROM p_expected_qualification_revision OR
    v_preview->>'payoutInputHash' IS DISTINCT FROM p_expected_payout_input_hash THEN
   RAISE EXCEPTION 'multi_day_payout_recalculate' USING ERRCODE='40001';
 END IF;
 IF v_preview->>'state'<>'READY' OR
    (v_preview->>'requiredShortfallVnd')::numeric<>0 THEN
   RAISE EXCEPTION 'multi_day_payout_shortfall_unfunded' USING ERRCODE='23514';
 END IF;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'state','FINALIZED_OBLIGATIONS',
    'eventId',p_event_id,'finalTournamentId',v_preview->>'finalTournamentId',
    'rulesVersion',p_expected_rules_version,
    'fundingRevision',p_expected_funding_revision,
    'qualificationRevision',p_expected_qualification_revision,
    'payoutInputHash',p_expected_payout_input_hash,
    'recordedOverlayVnd',v_preview->'recordedOverlayVnd',
    'requiredShortfallVnd',0,'paidPlayerVnd',v_preview->'paidPlayerVnd',
    'unpaidObligationVnd',v_preview->'unpaidObligationVnd',
    'clubRetainedTieVnd',v_preview->'clubRetainedTieVnd',
    'unallocatedPoolVnd',v_preview->'unallocatedPoolVnd',
    'paymentExecution','NOT_PERFORMED','idempotent',false);
 INSERT INTO public.multi_day_payout_finalizations_v1(event_id,club_id,
   final_tournament_id,request_id,actor_id,request_hash,rules_version,
   funding_revision,qualification_revision,payout_input_hash,direct_pool_vnd,
   transfer_pool_vnd,fee_vnd,recorded_overlay_vnd,required_shortfall_vnd,paid_player_vnd,
   unpaid_obligation_vnd,club_retained_tie_vnd,unallocated_pool_vnd,
   obligations,tie_batches,source_snapshot,receipt)
 VALUES(p_event_id,v_event.club_id,(v_preview->>'finalTournamentId')::uuid,
   p_request_id,v_actor,v_hash,p_expected_rules_version,p_expected_funding_revision,
   p_expected_qualification_revision,p_expected_payout_input_hash,
   (v_preview->>'directPoolVnd')::bigint,(v_preview->>'transferPoolVnd')::bigint,
   (v_preview->>'feesVnd')::bigint,(v_preview->>'recordedOverlayVnd')::bigint,
   0,(v_preview->>'paidPlayerVnd')::bigint,(v_preview->>'unpaidObligationVnd')::bigint,
   (v_preview->>'clubRetainedTieVnd')::bigint,
   (v_preview->>'unallocatedPoolVnd')::bigint,v_preview->'obligations',
   v_preview->'tieBatches',
   v_preview->'sourceSnapshot',v_receipt);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_finalize_payout_v1(
 uuid,text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_finalize_payout_v1(
 uuid,text,text,text,text,uuid) TO authenticated,service_role;

-- Post-final discrepancies are append-only, linked, and HELD. This does not
-- modify an immutable snapshot or execute a Cashier payout/reversal.
CREATE TABLE IF NOT EXISTS public.multi_day_payout_adjustment_requests_v1 (
 request_id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES public.multi_day_payout_finalizations_v1(event_id)
   ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 category text NOT NULL CHECK(category IN('FUNDING','OBLIGATION','PAID')),
 proposed_delta_vnd bigint NOT NULL CHECK(proposed_delta_vnd<>0),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 8 AND 200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
 status text NOT NULL DEFAULT 'OWNER_APPROVED_HELD'
   CHECK(status='OWNER_APPROVED_HELD'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.multi_day_payout_adjustment_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_payout_adjustment_requests_v1
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_payout_adjustment_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_payout_adjustment_requests_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION public.multi_day_request_payout_adjustment_v1(
 p_event_id uuid,p_category text,p_proposed_delta_vnd bigint,
 p_evidence_ref text,p_reason text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_prior public.multi_day_payout_adjustment_requests_v1%ROWTYPE;
 v_hash text;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL OR
    p_category NOT IN('FUNDING','OBLIGATION','PAID') OR
    p_proposed_delta_vnd IS NULL OR p_proposed_delta_vnd=0 OR
    length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 8 AND 200 OR
    length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500 THEN
   RAISE EXCEPTION 'multi_day_payout_adjustment_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c
     WHERE c.id=v_event.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_payout_owner_required' USING ERRCODE='42501';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('event',p_event_id,
   'category',p_category,'delta',p_proposed_delta_vnd,
   'evidence',btrim(p_evidence_ref),'reason',btrim(p_reason))::text);
 SELECT * INTO v_prior FROM public.multi_day_payout_adjustment_requests_v1
   WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.event_id IS DISTINCT FROM p_event_id OR
      v_prior.actor_id IS DISTINCT FROM v_actor OR v_prior.payload_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_payout_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'state',v_prior.status,
     'requestId',p_request_id,'idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) OR
    NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f
     WHERE f.event_id=p_event_id AND f.club_id=v_event.club_id) THEN
   RAISE EXCEPTION 'multi_day_payout_adjustment_gate_or_finalization_missing'
     USING ERRCODE='42501';
 END IF;
 INSERT INTO public.multi_day_payout_adjustment_requests_v1(request_id,event_id,
   actor_id,category,proposed_delta_vnd,evidence_ref,reason,payload_hash)
 VALUES(p_request_id,p_event_id,v_actor,p_category,p_proposed_delta_vnd,
   btrim(p_evidence_ref),btrim(p_reason),v_hash);
 RETURN pg_catalog.jsonb_build_object('ok',true,'state','OWNER_APPROVED_HELD',
   'requestId',p_request_id,'snapshotChanged',false,'paymentExecuted',false,
   'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_request_payout_adjustment_v1(
 uuid,text,bigint,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_request_payout_adjustment_v1(
 uuid,text,bigint,text,text,uuid) TO authenticated,service_role;
