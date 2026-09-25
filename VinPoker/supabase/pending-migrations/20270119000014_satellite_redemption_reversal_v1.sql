-- SOURCE ONLY. Owner-approved compensation of an unused Satellite voucher.
-- Original ticket, value transfer, and correction request remain append-only.
-- No hand, chip adjustment, seat move or result may exist at approval time.
-- ROLLBACK: revoke approval RPC in a forward migration; retain both transfer
-- directions and all registration/seat/receipt history for reconciliation.

CREATE TABLE IF NOT EXISTS public.satellite_redemption_reversals (
  request_id uuid PRIMARY KEY,
  correction_request_id uuid NOT NULL UNIQUE
    REFERENCES public.satellite_redemption_correction_requests(request_id),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.satellite_tickets(id),
  original_transfer_id uuid NOT NULL UNIQUE
    REFERENCES public.satellite_ticket_value_transfers(id),
  source_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  target_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  registration_id uuid NOT NULL UNIQUE REFERENCES public.tournament_registrations(id),
  entry_id uuid NOT NULL UNIQUE REFERENCES public.tournament_entries(id),
  seat_id uuid NOT NULL UNIQUE REFERENCES public.tournament_seats(id),
  receipt_id uuid NOT NULL UNIQUE REFERENCES public.seat_draw_receipts(id),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  target_debit_vnd bigint NOT NULL CHECK (target_debit_vnd>0),
  source_credit_vnd bigint NOT NULL CHECK (source_credit_vnd>0),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  approved_reason text NOT NULL CHECK (length(btrim(approved_reason)) BETWEEN 8 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_reversal_conservation_v1 CHECK (target_debit_vnd=source_credit_vnd)
);
ALTER TABLE public.satellite_redemption_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_redemption_reversals
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_redemption_reversal_immutable_v1
  BEFORE UPDATE OR DELETE ON public.satellite_redemption_reversals
  FOR EACH ROW EXECUTE FUNCTION private.satellite_transfer_immutable_v1();

CREATE OR REPLACE FUNCTION private.satellite_reversal_insert_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_transfer public.satellite_ticket_value_transfers%ROWTYPE;
        v_ticket public.satellite_tickets%ROWTYPE;
        v_correction public.satellite_redemption_correction_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_transfer FROM public.satellite_ticket_value_transfers
    WHERE id=NEW.original_transfer_id;
  SELECT * INTO v_ticket FROM public.satellite_tickets WHERE id=NEW.ticket_id;
  SELECT * INTO v_correction FROM public.satellite_redemption_correction_requests
    WHERE request_id=NEW.correction_request_id;
  IF v_transfer.id IS NULL OR v_ticket.id IS NULL OR v_correction.request_id IS NULL
     OR v_transfer.ticket_id IS DISTINCT FROM NEW.ticket_id
     OR v_transfer.registration_id IS DISTINCT FROM NEW.registration_id
     OR v_transfer.source_tournament_id IS DISTINCT FROM NEW.source_tournament_id
     OR v_transfer.target_tournament_id IS DISTINCT FROM NEW.target_tournament_id
     OR v_transfer.club_id IS DISTINCT FROM NEW.club_id
     OR v_transfer.target_credit_vnd IS DISTINCT FROM NEW.target_debit_vnd
     OR v_transfer.source_debit_vnd IS DISTINCT FROM NEW.source_credit_vnd
     OR v_correction.ticket_id IS DISTINCT FROM NEW.ticket_id
     OR v_correction.transfer_id IS DISTINCT FROM NEW.original_transfer_id
     OR v_ticket.status IS DISTINCT FROM 'redeemed'
     OR NEW.actor_id IS DISTINCT FROM auth.uid()
     OR NEW.request_id::text IS DISTINCT FROM
        pg_catalog.current_setting('app.satellite_reversal_request_id',true) THEN
    RAISE EXCEPTION 'satellite_reversal_evidence_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_reversal_insert_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_reversal_insert_guard_v1 BEFORE INSERT
  ON public.satellite_redemption_reversals FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reversal_insert_guard_v1();

-- A voucher registration may cancel only after an exact compensating record
-- has been appended by the approval RPC. Ordinary Cashier rules are unchanged.
CREATE OR REPLACE FUNCTION public.cashier_paid_registration_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_paid bigint; v_credit bigint;
BEGIN
  IF OLD.price_snapshot IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(m.applied_amount),0) INTO v_paid
    FROM public.cashier_buyin_movements m WHERE m.registration_id=OLD.id
      AND m.purpose='buyin' AND m.direction='in';
  SELECT coalesce(sum(t.target_credit_vnd),0) INTO v_credit
    FROM public.satellite_ticket_value_transfers t WHERE t.registration_id=OLD.id;
  IF NEW.total_pay IS DISTINCT FROM OLD.total_pay OR
     NEW.buy_in IS DISTINCT FROM OLD.buy_in OR
     NEW.reference_code IS DISTINCT FROM OLD.reference_code OR
     NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot THEN
    RAISE EXCEPTION 'Server-priced registration is immutable';
  END IF;
  IF OLD.price_snapshot->>'tender'='satellite_ticket' THEN
    IF v_paid<>0 OR v_credit NOT IN (0,OLD.total_pay) THEN
      RAISE EXCEPTION 'satellite_voucher_cash_or_credit_mismatch' USING ERRCODE='23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status='pending' AND NEW.status='confirmed' THEN
        IF v_credit<>OLD.total_pay THEN
          RAISE EXCEPTION 'satellite_voucher_credit_missing' USING ERRCODE='23514'; END IF;
      ELSIF OLD.status='confirmed' AND NEW.status='cancelled' THEN
        IF NOT EXISTS (SELECT 1 FROM public.satellite_redemption_reversals x
          WHERE x.registration_id=OLD.id AND x.actor_id=auth.uid()
            AND x.request_id::text=
              pg_catalog.current_setting('app.satellite_reversal_request_id',true)) THEN
          RAISE EXCEPTION 'satellite_redemption_reversal_required' USING ERRCODE='23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'satellite_redemption_reversal_required' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF v_credit<>0 THEN
    RAISE EXCEPTION 'satellite_voucher_mixed_tender' USING ERRCODE='23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status='pending' AND NEW.status='confirmed' THEN
      IF v_paid<OLD.total_pay THEN
        RAISE EXCEPTION 'Verified buy-in total is insufficient for confirmation'; END IF;
    ELSIF OLD.status IN ('pending','confirmed') AND NEW.status='cancelled' THEN
      IF v_paid>0 AND NOT EXISTS(SELECT 1 FROM public.cashier_refund_requests f
        WHERE f.registration_id=OLD.id AND f.status='paid') THEN
        RAISE EXCEPTION 'Paid registration requires Cashier refund'; END IF;
    ELSE
      RAISE EXCEPTION 'Invalid server-priced registration transition';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- A pending hand at a ticket target takes the same tournament-row fence as
-- reversal. Hand participants/actions additionally refuse a reversed entry.
CREATE OR REPLACE FUNCTION private.satellite_reversal_hand_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tour_id uuid; v_player uuid; v_entry_no integer;
BEGIN
  IF TG_TABLE_NAME='tournament_hands' THEN
    v_tour_id:=NEW.tournament_id;
  ELSIF TG_TABLE_NAME='hand_players' THEN
    v_tour_id:=NEW.tournament_id; v_player:=NEW.player_id;
    v_entry_no:=NEW.entry_number;
  ELSE
    SELECT h.tournament_id INTO v_tour_id FROM public.tournament_hands h
      WHERE h.id=NEW.hand_id;
    v_player:=NEW.player_id; v_entry_no:=NEW.entry_number;
  END IF;
  IF EXISTS (SELECT 1 FROM public.satellite_tickets t
     WHERE t.target_tournament_id=v_tour_id AND t.status='redeemed'
       AND (v_player IS NULL OR t.redeemed_for_player_id=v_player)) THEN
    PERFORM 1 FROM public.tournaments WHERE id=v_tour_id FOR SHARE;
    IF v_player IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.satellite_redemption_reversals x
      JOIN public.tournament_entries e ON e.id=x.entry_id
      WHERE x.target_tournament_id=v_tour_id AND e.player_id=v_player
        AND e.entry_no=v_entry_no) THEN
      RAISE EXCEPTION 'satellite_reversed_entry_cannot_play' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_reversal_hand_fence_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_reversal_hand_start_fence_v1 BEFORE INSERT
  ON public.tournament_hands FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reversal_hand_fence_v1();
CREATE TRIGGER satellite_reversal_hand_player_fence_v1 BEFORE INSERT
  ON public.hand_players FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reversal_hand_fence_v1();
CREATE TRIGGER satellite_reversal_hand_action_fence_v1 BEFORE INSERT
  ON public.hand_actions FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reversal_hand_fence_v1();

CREATE OR REPLACE FUNCTION private.satellite_reversed_operational_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF TG_TABLE_NAME='tournament_entries' THEN
      IF EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers x
          WHERE x.registration_id=OLD.registration_id) THEN
        RAISE EXCEPTION 'satellite_redeemed_artifact_delete_forbidden' USING ERRCODE='23514';
      END IF;
    ELSIF TG_TABLE_NAME='tournament_seats' THEN
      IF EXISTS(SELECT 1 FROM public.tournament_entries e
          JOIN public.satellite_ticket_value_transfers x
            ON x.registration_id=e.registration_id WHERE e.id=OLD.entry_id) THEN
        RAISE EXCEPTION 'satellite_redeemed_artifact_delete_forbidden' USING ERRCODE='23514';
      END IF;
    ELSIF TG_TABLE_NAME='seat_draw_receipts' THEN
      IF EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers x
          WHERE x.registration_id=OLD.registration_id) THEN
        RAISE EXCEPTION 'satellite_redeemed_artifact_delete_forbidden' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME='tournament_entries' THEN
    IF EXISTS (SELECT 1 FROM public.satellite_redemption_reversals x
        WHERE x.entry_id=OLD.id) AND NEW.status IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'satellite_reversed_entry_immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='tournament_seats' THEN
    IF EXISTS (SELECT 1 FROM public.satellite_redemption_reversals x
        WHERE x.seat_id=OLD.id)
       AND (NEW.is_active OR NEW.status IS DISTINCT FROM 'cancelled') THEN
      RAISE EXCEPTION 'satellite_reversed_seat_immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='seat_draw_receipts' THEN
    IF EXISTS (SELECT 1 FROM public.satellite_redemption_reversals x
        WHERE x.receipt_id=OLD.id) AND NEW.status IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'satellite_reversed_receipt_immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_reversed_operational_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_reversed_entry_guard_v1 BEFORE UPDATE OR DELETE
  ON public.tournament_entries FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reversed_operational_guard_v1();
CREATE TRIGGER satellite_reversed_seat_guard_v1 BEFORE UPDATE OR DELETE
  ON public.tournament_seats FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reversed_operational_guard_v1();
CREATE TRIGGER satellite_reversed_receipt_guard_v1 BEFORE UPDATE OR DELETE
  ON public.seat_draw_receipts FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reversed_operational_guard_v1();

CREATE OR REPLACE FUNCTION private.satellite_voucher_registration_delete_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers x
      WHERE x.registration_id=OLD.id) THEN
    RAISE EXCEPTION 'satellite_redeemed_artifact_delete_forbidden' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.satellite_voucher_registration_delete_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_voucher_registration_delete_v1 BEFORE DELETE
  ON public.tournament_registrations FOR EACH ROW
  EXECUTE FUNCTION private.satellite_voucher_registration_delete_v1();

CREATE OR REPLACE FUNCTION public.satellite_approve_redemption_reversal_v1(
  p_ticket_id uuid,p_correction_request_id uuid,p_approved_reason text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid:=auth.uid();
        v_prior public.satellite_redemption_reversals%ROWTYPE;
        v_ticket public.satellite_tickets%ROWTYPE;
        v_transfer public.satellite_ticket_value_transfers%ROWTYPE;
        v_reg public.tournament_registrations%ROWTYPE;
        v_entry public.tournament_entries%ROWTYPE;
        v_seat public.tournament_seats%ROWTYPE;
        v_receipt public.seat_draw_receipts%ROWTYPE;
        v_correction public.satellite_redemption_correction_requests%ROWTYPE;
        v_tour public.tournaments%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_ticket_id IS NULL OR p_correction_request_id IS NULL
     OR p_request_id IS NULL
     OR length(pg_catalog.btrim(coalesce(p_approved_reason,''))) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'satellite_reversal_request_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_ticket FROM public.satellite_tickets WHERE id=p_ticket_id;
  IF NOT FOUND OR v_ticket.status IS DISTINCT FROM 'redeemed' THEN
    RAISE EXCEPTION 'satellite_reversal_ticket_not_redeemed' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clubs c
    WHERE c.id=v_ticket.club_id AND c.owner_id=v_actor) THEN
    RAISE EXCEPTION 'satellite_reversal_owner_required' USING ERRCODE='42501';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_ticket.club_id);
  SELECT * INTO v_prior FROM public.satellite_redemption_reversals
    WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.actor_id IS DISTINCT FROM v_actor
       OR v_prior.ticket_id IS DISTINCT FROM p_ticket_id
       OR v_prior.correction_request_id IS DISTINCT FROM p_correction_request_id
       OR v_prior.approved_reason IS DISTINCT FROM pg_catalog.btrim(p_approved_reason) THEN
      RAISE EXCEPTION 'satellite_reversal_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'status','reversed',
      'ticketId',p_ticket_id,'requestId',p_request_id,'idempotent',true);
  END IF;
  -- Match Cashier reg-first lock order. The tournament row then fences hand
  -- inserts, direct registration creation and voucher seat/receipt changes.
  SELECT * INTO v_reg FROM public.tournament_registrations
    WHERE id=v_ticket.registration_id FOR UPDATE;
  SELECT * INTO v_tour FROM public.tournaments
    WHERE id=v_ticket.target_tournament_id FOR UPDATE;
  SELECT * INTO v_ticket FROM public.satellite_tickets
    WHERE id=p_ticket_id FOR UPDATE;
  SELECT * INTO v_prior FROM public.satellite_redemption_reversals
    WHERE ticket_id=p_ticket_id;
  IF FOUND THEN
    RAISE EXCEPTION 'satellite_ticket_already_reversed' USING ERRCODE='23505';
  END IF;
  SELECT * INTO v_transfer FROM public.satellite_ticket_value_transfers
    WHERE ticket_id=p_ticket_id;
  SELECT * INTO v_correction FROM public.satellite_redemption_correction_requests
    WHERE request_id=p_correction_request_id;
  IF v_reg.id IS NULL OR v_tour.id IS NULL OR v_transfer.id IS NULL
     OR v_correction.request_id IS NULL
     OR v_correction.ticket_id IS DISTINCT FROM p_ticket_id
     OR v_correction.transfer_id IS DISTINCT FROM v_transfer.id
     OR v_ticket.status IS DISTINCT FROM 'redeemed'
     OR v_reg.id IS DISTINCT FROM v_transfer.registration_id
     OR v_reg.status IS DISTINCT FROM 'confirmed'
     OR v_reg.club_id IS DISTINCT FROM v_ticket.club_id
     OR v_reg.player_id IS DISTINCT FROM v_ticket.redeemed_for_player_id
     OR v_tour.id IS DISTINCT FROM v_reg.tournament_id
     OR v_tour.status::text NOT IN ('scheduled','registering','live','active') THEN
    RAISE EXCEPTION 'satellite_reversal_evidence_not_ready' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_entry FROM public.tournament_entries
    WHERE registration_id=v_reg.id FOR UPDATE;
  SELECT * INTO v_seat FROM public.tournament_seats
    WHERE entry_id=v_entry.id FOR UPDATE;
  SELECT * INTO v_receipt FROM public.seat_draw_receipts
    WHERE registration_id=v_reg.id AND entry_id=v_entry.id FOR UPDATE;
  IF v_entry.id IS NULL OR v_seat.id IS NULL OR v_receipt.id IS NULL
     OR v_entry.status IS DISTINCT FROM 'seated'
     OR v_entry.player_id IS DISTINCT FROM v_reg.player_id
     OR v_entry.current_stack IS DISTINCT FROM v_tour.starting_stack
     OR v_seat.player_id IS DISTINCT FROM v_reg.player_id
     OR v_seat.is_active IS DISTINCT FROM true
     OR v_seat.status IS DISTINCT FROM 'active'
     OR v_seat.chip_count IS DISTINCT FROM v_tour.starting_stack
     OR v_receipt.status NOT IN ('issued','printed')
     OR v_receipt.seat_id IS DISTINCT FROM v_seat.id
     OR (SELECT count(*) FROM public.tournament_entries e
         WHERE e.registration_id=v_reg.id)<>1
     OR (SELECT count(*) FROM public.tournament_seats s
         WHERE s.entry_id=v_entry.id)<>1
     OR (SELECT count(*) FROM public.seat_draw_receipts r
         WHERE r.registration_id=v_reg.id)<>1
     OR EXISTS (SELECT 1 FROM public.tournament_hands h
         WHERE h.tournament_id=v_tour.id)
     OR EXISTS (SELECT 1 FROM public.tournament_chip_counts c
         WHERE c.tournament_id=v_tour.id AND c.player_id=v_reg.player_id
           AND c.entry_number=v_entry.entry_no)
     OR (SELECT count(*) FROM public.seat_assignment_history h
         WHERE h.entry_id=v_entry.id)<>1 THEN
    RAISE EXCEPTION 'satellite_reversal_unsafe_after_play_or_move' USING ERRCODE='23514';
  END IF;
  PERFORM pg_catalog.set_config('app.satellite_reversal_request_id',p_request_id::text,true);
  INSERT INTO public.satellite_redemption_reversals(
    request_id,correction_request_id,ticket_id,original_transfer_id,
    source_tournament_id,target_tournament_id,registration_id,entry_id,
    seat_id,receipt_id,club_id,target_debit_vnd,source_credit_vnd,
    actor_id,approved_reason)
  VALUES(p_request_id,p_correction_request_id,p_ticket_id,v_transfer.id,
    v_transfer.source_tournament_id,v_transfer.target_tournament_id,v_reg.id,
    v_entry.id,v_seat.id,v_receipt.id,v_ticket.club_id,
    v_transfer.target_credit_vnd,v_transfer.source_debit_vnd,
    v_actor,pg_catalog.btrim(p_approved_reason));
  UPDATE public.seat_draw_receipts SET status='cancelled',cancelled_at=now()
    WHERE id=v_receipt.id;
  UPDATE public.tournament_seats SET status='cancelled',is_active=false
    WHERE id=v_seat.id;
  UPDATE public.tournament_entries SET status='cancelled' WHERE id=v_entry.id;
  UPDATE public.tournament_registrations SET status='cancelled',cancelled_at=now(),
    cancelled_by=v_actor,cancellation_reason='Satellite redemption reversal '
      ||p_request_id::text WHERE id=v_reg.id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','reversed',
    'ticketId',p_ticket_id,'requestId',p_request_id,
    'correctionRequestId',p_correction_request_id,'registrationId',v_reg.id,
    'entryId',v_entry.id,'seatId',v_seat.id,'receiptId',v_receipt.id,
    'targetDebitVnd',v_transfer.target_credit_vnd::text,
    'sourceCreditVnd',v_transfer.source_debit_vnd::text,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.satellite_approve_redemption_reversal_v1(uuid,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_approve_redemption_reversal_v1(uuid,uuid,text,uuid)
  TO authenticated;

-- Cashier lookup never returns the bearer secret. Exact code is an input only.
CREATE OR REPLACE FUNCTION public.satellite_verify_ticket_v1(p_code uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid:=auth.uid(); v_ticket public.satellite_tickets%ROWTYPE;
        v_reversal public.satellite_redemption_reversals%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_code IS NULL THEN
    RAISE EXCEPTION 'satellite_verify_request_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_ticket FROM public.satellite_tickets
    WHERE redemption_code=p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'satellite_ticket_not_current' USING ERRCODE='22023';
  END IF;
  IF NOT (public.is_club_cashier(v_actor,v_ticket.club_id)
    OR EXISTS(SELECT 1 FROM public.clubs c
      WHERE c.id=v_ticket.club_id AND c.owner_id=v_actor)) THEN
    RAISE EXCEPTION 'satellite_cashier_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_reversal FROM public.satellite_redemption_reversals
    WHERE ticket_id=v_ticket.id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'ticketId',v_ticket.id,
    'status',CASE WHEN v_reversal.request_id IS NULL THEN v_ticket.status
                  ELSE 'reversed' END,
    'serial',v_ticket.serial_no,'winnerPlayerId',v_ticket.winner_player_id,
    'redeemedForPlayerId',v_ticket.redeemed_for_player_id,
    'sourceTournamentId',v_ticket.source_tournament_id,
    'targetTournamentId',v_ticket.target_tournament_id,
    'targetEntryPriceVnd',v_ticket.target_entry_price_vnd::text,
    'targetBuyInVnd',v_ticket.target_buy_in_vnd::text,
    'targetFeeVnd',v_ticket.target_fee_vnd::text,
    'registrationId',v_ticket.registration_id,
    'reversalRequestId',v_reversal.request_id);
END $$;
REVOKE ALL ON FUNCTION public.satellite_verify_ticket_v1(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_verify_ticket_v1(uuid)
  TO authenticated;

-- A reloadable receipt is scoped to the original actor and exact request.
CREATE OR REPLACE FUNCTION public.satellite_get_redemption_receipt_v1(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid:=auth.uid(); v_request public.satellite_redemption_requests%ROWTYPE;
        v_reversal public.satellite_redemption_reversals%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'satellite_receipt_request_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_request FROM public.satellite_redemption_requests
    WHERE request_id=p_request_id;
  IF NOT FOUND OR v_request.actor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'satellite_receipt_not_found' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_reversal FROM public.satellite_redemption_reversals
    WHERE ticket_id=v_request.ticket_id;
  RETURN v_request.response || pg_catalog.jsonb_build_object(
    'status',CASE WHEN v_reversal.request_id IS NULL THEN 'redeemed'
                  ELSE 'reversed' END,
    'reversalRequestId',v_reversal.request_id);
END $$;
REVOKE ALL ON FUNCTION public.satellite_get_redemption_receipt_v1(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_get_redemption_receipt_v1(uuid)
  TO authenticated;

-- TD private ledger extends the existing response with ticket IDs needed by
-- rotate/void. It remains owner/Floor/super-admin scoped, never a TV RPC.
CREATE OR REPLACE FUNCTION public.satellite_get_issuance_v1(p_source_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid:=auth.uid(); v_issue public.satellite_award_issues%ROWTYPE;
        v_tickets jsonb;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_issue FROM public.satellite_award_issues
    WHERE source_tournament_id=p_source_tournament_id;
  IF NOT FOUND THEN
    PERFORM public.satellite_get_award_plan_v1(p_source_tournament_id);
    RETURN pg_catalog.jsonb_build_object('ok',true,'issued',false);
  END IF;
  IF NOT (EXISTS(SELECT 1 FROM public.clubs c
      WHERE c.id=v_issue.club_id AND c.owner_id=v_actor)
      OR public.is_club_floor(v_actor,v_issue.club_id)
      OR public.has_role(v_actor,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',t.id,'serial',t.serial_no,
    'code',CASE WHEN t.status='issued' THEN t.redemption_code ELSE NULL END,
    'position',t.award_position,'winnerPlayerId',t.winner_player_id,
    'targetTournamentId',t.target_tournament_id,
    'targetEntryPriceVnd',t.target_entry_price_vnd::text,'status',t.status)
    ORDER BY t.serial_no),'[]'::jsonb) INTO v_tickets
    FROM public.satellite_tickets t
    WHERE t.source_tournament_id=p_source_tournament_id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'issued',true,
    'ticketTotal',v_issue.ticket_total,
    'cashTotalVnd',v_issue.cash_total_vnd::text,
    'results',v_issue.locked_results,'tickets',v_tickets,
    'issuedAt',v_issue.issued_at);
END $$;
