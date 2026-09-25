-- SOURCE ONLY. Atomic voucher-funded target registration and seat receipt.
-- Requires the existing production confirm_registration_and_assign_seat and
-- confirm_reentry_and_assign_seat RPCs. A missing re-entry RPC fails closed.
-- No cash/bank collection is created by this path. Correction requests are
-- append-only and held; no compensating transfer/reversal executes yet. Do not
-- promote this migration independently to production UAT.
-- ROLLBACK: revoke Redeem EXECUTE in a forward migration. Retain transfer and
-- ticket/registration/seat history; never delete a financial movement.

CREATE TABLE IF NOT EXISTS public.satellite_ticket_value_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.satellite_tickets(id) ON DELETE RESTRICT,
  source_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  target_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  registration_id uuid NOT NULL UNIQUE REFERENCES public.tournament_registrations(id),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  source_debit_vnd bigint NOT NULL CHECK (source_debit_vnd > 0),
  target_credit_vnd bigint NOT NULL CHECK (target_credit_vnd > 0),
  target_buy_in_vnd bigint NOT NULL CHECK (target_buy_in_vnd > 0),
  target_rake_vnd bigint NOT NULL CHECK (target_rake_vnd >= 0),
  target_service_fee_vnd bigint NOT NULL CHECK (target_service_fee_vnd >= 0),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  redeemed_for_player_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_transfer_conservation_v1 CHECK (
    source_debit_vnd=target_credit_vnd AND
    target_credit_vnd::numeric=target_buy_in_vnd::numeric+
      target_rake_vnd::numeric+target_service_fee_vnd::numeric)
);
ALTER TABLE public.satellite_ticket_value_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_ticket_value_transfers
  FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.satellite_transfer_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'satellite_ticket_transfer_append_only' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION private.satellite_transfer_immutable_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_transfer_immutable_v1
  BEFORE UPDATE OR DELETE ON public.satellite_ticket_value_transfers
  FOR EACH ROW EXECUTE FUNCTION private.satellite_transfer_immutable_v1();

CREATE OR REPLACE FUNCTION private.satellite_transfer_insert_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.satellite_tickets%ROWTYPE;
        v_reg public.tournament_registrations%ROWTYPE;
        v_plan public.satellite_award_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket FROM public.satellite_tickets WHERE id=NEW.ticket_id;
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id=NEW.registration_id;
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id=v_ticket.source_tournament_id;
  IF NOT FOUND OR v_ticket.status IS DISTINCT FROM 'issued'
     OR v_ticket.source_tournament_id IS DISTINCT FROM NEW.source_tournament_id
     OR v_ticket.target_tournament_id IS DISTINCT FROM NEW.target_tournament_id
     OR v_ticket.club_id IS DISTINCT FROM NEW.club_id
     OR v_ticket.target_entry_price_vnd IS DISTINCT FROM NEW.source_debit_vnd
     OR v_ticket.target_buy_in_vnd IS DISTINCT FROM NEW.target_buy_in_vnd
     OR v_ticket.target_rake_vnd IS DISTINCT FROM NEW.target_rake_vnd
     OR v_ticket.target_service_fee_vnd IS DISTINCT FROM NEW.target_service_fee_vnd
     OR v_plan.obligation_shortfall_vnd IS DISTINCT FROM 0
     OR v_plan.funding_state IS DISTINCT FROM 'NO_SHORTFALL'
     OR v_reg.tournament_id IS DISTINCT FROM NEW.target_tournament_id
     OR v_reg.player_id IS DISTINCT FROM NEW.redeemed_for_player_id
     OR v_reg.club_id IS DISTINCT FROM NEW.club_id
     OR v_reg.buy_in IS DISTINCT FROM NEW.target_buy_in_vnd
     OR v_reg.total_pay IS DISTINCT FROM NEW.target_credit_vnd
     OR v_reg.status IS DISTINCT FROM 'pending'
     OR v_reg.price_snapshot->>'tender' IS DISTINCT FROM 'satellite_ticket'
     OR v_reg.price_snapshot->>'ticket_id' IS DISTINCT FROM NEW.ticket_id::text
     OR NEW.actor_id IS DISTINCT FROM auth.uid()
     OR NEW.request_id::text IS DISTINCT FROM
        pg_catalog.current_setting('app.satellite_redeem_request_id',true) THEN
    RAISE EXCEPTION 'satellite_transfer_evidence_invalid' USING ERRCODE='23514';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(NEW.club_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_transfer_insert_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_transfer_insert_guard_v1
  BEFORE INSERT ON public.satellite_ticket_value_transfers
  FOR EACH ROW EXECUTE FUNCTION private.satellite_transfer_insert_guard_v1();

CREATE TABLE IF NOT EXISTS public.satellite_redemption_requests (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  redeemed_for_player_id uuid NOT NULL REFERENCES auth.users(id),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{32}$'),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.satellite_tickets(id),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.satellite_redemption_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_redemption_requests
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_redemption_request_immutable_v1
  BEFORE UPDATE OR DELETE ON public.satellite_redemption_requests
  FOR EACH ROW EXECUTE FUNCTION private.satellite_transfer_immutable_v1();

-- All inserts for a ticket target (including direct RLS/service-role and
-- canonical offline Cashier) join the same tournament-row serialization as
-- Redeem. A cancelled historical attempt is not an active participation.
-- Busted history permits re-entry only with the precise prior entry ID.
CREATE OR REPLACE FUNCTION private.satellite_target_registration_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_latest public.tournament_entries%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.satellite_tickets t
    WHERE t.target_tournament_id=NEW.tournament_id
      AND t.status IN ('issued','redeemed')) THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.tournaments WHERE id=NEW.tournament_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.tournament_seats s
    WHERE s.tournament_id=NEW.tournament_id
      AND s.player_id=NEW.player_id AND s.is_active) THEN
    RAISE EXCEPTION 'satellite_target_player_already_seated' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_latest FROM public.tournament_entries e
    WHERE e.tournament_id=NEW.tournament_id AND e.player_id=NEW.player_id
    ORDER BY e.entry_no DESC,e.id DESC LIMIT 1;
  IF NEW.source_entry_id IS NULL THEN
    IF v_latest.id IS NOT NULL THEN
      RAISE EXCEPTION 'satellite_target_reentry_source_required' USING ERRCODE='23514';
    END IF;
  ELSIF v_latest.id IS DISTINCT FROM NEW.source_entry_id
     OR v_latest.status IS DISTINCT FROM 'busted'
     OR public.is_tournament_registration_closed(NEW.tournament_id) THEN
    RAISE EXCEPTION 'satellite_target_reentry_not_eligible' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_target_registration_fence_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_target_registration_fence_v1 BEFORE INSERT
  ON public.tournament_registrations FOR EACH ROW
  EXECUTE FUNCTION private.satellite_target_registration_fence_v1();

-- Keep the existing Cashier guard's cash behavior, but count only an exact
-- voucher credit for a voucher-priced registration. Cash and voucher cannot
-- be combined on one registration, and cancellation needs a reversal path.
CREATE OR REPLACE FUNCTION public.cashier_paid_registration_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_paid bigint; v_ticket_credit bigint;
BEGIN
  IF OLD.price_snapshot IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(m.applied_amount),0) INTO v_paid
    FROM public.cashier_buyin_movements m WHERE m.registration_id=OLD.id
      AND m.purpose='buyin' AND m.direction='in';
  SELECT coalesce(sum(t.target_credit_vnd),0) INTO v_ticket_credit
    FROM public.satellite_ticket_value_transfers t WHERE t.registration_id=OLD.id;
  IF NEW.total_pay IS DISTINCT FROM OLD.total_pay OR
     NEW.buy_in IS DISTINCT FROM OLD.buy_in OR
     NEW.reference_code IS DISTINCT FROM OLD.reference_code OR
     NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot THEN
    RAISE EXCEPTION 'Server-priced registration is immutable';
  END IF;
  IF OLD.price_snapshot->>'tender'='satellite_ticket' THEN
    IF v_paid<>0 OR v_ticket_credit NOT IN (0,OLD.total_pay) THEN
      RAISE EXCEPTION 'satellite_voucher_cash_or_credit_mismatch' USING ERRCODE='23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status='pending' AND NEW.status='confirmed' THEN
        IF v_ticket_credit<>OLD.total_pay THEN
          RAISE EXCEPTION 'satellite_voucher_credit_missing' USING ERRCODE='23514'; END IF;
      ELSE
        RAISE EXCEPTION 'satellite_redemption_reversal_required' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF v_ticket_credit<>0 THEN
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

CREATE OR REPLACE FUNCTION private.satellite_no_cash_on_voucher_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.registration_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_registrations r
    WHERE r.id=NEW.registration_id
      AND r.price_snapshot->>'tender'='satellite_ticket') THEN
    RAISE EXCEPTION 'satellite_voucher_no_cash_collection' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_no_cash_on_voucher_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_no_cash_on_voucher_v1 BEFORE INSERT
  ON public.cashier_buyin_movements FOR EACH ROW
  EXECUTE FUNCTION private.satellite_no_cash_on_voucher_v1();
CREATE TRIGGER satellite_no_cash_refund_on_voucher_v1 BEFORE INSERT
  ON public.cashier_refund_requests FOR EACH ROW
  EXECUTE FUNCTION private.satellite_no_cash_on_voucher_v1();

-- Preserve Issue/rotate/void guard and admit only a fully receipted transition
-- to redeemed. Existing ticket money/award/serial fields remain immutable.
CREATE OR REPLACE FUNCTION private.satellite_ticket_write_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_issue public.satellite_award_issues%ROWTYPE;
        v_event public.satellite_ticket_secret_events%ROWTYPE;
        v_transfer public.satellite_ticket_value_transfers%ROWTYPE;
        v_request uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'satellite_ticket_immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_issue FROM public.satellite_award_issues
      WHERE source_tournament_id=NEW.source_tournament_id;
    IF NOT FOUND OR v_issue.issue_request_id IS NULL
       OR v_issue.issue_request_id::text IS DISTINCT FROM
          pg_catalog.current_setting('app.satellite_issue_request_id',true)
       OR NEW.club_id IS DISTINCT FROM v_issue.club_id
       OR NEW.serial_no > v_issue.ticket_total
       OR NEW.status IS DISTINCT FROM 'issued'
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_issue.locked_results) x(value)
                      WHERE (x.value->>'position')::integer=NEW.award_position
                        AND (x.value->>'playerId')::uuid=NEW.winner_player_id) THEN
      RAISE EXCEPTION 'satellite_verified_ticket_issue_required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='issued' AND NEW.status='redeemed' THEN
    v_request:=nullif(pg_catalog.current_setting('app.satellite_redeem_request_id',true),'')::uuid;
    SELECT * INTO v_transfer FROM public.satellite_ticket_value_transfers
      WHERE ticket_id=OLD.id AND request_id=v_request;
    IF NOT FOUND OR NEW.redemption_code IS DISTINCT FROM OLD.redemption_code
       OR NEW.redeemed_at IS NULL OR NEW.redeemed_by IS DISTINCT FROM auth.uid()
       OR NEW.redeemed_for_player_id IS DISTINCT FROM v_transfer.redeemed_for_player_id
       OR NEW.registration_id IS DISTINCT FROM v_transfer.registration_id
       OR (pg_catalog.to_jsonb(NEW)-ARRAY['status','redeemed_at','redeemed_by',
           'redeemed_for_player_id','registration_id'])
          IS DISTINCT FROM
          (pg_catalog.to_jsonb(OLD)-ARRAY['status','redeemed_at','redeemed_by',
           'redeemed_for_player_id','registration_id'])
       OR NOT EXISTS (SELECT 1 FROM public.tournament_registrations r
         WHERE r.id=NEW.registration_id AND r.status='confirmed'
           AND r.confirmed_by=auth.uid())
       OR NOT EXISTS (SELECT 1 FROM public.tournament_entries e
         JOIN public.seat_draw_receipts s ON s.entry_id=e.id
         WHERE e.registration_id=NEW.registration_id
           AND e.player_id=NEW.redeemed_for_player_id
           AND e.status<>'cancelled' AND s.status IN ('issued','printed')) THEN
      RAISE EXCEPTION 'satellite_redemption_evidence_invalid' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  v_request:=nullif(pg_catalog.current_setting('app.satellite_secret_request_id',true),'')::uuid;
  SELECT * INTO v_event FROM public.satellite_ticket_secret_events
    WHERE request_id=v_request AND ticket_id=OLD.id AND actor_id=auth.uid();
  IF NOT FOUND OR OLD.status IS DISTINCT FROM 'issued'
     OR (pg_catalog.to_jsonb(NEW)-ARRAY['redemption_code','status','voided_at','voided_by','void_reason'])
        IS DISTINCT FROM
        (pg_catalog.to_jsonb(OLD)-ARRAY['redemption_code','status','voided_at','voided_by','void_reason'])
     OR v_event.old_code_hash IS DISTINCT FROM pg_catalog.md5(OLD.redemption_code::text)
     OR (v_event.action='rotate' AND (
          NEW.status IS DISTINCT FROM 'issued' OR NEW.redemption_code=OLD.redemption_code
          OR v_event.new_code_hash IS DISTINCT FROM pg_catalog.md5(NEW.redemption_code::text)
          OR ROW(NEW.voided_at,NEW.voided_by,NEW.void_reason)
             IS DISTINCT FROM ROW(OLD.voided_at,OLD.voided_by,OLD.void_reason)))
     OR (v_event.action='void' AND (
          NEW.status IS DISTINCT FROM 'voided' OR NEW.redemption_code IS DISTINCT FROM OLD.redemption_code
          OR NEW.voided_at IS NULL OR NEW.voided_by IS DISTINCT FROM auth.uid()
          OR NEW.void_reason IS DISTINCT FROM v_event.reason)) THEN
    RAISE EXCEPTION 'satellite_ticket_mutation_not_allowed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.satellite_redeem_ticket_v1(
  p_current_code uuid,p_request_id uuid,p_redeemed_for_player_id uuid,
  p_source_entry_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hash text;
  v_prior public.satellite_redemption_requests%ROWTYPE;
  v_ticket public.satellite_tickets%ROWTYPE;
  v_tour public.tournaments%ROWTYPE;
  v_latest public.tournament_entries%ROWTYPE;
  v_reg_id uuid;
  v_ref text;
  v_result jsonb;
  v_role text;
  v_attempt integer;
BEGIN
  IF v_actor IS NULL OR p_current_code IS NULL OR p_request_id IS NULL
     OR p_redeemed_for_player_id IS NULL THEN
    RAISE EXCEPTION 'satellite_redeem_request_invalid' USING ERRCODE='22023';
  END IF;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
    'code',p_current_code,'sourceEntry',p_source_entry_id,
    'player',p_redeemed_for_player_id)::text);
  SELECT * INTO v_prior FROM public.satellite_redemption_requests
    WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.actor_id IS DISTINCT FROM v_actor
       OR v_prior.redeemed_for_player_id IS DISTINCT FROM p_redeemed_for_player_id
       OR v_prior.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'satellite_redeem_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN v_prior.response || pg_catalog.jsonb_build_object('idempotent',true);
  END IF;
  SELECT * INTO v_ticket FROM public.satellite_tickets
    WHERE redemption_code=p_current_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'satellite_ticket_not_current' USING ERRCODE='22023';
  END IF;
  -- Common player+tournament serialization, even with no participation row.
  -- Cashier app registration and canonical offline buy-in also use this row.
  -- Do not take an existing registration lock: Cashier confirm is reg-first.
  SELECT * INTO v_tour FROM public.tournaments
    WHERE id=v_ticket.target_tournament_id FOR UPDATE;
  SELECT * INTO v_prior FROM public.satellite_redemption_requests
    WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.actor_id IS DISTINCT FROM v_actor
       OR v_prior.redeemed_for_player_id IS DISTINCT FROM p_redeemed_for_player_id
       OR v_prior.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'satellite_redeem_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN v_prior.response || pg_catalog.jsonb_build_object('idempotent',true);
  END IF;
  SELECT * INTO v_ticket FROM public.satellite_tickets
    WHERE id=v_ticket.id FOR UPDATE;
  IF v_ticket.status IS DISTINCT FROM 'issued'
     OR v_ticket.redemption_code IS DISTINCT FROM p_current_code
     OR v_tour.club_id IS DISTINCT FROM v_ticket.club_id
     OR v_tour.operations_mode IS DISTINCT FROM 'standard'
     OR v_tour.status::text NOT IN ('scheduled','live','active','registering')
     OR public.is_tournament_registration_closed(v_tour.id)
     OR v_ticket.target_buy_in_vnd IS NULL
     OR v_ticket.target_rake_vnd IS NULL
     OR v_ticket.target_service_fee_vnd IS NULL THEN
    RAISE EXCEPTION 'satellite_ticket_or_target_not_ready' USING ERRCODE='23514';
  END IF;
  IF NOT (public.is_club_cashier(v_actor,v_ticket.club_id)
    OR EXISTS (SELECT 1 FROM public.clubs c
               WHERE c.id=v_ticket.club_id AND c.owner_id=v_actor)) THEN
    RAISE EXCEPTION 'satellite_cashier_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_ticket.club_id);
  IF NOT public.cashier_tour_active_v1(v_ticket.club_id) THEN
    RAISE EXCEPTION 'satellite_cashier_not_active' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_seats s
             WHERE s.tournament_id=v_tour.id
               AND s.player_id=p_redeemed_for_player_id AND s.is_active) THEN
    RAISE EXCEPTION 'satellite_player_already_seated' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_latest FROM public.tournament_entries e
    WHERE e.tournament_id=v_tour.id AND e.player_id=p_redeemed_for_player_id
    ORDER BY e.entry_no DESC,e.id DESC LIMIT 1;
  IF p_source_entry_id IS NULL THEN
    IF v_latest.id IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.tournament_registrations r
      WHERE r.tournament_id=v_tour.id AND r.player_id=p_redeemed_for_player_id
        AND r.status IN ('pending','confirmed')) THEN
      RAISE EXCEPTION 'satellite_initial_entry_already_exists' USING ERRCODE='23514';
    END IF;
  ELSE
    IF v_latest.id IS DISTINCT FROM p_source_entry_id
       OR v_latest.status IS DISTINCT FROM 'busted'
       OR EXISTS (SELECT 1 FROM public.tournament_registrations r
          WHERE r.source_entry_id=p_source_entry_id AND r.status IN ('pending','confirmed'))
       OR v_tour.registration_closed_at IS NOT NULL
       OR (v_tour.current_level IS NOT NULL AND
           v_tour.current_level>coalesce(v_tour.late_reg_close_level,6)) THEN
      RAISE EXCEPTION 'satellite_reentry_not_eligible' USING ERRCODE='23514';
    END IF;
    IF pg_catalog.to_regprocedure('public.confirm_reentry_and_assign_seat(uuid,uuid,text)') IS NULL THEN
      RAISE EXCEPTION 'satellite_reentry_confirm_unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  -- Only this SECURITY DEFINER path may seed a server-priced voucher row.
  -- Restore the JWT role before confirmation and on every exception.
  v_role:=pg_catalog.current_setting('request.jwt.claim.role',true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role','service_role',true);
  BEGIN
    FOR v_attempt IN 1..5 LOOP
      v_ref:='SATV-'||upper(pg_catalog.left(pg_catalog.replace(gen_random_uuid()::text,'-',''),12));
      BEGIN
        INSERT INTO public.tournament_registrations(
          tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
          reference_code,status,source_entry_id,price_snapshot)
        VALUES(v_tour.id,p_redeemed_for_player_id,v_ticket.club_id,
          v_ticket.target_buy_in_vnd,0,v_ticket.target_entry_price_vnd,
          v_ref,'pending',p_source_entry_id,
          pg_catalog.jsonb_build_object('buy_in',v_ticket.target_buy_in_vnd,
            'rake',v_ticket.target_rake_vnd,
            'service_fee',v_ticket.target_service_fee_vnd,'platform_fee',0,
            'waived_rake',0,'free_rake_applied',false,
            'total_pay',v_ticket.target_entry_price_vnd,
            'tender','satellite_ticket','ticket_id',v_ticket.id))
        RETURNING id INTO v_reg_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempt=5 THEN RAISE; END IF;
      END;
    END LOOP;
    PERFORM pg_catalog.set_config('request.jwt.claim.role',coalesce(v_role,''),true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('request.jwt.claim.role',coalesce(v_role,''),true);
    RAISE;
  END;
  PERFORM pg_catalog.set_config('app.satellite_redeem_request_id',p_request_id::text,true);
  INSERT INTO public.satellite_ticket_value_transfers(
    ticket_id,source_tournament_id,target_tournament_id,registration_id,club_id,
    source_debit_vnd,target_credit_vnd,target_buy_in_vnd,target_rake_vnd,
    target_service_fee_vnd,actor_id,redeemed_for_player_id,request_id)
  VALUES(v_ticket.id,v_ticket.source_tournament_id,v_tour.id,v_reg_id,v_ticket.club_id,
    v_ticket.target_entry_price_vnd,v_ticket.target_entry_price_vnd,
    v_ticket.target_buy_in_vnd,v_ticket.target_rake_vnd,
    v_ticket.target_service_fee_vnd,v_actor,p_redeemed_for_player_id,p_request_id);
  UPDATE public.tournament_registrations SET cashier_paid_at=now() WHERE id=v_reg_id;
  IF p_source_entry_id IS NULL THEN
    v_result:=public.confirm_registration_and_assign_seat(v_reg_id,v_actor,'random_balanced');
  ELSE
    v_result:=public.confirm_reentry_and_assign_seat(v_reg_id,v_actor,'random_balanced');
  END IF;
  IF v_result->>'ok' IS DISTINCT FROM 'true'
     OR nullif(v_result->>'entry_id','') IS NULL
     OR nullif(v_result->>'receipt_id','') IS NULL THEN
    RAISE EXCEPTION 'satellite_seating_failed: %',coalesce(v_result->>'error','missing_receipt')
      USING ERRCODE='23514';
  END IF;
  UPDATE public.satellite_tickets SET status='redeemed',redeemed_at=now(),
    redeemed_by=v_actor,redeemed_for_player_id=p_redeemed_for_player_id,
    registration_id=v_reg_id WHERE id=v_ticket.id;
  v_result:=pg_catalog.jsonb_build_object('ok',true,'ticketId',v_ticket.id,
    'sourceTournamentId',v_ticket.source_tournament_id,
    'targetTournamentId',v_tour.id,'winnerPlayerId',v_ticket.winner_player_id,
    'redeemedForPlayerId',p_redeemed_for_player_id,'registrationId',v_reg_id,
    'entryId',v_result->>'entry_id','seatId',v_result->>'seat_id',
    'receiptId',v_result->>'receipt_id','receiptCode',v_result->>'receipt_code',
    'sourceDebitVnd',v_ticket.target_entry_price_vnd::text,
    'targetCreditVnd',v_ticket.target_entry_price_vnd::text,
    'buyInVnd',v_ticket.target_buy_in_vnd::text,
    'feeVnd',v_ticket.target_fee_vnd::text,'idempotent',false);
  INSERT INTO public.satellite_redemption_requests(
    request_id,actor_id,redeemed_for_player_id,request_hash,ticket_id,response)
  VALUES(p_request_id,v_actor,p_redeemed_for_player_id,v_hash,v_ticket.id,v_result);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.satellite_redeem_ticket_v1(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_redeem_ticket_v1(uuid,uuid,uuid,uuid)
  TO authenticated;

-- A cashier/owner can preserve a correction request without mutating the
-- original transfer, ticket, registration, entry, seat or receipt. The actual
-- reversal requires a separate reviewed double-entry adjustment workflow.
CREATE TABLE IF NOT EXISTS public.satellite_redemption_correction_requests (
  request_id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.satellite_tickets(id),
  transfer_id uuid NOT NULL REFERENCES public.satellite_ticket_value_transfers(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  status text NOT NULL DEFAULT 'held' CHECK (status='held'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.satellite_redemption_correction_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_redemption_correction_requests
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER satellite_redemption_correction_immutable_v1
  BEFORE UPDATE OR DELETE ON public.satellite_redemption_correction_requests
  FOR EACH ROW EXECUTE FUNCTION private.satellite_transfer_immutable_v1();

CREATE OR REPLACE FUNCTION public.satellite_request_redemption_correction_v1(
  p_ticket_id uuid,p_reason text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid:=auth.uid();
        v_ticket public.satellite_tickets%ROWTYPE;
        v_transfer public.satellite_ticket_value_transfers%ROWTYPE;
        v_prior public.satellite_redemption_correction_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_ticket_id IS NULL OR p_request_id IS NULL
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'satellite_correction_request_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_ticket FROM public.satellite_tickets WHERE id=p_ticket_id;
  IF NOT FOUND OR v_ticket.status IS DISTINCT FROM 'redeemed' THEN
    RAISE EXCEPTION 'satellite_correction_requires_redemption' USING ERRCODE='23514';
  END IF;
  IF NOT (public.is_club_cashier(v_actor,v_ticket.club_id)
    OR EXISTS (SELECT 1 FROM public.clubs c
               WHERE c.id=v_ticket.club_id AND c.owner_id=v_actor)) THEN
    RAISE EXCEPTION 'satellite_correction_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_ticket.club_id);
  SELECT * INTO v_prior FROM public.satellite_redemption_correction_requests
    WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_prior.actor_id IS DISTINCT FROM v_actor
       OR v_prior.ticket_id IS DISTINCT FROM p_ticket_id
       OR v_prior.reason IS DISTINCT FROM btrim(p_reason) THEN
      RAISE EXCEPTION 'satellite_correction_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object('status','held','ticketId',p_ticket_id,
      'requestId',p_request_id,'idempotent',true);
  END IF;
  SELECT * INTO v_transfer FROM public.satellite_ticket_value_transfers
    WHERE ticket_id=p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'satellite_correction_transfer_missing' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.satellite_redemption_correction_requests(
    request_id,ticket_id,transfer_id,actor_id,reason)
  VALUES(p_request_id,p_ticket_id,v_transfer.id,v_actor,btrim(p_reason));
  RETURN pg_catalog.jsonb_build_object('status','held','ticketId',p_ticket_id,
    'requestId',p_request_id,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.satellite_request_redemption_correction_v1(uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_request_redemption_correction_v1(uuid,text,uuid)
  TO authenticated;
