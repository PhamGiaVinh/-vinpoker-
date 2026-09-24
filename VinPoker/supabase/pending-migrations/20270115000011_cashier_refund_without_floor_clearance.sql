-- Cashier may pay a fully verified, unseated buy-in refund without a Floor click.
-- Existing requested/floor_cleared rows remain valid; no ledger row is rewritten.
-- ROLLBACK: stop Cashier refund actions, then restore the reviewed v1 function in
-- 20270115000003 with a new migration. Keep refund and movement history intact.
CREATE OR REPLACE FUNCTION public.cashier_complete_refund_v1(
  p_refund_id uuid,p_cash_amount bigint,p_bank_amount bigint,p_bank_reference text,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_ref public.cashier_refund_requests%ROWTYPE;
  v_reg public.tournament_registrations%ROWTYPE; v_tour public.tournaments%ROWTYPE;
  v_shift uuid; v_paid bigint;
BEGIN
  IF v_actor IS NULL OR p_cash_amount IS NULL OR p_bank_amount IS NULL
    OR p_cash_amount<0 OR p_bank_amount<0 OR length(btrim(coalesce(p_evidence,'')))<8 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  SELECT * INTO v_ref FROM public.cashier_refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_cashier(v_actor,v_ref.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF v_ref.status='paid' THEN RETURN jsonb_build_object('ok',true,'already_paid',true); END IF;
  IF v_ref.status NOT IN ('requested','floor_cleared')
    OR p_cash_amount+p_bank_amount<>v_ref.amount THEN
    RETURN jsonb_build_object('ok',false,'error','refund_amount_or_status_invalid'); END IF;
  IF p_bank_amount>0 AND length(btrim(coalesce(p_bank_reference,'')))<4 THEN
    RETURN jsonb_build_object('ok',false,'error','bank_reference_required'); END IF;
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id=v_ref.registration_id FOR UPDATE;
  SELECT * INTO v_tour FROM public.tournaments WHERE id=v_ref.tournament_id FOR UPDATE;
  IF v_ref.club_id IS DISTINCT FROM v_tour.club_id
    OR v_reg.club_id IS DISTINCT FROM v_ref.club_id
    OR v_reg.tournament_id IS DISTINCT FROM v_ref.tournament_id THEN
    RETURN jsonb_build_object('ok',false,'error','refund_scope_mismatch'); END IF;
  IF v_reg.status NOT IN ('pending','confirmed') OR v_tour.status IN ('completed','cancelled')
    OR public.is_tournament_registration_closed(v_tour.id)
    OR EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=v_tour.id)
    OR EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=v_tour.id) THEN
    RETURN jsonb_build_object('ok',false,'error','refund_window_closed'); END IF;
  SELECT coalesce(sum(applied_amount),0) INTO v_paid FROM public.cashier_buyin_movements
    WHERE registration_id=v_reg.id AND purpose='buyin' AND direction='in';
  IF v_paid<>v_ref.amount OR v_ref.amount<>v_reg.total_pay THEN
    RETURN jsonb_build_object('ok',false,'error','verified_payment_history_required'); END IF;
  -- A new request bypasses Floor only for this registration's unseated,
  -- unplayed waiting state. Historical/busted turns retain the v1 Floor path.
  IF v_ref.status='requested' AND (v_reg.status<>'pending'
    OR v_reg.cashier_seating_error IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.registration_id=v_reg.id)
    OR EXISTS(SELECT 1 FROM public.seat_draw_receipts d WHERE d.registration_id=v_reg.id)) THEN
    RETURN jsonb_build_object('ok',false,'error','floor_clearance_required'); END IF;
  -- Cashier auto-seating locks this same registration. If it wins the race,
  -- this check refuses payout; active play is never cleared here.
  IF EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.registration_id=v_reg.id
    AND e.status NOT IN ('busted','registered','cancelled'))
    OR EXISTS(SELECT 1 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
      WHERE e.registration_id=v_reg.id AND (s.is_active OR s.chip_count<>0)) THEN
    RETURN jsonb_build_object('ok',false,'error','active_seat_or_chips'); END IF;
  IF p_cash_amount>0 THEN
    SELECT id INTO v_shift FROM public.cashier_till_shifts WHERE club_id=v_ref.club_id
      AND closed_at IS NULL FOR UPDATE;
    IF v_shift IS NULL THEN RETURN jsonb_build_object('ok',false,'error','shift_not_open'); END IF;
    INSERT INTO public.cashier_buyin_movements
      (club_id,tournament_id,registration_id,shift_id,refund_id,direction,method,purpose,
       amount,applied_amount,actor_id,idempotency_key,reason)
    VALUES(v_ref.club_id,v_ref.tournament_id,v_ref.registration_id,v_shift,v_ref.id,'out','cash','refund',
      p_cash_amount,p_cash_amount,v_actor,'refund:cash:'||v_ref.id::text,v_ref.reason);
  END IF;
  IF p_bank_amount>0 THEN
    INSERT INTO public.cashier_buyin_movements
      (club_id,tournament_id,registration_id,refund_id,direction,method,purpose,
       amount,applied_amount,actor_id,idempotency_key,reason)
    VALUES(v_ref.club_id,v_ref.tournament_id,v_ref.registration_id,v_ref.id,'out','bank','refund',
      p_bank_amount,p_bank_amount,v_actor,'refund:bank:'||v_ref.id::text,btrim(p_bank_reference));
  END IF;
  UPDATE public.cashier_refund_requests SET status='paid',paid_by=v_actor,paid_at=now(),
    bank_reference=nullif(btrim(coalesce(p_bank_reference,'')),''),evidence=btrim(p_evidence)
    WHERE id=v_ref.id;
  UPDATE public.tournament_entries SET status='cancelled',current_stack=0
    WHERE registration_id=v_reg.id AND status='registered';
  UPDATE public.seat_draw_receipts SET status='cancelled',cancelled_at=now()
    WHERE registration_id=v_reg.id AND status IN ('issued','printed');
  UPDATE public.tournament_registrations SET status='cancelled',cancelled_at=now(),
    cancelled_by=v_actor,cancellation_reason='cashier_refund:'||v_ref.id::text WHERE id=v_reg.id;
  RETURN jsonb_build_object('ok',true,'refund_id',v_ref.id,'amount',v_ref.amount);
END $$;
REVOKE ALL ON FUNCTION public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text) TO authenticated;
