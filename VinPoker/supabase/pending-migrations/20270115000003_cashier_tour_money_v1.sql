-- Cashier tour buy-in: one immutable record for each actual cash/bank movement.
-- Prepared source for a separate owner-gated Cashier V2 migration apply.
-- Applying schema alone leaves cashier_tour_settings.enabled false.
-- ROLLBACK: disable the Cashier V2 client and SePay worker first. Keep movement,
-- shift and refund rows for audit; restore the previous worker, then ship a new
-- migration to revoke these RPCs. Never delete recorded money history.

ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS price_snapshot jsonb;
ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS cashier_paid_at timestamptz;
ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS cashier_seating_error text;
-- SePay parses references case-insensitively; DB uniqueness must match that rule.
CREATE UNIQUE INDEX IF NOT EXISTS cashier_registration_reference_ci_unique
  ON public.tournament_registrations (upper(reference_code)) WHERE reference_code IS NOT NULL;

-- Owner-controlled server gate. Applying this migration alone changes no
-- SePay or Cashier buy-in behavior; no client can enable the gate.
CREATE TABLE IF NOT EXISTS public.cashier_tour_settings (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE public.cashier_tour_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cashier_tour_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cashier_tour_settings TO service_role;

CREATE OR REPLACE FUNCTION public.cashier_tour_active_v1(p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT enabled FROM public.cashier_tour_settings WHERE club_id=p_club_id),false)
$$;
REVOKE ALL ON FUNCTION public.cashier_tour_active_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Existing player INSERT RLS allows a self-owned registration. Once a club
-- enables the tour cashier, force app registration through the authenticated
-- Edge/server pricing path; never trust client-supplied totals or snapshots.
CREATE OR REPLACE FUNCTION public.cashier_tour_registration_insert_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tour_club uuid;
BEGIN
  SELECT t.club_id INTO v_tour_club FROM public.tournaments t WHERE t.id=NEW.tournament_id;
  IF auth.role()='authenticated' AND (public.cashier_tour_active_v1(v_tour_club)
    OR NEW.price_snapshot IS NOT NULL OR NEW.cashier_paid_at IS NOT NULL
    OR NEW.cashier_seating_error IS NOT NULL) THEN
    RAISE EXCEPTION 'Tour buy-in registration must be created by server';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cashier_tour_registration_insert_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cashier_tour_registration_insert_guard ON public.tournament_registrations;
CREATE TRIGGER cashier_tour_registration_insert_guard BEFORE INSERT
  ON public.tournament_registrations FOR EACH ROW EXECUTE FUNCTION public.cashier_tour_registration_insert_guard_v1();

-- App-authenticated Edge Function calls this with service role after validating
-- the player's token. Tour lock makes free-rake consumption and duplicate
-- registration check atomic even when 100 players arrive together.
CREATE OR REPLACE FUNCTION public.cashier_create_app_registration_v1(
  p_tournament_id uuid,p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tour public.tournaments%ROWTYPE; v_reg public.tournament_registrations%ROWTYPE;
  v_rake bigint; v_service bigint; v_total bigint; v_free boolean; v_ref text;
  v_snapshot jsonb; v_attempt integer;
BEGIN
  IF p_tournament_id IS NULL OR p_player_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tour.club_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','tournament_not_found'); END IF;
  IF NOT public.cashier_tour_active_v1(v_tour.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','cashier_tour_disabled'); END IF;
  SELECT * INTO v_reg FROM public.tournament_registrations
    WHERE tournament_id=p_tournament_id AND player_id=p_player_id
      AND status IN ('pending','confirmed') ORDER BY committed_at DESC,id DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'already_registered',true,'registration_id',v_reg.id,
      'status',v_reg.status,'reference_code',v_reg.reference_code,'total_pay',v_reg.total_pay,
      'buy_in',v_reg.buy_in,'platform_fixed_fee',v_reg.platform_fixed_fee,
      'used_free_rake',v_reg.used_free_rake,'committed_at',v_reg.committed_at,
      'price_snapshot',v_reg.price_snapshot,
      'transfer_proof_image_url',v_reg.transfer_proof_image_url,
      'transfer_proof_submitted',v_reg.transfer_proof_submitted);
  END IF;
  IF v_tour.status IN ('completed','cancelled') OR public.is_tournament_registration_closed(v_tour.id)
    OR (v_tour.start_time IS NOT NULL AND v_tour.start_time<now()-interval '1 hour') THEN
    RETURN jsonb_build_object('ok',false,'error','registration_closed'); END IF;
  IF v_tour.buy_in IS NULL OR v_tour.buy_in<=0 OR coalesce(v_tour.rake_amount,0)<0
    OR coalesce(v_tour.service_fee_amount,0)<0 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_tournament_price'); END IF;
  v_rake:=coalesce(v_tour.rake_amount,0);
  v_service:=coalesce(v_tour.service_fee_amount,0);
  v_free:=coalesce(v_tour.free_rake_enabled,false)
    AND coalesce(v_tour.free_rake_used,0)<coalesce(v_tour.free_rake_slots,0);
  v_total:=v_tour.buy_in+(CASE WHEN v_free THEN 0 ELSE v_rake END)+v_service;
  IF v_total IS NULL OR v_total<=0 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_tournament_price'); END IF;
  v_snapshot:=jsonb_build_object('buy_in',v_tour.buy_in,
    'rake',CASE WHEN v_free THEN 0 ELSE v_rake END,
    'waived_rake',CASE WHEN v_free THEN v_rake ELSE 0 END,
    'service_fee',v_service,'platform_fee',0,'total_pay',v_total,
    'free_rake_applied',v_free);
  FOR v_attempt IN 1..5 LOOP
    v_ref:='VINREG'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 8));
    BEGIN
      INSERT INTO public.tournament_registrations
        (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
         reference_code,status,used_free_rake,price_snapshot)
      VALUES(v_tour.id,p_player_id,v_tour.club_id,v_tour.buy_in,0,v_total,
        v_ref,'pending',v_free,v_snapshot) RETURNING * INTO v_reg;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt=5 THEN RAISE; END IF;
    END;
  END LOOP;
  IF v_free THEN UPDATE public.tournaments SET free_rake_used=coalesce(free_rake_used,0)+1
    WHERE id=v_tour.id; END IF;
  RETURN jsonb_build_object('ok',true,'already_registered',false,'registration_id',v_reg.id,
    'status',v_reg.status,'reference_code',v_reg.reference_code,'total_pay',v_reg.total_pay,
    'buy_in',v_reg.buy_in,'platform_fixed_fee',0,'used_free_rake',v_free,
    'committed_at',v_reg.committed_at,'price_snapshot',v_snapshot);
END $$;
REVOKE ALL ON FUNCTION public.cashier_create_app_registration_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_create_app_registration_v1(uuid,uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.cashier_till_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  opening_cash bigint NOT NULL CHECK (opening_cash >= 0),
  opened_by uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  closed_at timestamptz,
  counted_cash bigint CHECK (counted_cash >= 0),
  expected_cash bigint,
  variance_cash bigint,
  CONSTRAINT cashier_till_shifts_close_shape CHECK (
    (closed_at IS NULL AND closed_by IS NULL AND counted_cash IS NULL AND expected_cash IS NULL AND variance_cash IS NULL)
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND counted_cash IS NOT NULL AND expected_cash IS NOT NULL AND variance_cash IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS cashier_one_open_till_per_club
  ON public.cashier_till_shifts (club_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cashier_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  registration_id uuid NOT NULL UNIQUE REFERENCES public.tournament_registrations(id),
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','floor_cleared','paid')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 8),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  floor_by uuid,
  floor_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  bank_reference text,
  evidence text
);

CREATE TABLE IF NOT EXISTS public.cashier_buyin_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  tournament_id uuid REFERENCES public.tournaments(id),
  registration_id uuid REFERENCES public.tournament_registrations(id),
  shift_id uuid REFERENCES public.cashier_till_shifts(id),
  refund_id uuid REFERENCES public.cashier_refund_requests(id),
  bank_transaction_id uuid REFERENCES public.bank_transactions(id),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  method text NOT NULL CHECK (method IN ('cash','bank')),
  purpose text NOT NULL CHECK (purpose IN ('buyin','refund','drawer_adjustment')),
  amount bigint NOT NULL CHECK (amount > 0),
  applied_amount bigint NOT NULL CHECK (applied_amount >= 0 AND applied_amount <= amount),
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashier_movement_shape CHECK (
    (purpose = 'drawer_adjustment' AND method = 'cash' AND shift_id IS NOT NULL AND registration_id IS NULL AND bank_transaction_id IS NULL)
    OR (purpose = 'buyin' AND direction = 'in' AND registration_id IS NOT NULL AND refund_id IS NULL
      AND ((method = 'cash' AND shift_id IS NOT NULL AND bank_transaction_id IS NULL)
        OR (method = 'bank' AND bank_transaction_id IS NOT NULL AND shift_id IS NULL)))
    OR (purpose = 'refund' AND direction = 'out' AND registration_id IS NOT NULL AND refund_id IS NOT NULL
      AND bank_transaction_id IS NULL AND ((method = 'cash' AND shift_id IS NOT NULL) OR (method = 'bank' AND shift_id IS NULL)))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS cashier_movement_request_unique
  ON public.cashier_buyin_movements (club_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS cashier_movement_bank_unique
  ON public.cashier_buyin_movements (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cashier_refund_method_unique
  ON public.cashier_buyin_movements (refund_id, method) WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cashier_movement_registration_idx
  ON public.cashier_buyin_movements (registration_id, created_at);
CREATE INDEX IF NOT EXISTS cashier_movement_shift_idx
  ON public.cashier_buyin_movements (shift_id, method, direction);
CREATE OR REPLACE FUNCTION public.cashier_movement_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Cashier movements are append-only';
END $$;
DROP TRIGGER IF EXISTS cashier_movement_immutable ON public.cashier_buyin_movements;
CREATE TRIGGER cashier_movement_immutable BEFORE UPDATE OR DELETE
  ON public.cashier_buyin_movements FOR EACH ROW EXECUTE FUNCTION public.cashier_movement_immutable_v1();

-- Server-priced registrations cannot confirm before the ledger is fully paid
-- or cancel after any verified amount without a completed Cashier refund.
CREATE OR REPLACE FUNCTION public.cashier_paid_registration_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_paid bigint;
BEGIN
  IF OLD.price_snapshot IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(m.applied_amount),0) INTO v_paid
    FROM public.cashier_buyin_movements m WHERE m.registration_id=OLD.id
      AND m.purpose='buyin' AND m.direction='in';
  IF (
    NEW.total_pay IS DISTINCT FROM OLD.total_pay OR
    NEW.buy_in IS DISTINCT FROM OLD.buy_in OR
    NEW.reference_code IS DISTINCT FROM OLD.reference_code OR
    NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
  ) THEN
    RAISE EXCEPTION 'Server-priced registration is immutable';
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
-- Existing player UPDATE RLS covers every pending self-owned row. For a
-- server-priced registration, only proof metadata and an unpaid cancellation
-- may be changed directly; the player cannot self-confirm, change tour/owner,
-- or forge server-owned money and seat state.
CREATE OR REPLACE FUNCTION public.cashier_registration_columns_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND (
    NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot OR
    NEW.cashier_paid_at IS DISTINCT FROM OLD.cashier_paid_at OR
    NEW.cashier_seating_error IS DISTINCT FROM OLD.cashier_seating_error
  ) THEN
    RAISE EXCEPTION 'Cashier registration fields are server-owned';
  END IF;
  IF current_user IN ('authenticated','anon') AND OLD.price_snapshot IS NOT NULL THEN
    IF OLD.status='pending' AND NEW.status='cancelled' THEN
      IF NEW.cancelled_by IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Player cannot cancel for another actor';
      END IF;
      IF (to_jsonb(NEW) - ARRAY['transfer_proof_image_url','transfer_proof_submitted',
          'updated_at','status','cancelled_at','cancelled_by','cancellation_reason'])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['transfer_proof_image_url','transfer_proof_submitted',
          'updated_at','status','cancelled_at','cancelled_by','cancellation_reason']) THEN
        RAISE EXCEPTION 'Server-priced registration fields are server-owned';
      END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['transfer_proof_image_url','transfer_proof_submitted','updated_at'])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['transfer_proof_image_url','transfer_proof_submitted','updated_at']) THEN
      RAISE EXCEPTION 'Server-priced registration fields are server-owned';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cashier_registration_columns_guard ON public.tournament_registrations;
CREATE TRIGGER cashier_registration_columns_guard BEFORE UPDATE
  ON public.tournament_registrations FOR EACH ROW EXECUTE FUNCTION public.cashier_registration_columns_guard_v1();
DROP TRIGGER IF EXISTS cashier_paid_registration_guard ON public.tournament_registrations;
CREATE TRIGGER cashier_paid_registration_guard BEFORE UPDATE
  ON public.tournament_registrations FOR EACH ROW EXECUTE FUNCTION public.cashier_paid_registration_guard_v1();
CREATE INDEX IF NOT EXISTS cashier_reg_tour_queue_idx
  ON public.tournament_registrations (club_id, tournament_id, committed_at DESC, id DESC);

ALTER TABLE public.cashier_till_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_buyin_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cashier_till_shifts, public.cashier_refund_requests,
  public.cashier_buyin_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cashier_till_shifts, public.cashier_refund_requests,
  public.cashier_buyin_movements TO authenticated, service_role;

DROP POLICY IF EXISTS cashier_till_staff_read ON public.cashier_till_shifts;
CREATE POLICY cashier_till_staff_read ON public.cashier_till_shifts FOR SELECT TO authenticated
  USING (public.is_club_cashier((select auth.uid()), club_id));
DROP POLICY IF EXISTS cashier_refund_staff_read ON public.cashier_refund_requests;
CREATE POLICY cashier_refund_staff_read ON public.cashier_refund_requests FOR SELECT TO authenticated
  USING (public.is_club_cashier((select auth.uid()), club_id)
    OR public.is_club_floor((select auth.uid()), club_id));
DROP POLICY IF EXISTS cashier_movement_staff_read ON public.cashier_buyin_movements;
CREATE POLICY cashier_movement_staff_read ON public.cashier_buyin_movements FOR SELECT TO authenticated
  USING (public.is_club_cashier((select auth.uid()), club_id));

-- Internal helper: every caller holds the registration row lock and has checked
-- the actor and club. The helper independently checks paid total before seating.
CREATE OR REPLACE FUNCTION public.cashier_try_seat_paid_v1(p_registration_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_reg public.tournament_registrations%ROWTYPE;
  v_tour_club uuid;
  v_paid bigint;
  v_result jsonb;
  v_claims text;
BEGIN
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','registration_not_found'); END IF;
  SELECT club_id INTO v_tour_club FROM public.tournaments WHERE id=v_reg.tournament_id;
  IF v_reg.club_id IS DISTINCT FROM v_tour_club THEN
    RETURN jsonb_build_object('ok',false,'error','registration_club_mismatch'); END IF;
  IF NOT public.is_club_cashier(p_actor_id, v_reg.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  IF NOT public.cashier_tour_active_v1(v_reg.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','cashier_tour_disabled'); END IF;
  SELECT COALESCE(sum(applied_amount),0) INTO v_paid FROM public.cashier_buyin_movements
    WHERE registration_id = v_reg.id AND purpose = 'buyin' AND direction = 'in';
  IF v_paid < v_reg.total_pay THEN
    RETURN jsonb_build_object('ok',true,'payment_state','partial','received',v_paid,'remaining',v_reg.total_pay-v_paid);
  END IF;
  IF v_reg.status = 'confirmed' THEN
    RETURN jsonb_build_object('ok',true,'payment_state','paid','seating_state','seated','already_confirmed',true);
  END IF;
  IF v_reg.status <> 'pending' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_registration_status');
  END IF;
  v_claims := current_setting('request.jwt.claims',true);
  BEGIN
    PERFORM set_config('request.jwt.claims',json_build_object('sub',p_actor_id::text)::text,true);
    IF v_reg.source_entry_id IS NULL THEN
      v_result := public.confirm_registration_and_assign_seat(v_reg.id,p_actor_id,'random_balanced');
    ELSE
      v_result := public.confirm_reentry_and_assign_seat(v_reg.id,p_actor_id,'random_balanced');
    END IF;
    PERFORM set_config('request.jwt.claims',coalesce(v_claims,''),true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims',coalesce(v_claims,''),true);
    RAISE;
  END;
  IF coalesce((v_result->>'ok')::boolean,false) THEN
    UPDATE public.tournament_registrations SET cashier_seating_error=NULL WHERE id=v_reg.id;
    -- The row lock serializes this notice with all Cashier V2 payment/retry calls.
    INSERT INTO public.notifications (user_id,type,title,body,data)
    SELECT v_reg.player_id,'registration_confirmed'::public.notification_type,
      'Đã xếp ghế và cấp phiếu buy-in',
      format('Đã xếp Bàn %s, Ghế %s. Mở phiếu buy-in trong ứng dụng.',v_result->>'table_number',v_result->>'seat_number'),
      jsonb_build_object('registration_id',v_reg.id,'tournament_id',v_reg.tournament_id,
        'receipt_code',v_result->>'receipt_code')
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n WHERE n.user_id = v_reg.player_id
        AND n.data->>'registration_id' = v_reg.id::text
        AND n.data->>'receipt_code' = v_result->>'receipt_code'
    );
    RETURN v_result || jsonb_build_object('payment_state','paid','seating_state','seated');
  END IF;
  IF v_result->>'error' IN ('no_table_available','no_seat_available') THEN
    UPDATE public.tournament_registrations SET cashier_seating_error=NULL WHERE id=v_reg.id;
    RETURN jsonb_build_object('ok',true,'payment_state','paid','seating_state','waiting');
  END IF;
  UPDATE public.tournament_registrations
    SET cashier_seating_error=coalesce(v_result->>'error','seating_failed') WHERE id=v_reg.id;
  RETURN jsonb_build_object('ok',false,'payment_state','paid','seating_state','needs_review',
    'error',coalesce(v_result->>'error','seating_failed'));
END $$;
REVOKE ALL ON FUNCTION public.cashier_try_seat_paid_v1(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cashier_open_shift_v1(p_club_id uuid, p_opening_cash bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid := auth.uid(); v_shift uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_club_cashier(v_actor,p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  IF NOT public.cashier_tour_active_v1(p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','cashier_tour_disabled'); END IF;
  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_opening_cash');
  END IF;
  PERFORM 1 FROM public.clubs WHERE id=p_club_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.cashier_till_shifts WHERE club_id=p_club_id AND closed_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'error','shift_already_open');
  END IF;
  INSERT INTO public.cashier_till_shifts(club_id,opening_cash,opened_by)
  VALUES(p_club_id,p_opening_cash,v_actor) RETURNING id INTO v_shift;
  RETURN jsonb_build_object('ok',true,'shift_id',v_shift);
END $$;
REVOKE ALL ON FUNCTION public.cashier_open_shift_v1(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_open_shift_v1(uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_record_cash_buyin_v1(
  p_registration_id uuid,p_amount bigint,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid(); v_reg public.tournament_registrations%ROWTYPE;
  v_tour public.tournaments%ROWTYPE;
  v_shift uuid; v_paid bigint; v_prior public.cashier_buyin_movements%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request');
  END IF;
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id=p_registration_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_cashier(v_actor,v_reg.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  IF NOT public.cashier_tour_active_v1(v_reg.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','cashier_tour_disabled'); END IF;
  SELECT * INTO v_prior FROM public.cashier_buyin_movements
    WHERE club_id=v_reg.club_id AND idempotency_key='cash:'||p_request_id::text;
  IF FOUND THEN
    IF v_prior.registration_id IS DISTINCT FROM v_reg.id OR v_prior.amount <> p_amount THEN
      RETURN jsonb_build_object('ok',false,'error','request_id_reused');
    END IF;
    RETURN jsonb_build_object('ok',true,'already_recorded',true,'movement_id',v_prior.id);
  END IF;
  IF v_reg.status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'error','registration_not_pending'); END IF;
  IF v_reg.price_snapshot IS NULL OR
    (v_reg.price_snapshot->>'total_pay')::bigint IS DISTINCT FROM v_reg.total_pay THEN
    RETURN jsonb_build_object('ok',false,'error','unverified_registration_price'); END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id=v_reg.tournament_id FOR UPDATE;
  IF v_tour.club_id IS DISTINCT FROM v_reg.club_id THEN
    RETURN jsonb_build_object('ok',false,'error','registration_club_mismatch'); END IF;
  IF v_tour.status IN ('completed','cancelled') OR public.is_tournament_registration_closed(v_tour.id) THEN
    RETURN jsonb_build_object('ok',false,'error','registration_closed'); END IF;
  IF EXISTS(SELECT 1 FROM public.payment_settlements ps
    WHERE ps.tournament_registration_id=v_reg.id AND ps.outcome IN ('auto_confirmed','manual_confirmed')) THEN
    RETURN jsonb_build_object('ok',false,'error','legacy_payment_requires_review'); END IF;
  SELECT id INTO v_shift FROM public.cashier_till_shifts
    WHERE club_id=v_reg.club_id AND closed_at IS NULL FOR UPDATE;
  IF v_shift IS NULL THEN RETURN jsonb_build_object('ok',false,'error','shift_not_open'); END IF;
  SELECT coalesce(sum(applied_amount),0) INTO v_paid FROM public.cashier_buyin_movements
    WHERE registration_id=v_reg.id AND purpose='buyin' AND direction='in';
  IF v_paid+p_amount > v_reg.total_pay THEN
    RETURN jsonb_build_object('ok',false,'error','amount_exceeds_remaining','remaining',v_reg.total_pay-v_paid);
  END IF;
  INSERT INTO public.cashier_buyin_movements
    (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
     amount,applied_amount,actor_id,idempotency_key)
  VALUES(v_reg.club_id,v_reg.tournament_id,v_reg.id,v_shift,'in','cash','buyin',
    p_amount,p_amount,v_actor,'cash:'||p_request_id::text);
  IF v_paid+p_amount>=v_reg.total_pay THEN
    UPDATE public.tournament_registrations SET cashier_paid_at=coalesce(cashier_paid_at,now())
      WHERE id=v_reg.id; END IF;
  IF v_paid+p_amount<v_reg.total_pay THEN
    RETURN jsonb_build_object('ok',true,'payment_state','partial',
      'received',v_paid+p_amount,'remaining',v_reg.total_pay-v_paid-p_amount);
  END IF;
  -- Cash is already in the drawer. Roll back only a failed seating attempt,
  -- not the movement recorded before this exception block.
  BEGIN
    v_result := public.cashier_try_seat_paid_v1(v_reg.id,v_actor);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.tournament_registrations SET cashier_seating_error='seating_exception'
      WHERE id=v_reg.id;
    RETURN jsonb_build_object('ok',true,'payment_state','paid',
      'seating_state','needs_review','reason','seating_exception');
  END;
  IF NOT coalesce((v_result->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('ok',true,'payment_state','paid','seating_state','needs_review',
      'reason',coalesce(v_result->>'error','seating_failed'));
  END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.cashier_record_cash_buyin_v1(uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_record_cash_buyin_v1(uuid,bigint,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_record_verified_bank_v1(
  p_bank_transaction_id uuid,p_auto_confirm boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bt public.bank_transactions%ROWTYPE; v_reg public.tournament_registrations%ROWTYPE;
  v_tour public.tournaments%ROWTYPE;
  v_club uuid; v_club_count integer; v_ref text; v_reg_count integer;
  v_actor uuid; v_paid bigint; v_applied bigint; v_prior uuid; v_seat jsonb;
BEGIN
  IF NOT p_auto_confirm THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT system_actor_id INTO v_actor FROM public.sepay_system_settings
    WHERE auto_confirm_enabled=true LIMIT 1;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id=p_bank_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false); END IF;
  IF v_bt.provider <> 'sepay' OR v_bt.api_verified_at IS NULL
    OR v_bt.transfer_type IS DISTINCT FROM 'in' OR v_bt.amount IS NULL OR v_bt.amount <= 0
    OR v_bt.status <> 'unmatched' THEN RETURN jsonb_build_object('handled',false); END IF;
  v_ref := public.sepay_parse_reference_code(coalesce(v_bt.content,'')||' '||coalesce(v_bt.txn_ref,''));
  IF v_ref IS NULL OR upper(v_ref) NOT LIKE 'VINREG%' THEN
    RETURN jsonb_build_object('handled',false,'legacy_auto_confirm_allowed',true);
  END IF;
  SELECT count(DISTINCT club_id) INTO v_club_count FROM public.platform_bank_accounts
    WHERE account_number=v_bt.account_number AND is_active AND club_id IS NOT NULL;
  IF v_club_count<>1 THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT club_id INTO v_club FROM public.platform_bank_accounts
    WHERE account_number=v_bt.account_number AND is_active AND club_id IS NOT NULL LIMIT 1;
  IF NOT public.is_club_cashier(v_actor,v_club) THEN
    RETURN jsonb_build_object('handled',false);
  END IF;
  IF NOT public.cashier_tour_active_v1(v_club) THEN
    RETURN jsonb_build_object('handled',false); END IF;
  SELECT count(*) INTO v_reg_count FROM public.tournament_registrations
    WHERE upper(reference_code)=upper(v_ref);
  IF v_reg_count<>1 THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT * INTO v_reg FROM public.tournament_registrations
    WHERE upper(reference_code)=upper(v_ref) FOR UPDATE;
  IF v_reg.club_id IS DISTINCT FROM v_club OR v_reg.status NOT IN ('pending','confirmed') THEN
    RETURN jsonb_build_object('handled',false);
  END IF;
  IF v_reg.price_snapshot IS NULL THEN
    RETURN jsonb_build_object('handled',false,'legacy_auto_confirm_allowed',true);
  END IF;
  IF (v_reg.price_snapshot->>'total_pay')::bigint IS DISTINCT FROM v_reg.total_pay THEN
    RETURN jsonb_build_object('handled',false);
  END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id=v_reg.tournament_id FOR UPDATE;
  IF v_tour.club_id IS DISTINCT FROM v_club THEN
    RETURN jsonb_build_object('handled',false); END IF;
  IF v_reg.status='pending' AND (v_tour.status IN ('completed','cancelled')
    OR public.is_tournament_registration_closed(v_tour.id)) THEN
    RETURN jsonb_build_object('handled',false); END IF;
  IF EXISTS(SELECT 1 FROM public.payment_settlements
    WHERE bank_transaction_id=v_bt.id AND outcome IN ('auto_confirmed','manual_confirmed')) THEN
    RETURN jsonb_build_object('handled',false);
  END IF;
  SELECT id INTO v_prior FROM public.cashier_buyin_movements
    WHERE bank_transaction_id=v_bt.id;
  IF v_prior IS NOT NULL THEN RETURN jsonb_build_object('handled',true,'outcome','already_recorded'); END IF;
  SELECT coalesce(sum(applied_amount),0) INTO v_paid FROM public.cashier_buyin_movements
    WHERE registration_id=v_reg.id AND purpose='buyin' AND direction='in';
  IF v_reg.status='confirmed' AND (v_reg.cashier_paid_at IS NULL OR v_paid<v_reg.total_pay) THEN
    RETURN jsonb_build_object('handled',false); END IF;
  v_applied := least(v_bt.amount,greatest(v_reg.total_pay-v_paid,0));
  INSERT INTO public.cashier_buyin_movements
    (club_id,tournament_id,registration_id,bank_transaction_id,direction,method,
     purpose,amount,applied_amount,actor_id,idempotency_key)
  VALUES(v_club,v_reg.tournament_id,v_reg.id,v_bt.id,'in','bank','buyin',
    v_bt.amount,v_applied,v_actor,'bank:'||v_bt.id::text);
  UPDATE public.bank_transactions SET status='matched',processed_at=now(),club_id=v_club WHERE id=v_bt.id;
  IF v_reg.status='pending' AND v_paid+v_applied>=v_reg.total_pay THEN
    UPDATE public.tournament_registrations SET cashier_paid_at=coalesce(cashier_paid_at,now())
      WHERE id=v_reg.id;
    -- A seating failure must not erase the verified transfer or its allocation.
    BEGIN
      v_seat := public.cashier_try_seat_paid_v1(v_reg.id,v_actor);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.tournament_registrations SET cashier_seating_error='seating_exception'
        WHERE id=v_reg.id;
      v_seat := jsonb_build_object('ok',false,'payment_state','paid',
        'seating_state','needs_review','error','seating_exception');
    END;
  ELSE
    v_seat := jsonb_build_object('ok',true,'payment_state','partial',
      'received',v_paid+v_applied,'remaining',v_reg.total_pay-v_paid-v_applied);
  END IF;
  RETURN jsonb_build_object('handled',true,'outcome',
    CASE WHEN v_bt.amount>v_applied THEN 'surplus_received'
      WHEN v_paid+v_applied<v_reg.total_pay THEN 'partial_received'
      WHEN v_seat->>'seating_state'='waiting' THEN 'paid_waiting_seat'
      WHEN v_seat->>'seating_state'='needs_review' THEN 'paid_seating_review'
      ELSE 'paid_seated' END,
    'registration_id',v_reg.id,'applied',v_applied,'surplus',v_bt.amount-v_applied,'seating',v_seat);
END $$;
REVOKE ALL ON FUNCTION public.cashier_record_verified_bank_v1(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_record_verified_bank_v1(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.cashier_retry_paid_seating_v1(
  p_auto_confirm boolean DEFAULT false,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid; v_system_actor uuid; v_row record;
  v_attempted integer:=0; v_seated integer:=0; v_needs_review integer:=0; v_result jsonb;
BEGIN
  SELECT system_actor_id INTO v_system_actor FROM public.sepay_system_settings
    WHERE auto_confirm_enabled=true LIMIT 1;
  FOR v_row IN
    SELECT r.id,r.club_id FROM public.tournament_registrations r
    WHERE r.status='pending'
      AND EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
        WHERE m.registration_id=r.id AND m.purpose='buyin')
      AND (SELECT coalesce(sum(m.applied_amount),0) FROM public.cashier_buyin_movements m
        WHERE m.registration_id=r.id AND m.purpose='buyin' AND m.direction='in')>=r.total_pay
      AND ((coalesce(p_auto_confirm,false) AND v_system_actor IS NOT NULL
        AND public.is_club_cashier(v_system_actor,r.club_id))
        OR EXISTS(SELECT 1 FROM public.cashier_buyin_movements cm
          WHERE cm.registration_id=r.id AND cm.purpose='buyin' AND cm.direction='in'
            AND cm.method='cash' AND public.is_club_cashier(cm.actor_id,r.club_id)))
      AND public.cashier_tour_active_v1(r.club_id)
    ORDER BY r.committed_at,r.id LIMIT least(greatest(coalesce(p_limit,100),1),500)
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    SELECT cm.actor_id INTO v_actor FROM public.cashier_buyin_movements cm
      WHERE cm.registration_id=v_row.id AND cm.purpose='buyin' AND cm.direction='in'
        AND cm.method='cash' AND public.is_club_cashier(cm.actor_id,v_row.club_id)
      ORDER BY cm.created_at DESC,cm.id DESC LIMIT 1;
    IF v_actor IS NULL THEN v_actor:=v_system_actor; END IF;
    v_attempted:=v_attempted+1;
    BEGIN
      v_result:=public.cashier_try_seat_paid_v1(v_row.id,v_actor);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.tournament_registrations SET cashier_seating_error='seating_exception'
        WHERE id=v_row.id;
      v_result:=jsonb_build_object('ok',true,'seating_state','needs_review');
    END;
    IF NOT coalesce((v_result->>'ok')::boolean,false) THEN
      UPDATE public.tournament_registrations
        SET cashier_seating_error=coalesce(v_result->>'error','seating_failed')
        WHERE id=v_row.id;
      v_result:=v_result||jsonb_build_object('seating_state','needs_review');
    END IF;
    IF v_result->>'seating_state'='seated' THEN v_seated:=v_seated+1; END IF;
    IF v_result->>'seating_state'='needs_review' THEN v_needs_review:=v_needs_review+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'attempted',v_attempted,'seated',v_seated,
    'needs_review',v_needs_review);
END $$;
REVOKE ALL ON FUNCTION public.cashier_retry_paid_seating_v1(boolean,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_retry_paid_seating_v1(boolean,integer) TO service_role;

-- Filter by tour in SQL before limit/offset. A search can report a different
-- tour, but never permits a payment without choosing that tour in the client.
CREATE OR REPLACE FUNCTION public.cashier_tour_worklist_v1(
  p_club_id uuid,p_tournament_id uuid,p_query text DEFAULT '',p_bucket text DEFAULT 'counter',
  p_page integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_result jsonb; v_query text:=btrim(coalesce(p_query,''));
BEGIN
  IF v_actor IS NULL OR NOT public.is_club_cashier(v_actor,p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.club_id=p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','tournament_not_in_club'); END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>10000 OR p_limit IS NULL OR p_limit<1 OR p_limit>100
    OR length(v_query)>120 OR p_bucket IS NULL
    OR p_bucket NOT IN ('counter','waiting_seat','completed','needs_review','all') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_pagination_or_query'); END IF;
  WITH scoped AS MATERIALIZED (
    SELECT r.id,r.player_id,r.tournament_id,r.status,r.reference_code,r.total_pay,r.committed_at,
      r.cashier_seating_error,
      coalesce(m.full_name,p.display_name,'Người chơi') AS player_name,
      coalesce(m.phone,p.phone) AS phone,m.member_card_id,
      coalesce(pay.received,0) AS received,
      (r.club_id IS DISTINCT FROM p_club_id OR r.price_snapshot IS NULL
        OR (r.status='confirmed' AND pay.received IS NULL)) AS legacy_detail_missing,
      receipt.receipt_code,receipt.table_number,receipt.seat_number,
      CASE WHEN r.status='confirmed' AND receipt.receipt_code IS NULL THEN 'needs_review'
        WHEN r.status='confirmed' THEN 'completed'
        WHEN r.cashier_seating_error IS NOT NULL THEN 'needs_review'
        WHEN coalesce(pay.received,0)>=r.total_pay THEN 'waiting_seat'
        ELSE 'counter' END AS bucket
    FROM public.tournament_registrations r
    LEFT JOIN LATERAL (SELECT cm.full_name,cm.phone,cm.member_card_id
      FROM public.club_members cm WHERE cm.club_id=p_club_id AND cm.player_user_id=r.player_id
      ORDER BY cm.updated_at DESC,cm.id LIMIT 1) m ON true
    LEFT JOIN public.profiles p ON p.user_id=r.player_id
    LEFT JOIN LATERAL (SELECT sum(bm.applied_amount) AS received
      FROM public.cashier_buyin_movements bm WHERE bm.registration_id=r.id
        AND bm.purpose='buyin' AND bm.direction='in') pay ON true
    LEFT JOIN LATERAL (SELECT s.receipt_code,s.table_number,s.seat_number
      FROM public.seat_draw_receipts s WHERE s.registration_id=r.id AND s.status IN ('issued','printed')
      ORDER BY s.issued_at DESC,s.id DESC LIMIT 1) receipt ON true
    WHERE r.tournament_id=p_tournament_id
      AND r.status IN ('pending','confirmed')
  ), searched AS MATERIALIZED (
    SELECT * FROM scoped WHERE v_query=''
      OR id::text=v_query OR player_id::text=v_query OR reference_code ILIKE '%'||v_query||'%'
      OR receipt_code ILIKE '%'||v_query||'%'
      OR member_card_id ILIKE '%'||v_query||'%'
      OR player_name ILIKE '%'||v_query||'%'
      OR phone ILIKE '%'||v_query||'%'
  ), page_rows AS (
    SELECT * FROM searched WHERE p_bucket='all' OR bucket=p_bucket
    ORDER BY CASE bucket WHEN 'counter' THEN 0 WHEN 'needs_review' THEN 1
      WHEN 'waiting_seat' THEN 2 ELSE 3 END,
      committed_at DESC,id DESC LIMIT p_limit OFFSET p_page*p_limit
  )
  SELECT jsonb_build_object('ok',true,'enabled',public.cashier_tour_active_v1(p_club_id),
    'updated_at',now(),'page',p_page,'limit',p_limit,
    'counts',(SELECT jsonb_build_object('counter',count(*) FILTER (WHERE bucket='counter'),
      'waiting_seat',count(*) FILTER (WHERE bucket='waiting_seat'),
      'needs_review',count(*) FILTER (WHERE bucket='needs_review'),
      'completed',count(*) FILTER (WHERE bucket='completed'),'total',count(*)) FROM searched),
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(page_rows)) FROM page_rows),'[]'::jsonb))
    INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.cashier_tour_worklist_v1(uuid,uuid,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_tour_worklist_v1(uuid,uuid,text,text,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_lookup_tour_v1(
  p_club_id uuid,p_serving_tournament_id uuid,p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_query text:=btrim(coalesce(p_query,'')); v_rows jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_club_cashier(v_actor,p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF length(v_query)<3 OR length(v_query)>120 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_query'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournaments t
    WHERE t.id=p_serving_tournament_id AND t.club_id=p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','tournament_not_in_club'); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
    SELECT r.id AS registration_id,r.tournament_id,t.name AS tournament_name,
      r.reference_code,r.status,coalesce(cm.full_name,p.display_name,'Người chơi') AS player_name
    FROM public.tournament_registrations r
    JOIN public.tournaments t ON t.id=r.tournament_id AND t.club_id=p_club_id
    LEFT JOIN public.profiles p ON p.user_id=r.player_id
    LEFT JOIN LATERAL (SELECT full_name,phone,member_card_id FROM public.club_members m
      WHERE m.club_id=p_club_id AND m.player_user_id=r.player_id
      ORDER BY m.updated_at DESC,m.id LIMIT 1) cm ON true
    WHERE r.tournament_id<>p_serving_tournament_id
      AND r.status IN ('pending','confirmed')
      AND (r.id::text=v_query OR r.player_id::text=v_query OR r.reference_code ILIKE '%'||v_query||'%'
        OR cm.member_card_id ILIKE '%'||v_query||'%'
        OR cm.full_name ILIKE '%'||v_query||'%'
        OR cm.phone ILIKE '%'||v_query||'%'
        OR p.display_name ILIKE '%'||v_query||'%' OR p.phone ILIKE '%'||v_query||'%'
        OR EXISTS(SELECT 1 FROM public.seat_draw_receipts sr
          WHERE sr.registration_id=r.id AND sr.receipt_code ILIKE '%'||v_query||'%'))
    ORDER BY r.committed_at DESC,r.id DESC LIMIT 10
  ) x;
  RETURN jsonb_build_object('ok',true,'rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.cashier_lookup_tour_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_lookup_tour_v1(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_tour_issues_v1(p_club_id uuid,p_tournament_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_rows jsonb; v_pull_error boolean;
BEGIN
  IF v_actor IS NULL OR NOT public.is_club_cashier(v_actor,p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF p_tournament_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tournaments t
    WHERE t.id=p_tournament_id AND t.club_id=p_club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','tournament_not_in_club'); END IF;
  SELECT last_pull_status='error' INTO v_pull_error FROM public.club_payment_config
    WHERE club_id=p_club_id;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
    SELECT 'surplus'::text AS kind,m.bank_transaction_id AS bank_transaction_id,
      (m.amount-m.applied_amount) AS amount,r.reference_code AS reference_code,m.created_at AS occurred_at
    FROM public.cashier_buyin_movements m
    JOIN public.tournament_registrations r ON r.id=m.registration_id
    WHERE m.club_id=p_club_id AND m.method='bank' AND m.purpose='buyin'
      AND m.amount>m.applied_amount AND (p_tournament_id IS NULL OR m.tournament_id=p_tournament_id)
    UNION ALL
    SELECT 'unmatched'::text,b.id,b.amount,public.sepay_parse_reference_code(
      coalesce(b.content,'')||' '||coalesce(b.txn_ref,'')),b.occurred_at
    FROM public.bank_transactions b
    WHERE b.provider='sepay' AND b.status='unmatched' AND b.transfer_type='in'
      AND b.api_verified_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.platform_bank_accounts a WHERE a.club_id=p_club_id
        AND a.is_active AND a.account_number=b.account_number)
      AND NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts a
        WHERE a.account_number=b.account_number AND a.club_id IS DISTINCT FROM p_club_id
          AND a.club_id IS NOT NULL AND a.is_active)
    ORDER BY occurred_at DESC NULLS LAST LIMIT 100
  ) x;
  RETURN jsonb_build_object('ok',true,'sepay_unavailable',coalesce(v_pull_error,false),
    'rows',v_rows,'shown',jsonb_array_length(v_rows));
END $$;
REVOKE ALL ON FUNCTION public.cashier_tour_issues_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_tour_issues_v1(uuid,uuid) TO authenticated;

-- The shared till and bank report read this ledger once. Bank movements belong
-- to the shift whose real open/close interval contains the recorded movement;
-- they never affect physical cash expected in the drawer.
CREATE OR REPLACE FUNCTION public.cashier_shift_summary_v1(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_shift public.cashier_till_shifts%ROWTYPE; v_totals jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.cashier_till_shifts WHERE id=p_shift_id;
  IF NOT FOUND OR v_actor IS NULL OR NOT public.is_club_cashier(v_actor,v_shift.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  SELECT jsonb_build_object(
    'cash_in',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='in' AND purpose='buyin'),0),
    'cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='refund'),0),
    'bank_in',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0),
    'bank_out',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='out' AND purpose='refund'),0),
    'unallocated_bank',coalesce(sum(amount-applied_amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0),
    'cash_adjustments',coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END)
      FILTER (WHERE purpose='drawer_adjustment'),0),
    'movement_count',count(*)) INTO v_totals
  FROM public.cashier_buyin_movements m
  WHERE m.club_id=v_shift.club_id AND (
    (m.method='cash' AND m.shift_id=v_shift.id)
    OR (m.method='bank' AND m.created_at>=v_shift.opened_at
      AND (v_shift.closed_at IS NULL OR m.created_at<v_shift.closed_at))
  );
  RETURN jsonb_build_object('ok',true,'shift_id',v_shift.id,'club_id',v_shift.club_id,
    'opened_at',v_shift.opened_at,'closed_at',v_shift.closed_at,
    'opening_cash',v_shift.opening_cash,'expected_cash',v_shift.expected_cash,
    'counted_cash',v_shift.counted_cash,'variance_cash',v_shift.variance_cash,
    'totals',v_totals);
END $$;
REVOKE ALL ON FUNCTION public.cashier_shift_summary_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_shift_summary_v1(uuid) TO authenticated;

-- Cashier and Finance read the same movement source. These are cash-flow and
-- entry allocation facts, not an additive replacement for the legacy P&L RPC.
CREATE OR REPLACE FUNCTION public.cashier_cashflow_range_v1(
  p_club_id uuid,p_from timestamptz,p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_cash jsonb; v_entries jsonb; v_variance bigint;
  v_adjustments bigint;
  v_unmatched_verified_bank bigint;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>=p_to
    OR p_to-p_from>interval '400 days' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  IF NOT (public.is_club_cashier(v_actor,p_club_id)
    OR EXISTS(SELECT 1 FROM public.club_accountants a WHERE a.club_id=p_club_id AND a.user_id=v_actor)
    OR EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=v_actor AND u.role='super_admin')) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  SELECT jsonb_build_object(
    'cash_in',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='in' AND purpose='buyin'),0),
    'cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='refund'),0),
    'bank_in',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0),
    'bank_out',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='out' AND purpose='refund'),0),
    'unallocated_bank',coalesce(sum(amount-applied_amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0))
    INTO v_cash FROM public.cashier_buyin_movements
     WHERE club_id=p_club_id AND created_at>=p_from AND created_at<p_to;
  SELECT coalesce(sum(b.amount),0) INTO v_unmatched_verified_bank
    FROM public.bank_transactions b
    WHERE b.provider='sepay' AND b.status='unmatched' AND b.transfer_type='in'
      AND b.api_verified_at IS NOT NULL AND b.amount>0
      AND coalesce(b.occurred_at,b.created_at)>=p_from
      AND coalesce(b.occurred_at,b.created_at)<p_to
      AND EXISTS(SELECT 1 FROM public.platform_bank_accounts a
        WHERE a.account_number=b.account_number AND a.club_id=p_club_id AND a.is_active)
      AND NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts a
        WHERE a.account_number=b.account_number AND a.club_id IS DISTINCT FROM p_club_id
          AND a.club_id IS NOT NULL AND a.is_active)
      AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
        WHERE m.bank_transaction_id=b.id);
  WITH events AS (
    -- Payment is cash flow; allocation happens only after a seat/entry is
    -- confirmed. Paid registrations waiting for a table remain unallocated.
    SELECT r.id,r.buy_in,r.price_snapshot,r.confirmed_at AS event_at,1 AS sign
      FROM public.tournament_registrations r
      WHERE r.club_id=p_club_id AND r.cashier_paid_at IS NOT NULL
        AND r.confirmed_at>=p_from AND r.confirmed_at<p_to
    UNION ALL
    SELECT r.id,r.buy_in,r.price_snapshot,f.paid_at,-1
      FROM public.cashier_refund_requests f
      JOIN public.tournament_registrations r ON r.id=f.registration_id
      WHERE f.club_id=p_club_id AND f.status='paid' AND r.confirmed_at IS NOT NULL
        AND f.paid_at>=p_from AND f.paid_at<p_to
  )
  SELECT jsonb_build_object('prize_delta',coalesce(sum(sign*buy_in),0),
    'fees_delta',coalesce(sum(sign*((price_snapshot->>'rake')::bigint
      +(price_snapshot->>'service_fee')::bigint+(price_snapshot->>'platform_fee')::bigint))
      FILTER (WHERE price_snapshot ?& array['rake','service_fee','platform_fee']),0),
    'unclassified_entries',count(DISTINCT id) FILTER
      (WHERE price_snapshot IS NULL OR NOT (price_snapshot ?& array['rake','service_fee','platform_fee'])))
    INTO v_entries FROM events;
  SELECT coalesce(sum(variance_cash),0) INTO v_variance FROM public.cashier_till_shifts
    WHERE club_id=p_club_id AND closed_at>=p_from AND closed_at<p_to;
  SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0)
    INTO v_adjustments FROM public.cashier_buyin_movements
    WHERE club_id=p_club_id AND purpose='drawer_adjustment'
      AND created_at>=p_from AND created_at<p_to;
  RETURN jsonb_build_object('ok',true,'club_id',p_club_id,'from',p_from,'to',p_to,
    'cash_flow',v_cash,'unmatched_verified_bank',v_unmatched_verified_bank,
    'entry_allocation',v_entries,'closed_shift_variance',v_variance,
    'drawer_adjustments',v_adjustments);
END $$;
REVOKE ALL ON FUNCTION public.cashier_cashflow_range_v1(uuid,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_cashflow_range_v1(uuid,timestamptz,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_close_shift_v1(p_shift_id uuid,p_counted_cash bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_shift public.cashier_till_shifts%ROWTYPE; v_net bigint; v_expected bigint;
BEGIN
  IF v_actor IS NULL OR p_counted_cash IS NULL OR p_counted_cash<0 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  SELECT * INTO v_shift FROM public.cashier_till_shifts WHERE id=p_shift_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_cashier(v_actor,v_shift.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF v_shift.closed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','shift_already_closed'); END IF;
  SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0)
  INTO v_net FROM public.cashier_buyin_movements WHERE shift_id=v_shift.id AND method='cash';
  v_expected:=v_shift.opening_cash+v_net;
  UPDATE public.cashier_till_shifts SET closed_by=v_actor,closed_at=now(),
    counted_cash=p_counted_cash,expected_cash=v_expected,variance_cash=p_counted_cash-v_expected
    WHERE id=v_shift.id;
  RETURN jsonb_build_object('ok',true,'expected_cash',v_expected,
    'counted_cash',p_counted_cash,'variance_cash',p_counted_cash-v_expected);
END $$;
REVOKE ALL ON FUNCTION public.cashier_close_shift_v1(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_close_shift_v1(uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_adjust_shift_v1(
  p_shift_id uuid,p_direction text,p_amount bigint,p_reason text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_shift public.cashier_till_shifts%ROWTYPE; v_prior public.cashier_buyin_movements%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR p_amount IS NULL OR p_amount<=0
    OR p_direction NOT IN ('in','out') OR length(btrim(coalesce(p_reason,'')))<8 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  SELECT * INTO v_shift FROM public.cashier_till_shifts WHERE id=p_shift_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_cashier(v_actor,v_shift.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF v_shift.closed_at IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','shift_not_closed'); END IF;
  SELECT * INTO v_prior FROM public.cashier_buyin_movements
    WHERE club_id=v_shift.club_id AND idempotency_key='adjust:'||p_request_id::text;
  IF FOUND THEN
    IF v_prior.shift_id IS DISTINCT FROM p_shift_id OR v_prior.amount<>p_amount
      OR v_prior.direction<>p_direction OR v_prior.reason<>btrim(p_reason) THEN
      RETURN jsonb_build_object('ok',false,'error','request_id_reused'); END IF;
    RETURN jsonb_build_object('ok',true,'already_recorded',true); END IF;
  -- A correction after close is a new immutable movement. The counted and
  -- expected amounts saved at close are never recalculated or overwritten.
  INSERT INTO public.cashier_buyin_movements
    (club_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key,reason)
  VALUES(v_shift.club_id,v_shift.id,p_direction,'cash','drawer_adjustment',p_amount,0,
    v_actor,'adjust:'||p_request_id::text,btrim(p_reason));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.cashier_adjust_shift_v1(uuid,text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_adjust_shift_v1(uuid,text,bigint,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_request_refund_v1(p_registration_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_reg public.tournament_registrations%ROWTYPE; v_tour public.tournaments%ROWTYPE;
  v_paid bigint; v_existing public.cashier_refund_requests%ROWTYPE; v_id uuid;
BEGIN
  IF v_actor IS NULL OR length(btrim(coalesce(p_reason,'')))<8 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id=p_registration_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_cashier(v_actor,v_reg.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  SELECT * INTO v_existing FROM public.cashier_refund_requests WHERE registration_id=v_reg.id;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'refund_id',v_existing.id,'status',v_existing.status); END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id=v_reg.tournament_id FOR UPDATE;
  IF v_reg.club_id IS DISTINCT FROM v_tour.club_id THEN
    RETURN jsonb_build_object('ok',false,'error','registration_club_mismatch'); END IF;
  IF v_reg.status NOT IN ('pending','confirmed') OR v_tour.status IN ('completed','cancelled')
    OR public.is_tournament_registration_closed(v_tour.id)
    OR EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=v_tour.id)
    OR EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=v_tour.id) THEN
    RETURN jsonb_build_object('ok',false,'error','refund_window_closed'); END IF;
  SELECT coalesce(sum(applied_amount),0) INTO v_paid FROM public.cashier_buyin_movements
    WHERE registration_id=v_reg.id AND purpose='buyin' AND direction='in';
  IF v_paid<>v_reg.total_pay THEN
    RETURN jsonb_build_object('ok',false,'error','verified_payment_history_required'); END IF;
  INSERT INTO public.cashier_refund_requests
    (club_id,tournament_id,registration_id,amount,reason,requested_by)
  VALUES(v_reg.club_id,v_reg.tournament_id,v_reg.id,v_reg.total_pay,btrim(p_reason),v_actor)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'refund_id',v_id,'status','requested','amount',v_reg.total_pay);
END $$;
REVOKE ALL ON FUNCTION public.cashier_request_refund_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_request_refund_v1(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_floor_clear_refund_v1(p_refund_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_ref public.cashier_refund_requests%ROWTYPE;
  v_reg public.tournament_registrations%ROWTYPE; v_tour public.tournaments%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
  SELECT * INTO v_ref FROM public.cashier_refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_floor(v_actor,v_ref.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF v_ref.status='floor_cleared' THEN RETURN jsonb_build_object('ok',true,'already_cleared',true); END IF;
  IF v_ref.status<>'requested' THEN RETURN jsonb_build_object('ok',false,'error','invalid_refund_status'); END IF;
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
  IF EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.registration_id=v_reg.id
    AND e.status NOT IN ('busted','registered','cancelled'))
    OR EXISTS(SELECT 1 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
      WHERE e.registration_id=v_reg.id AND (s.is_active OR s.chip_count<>0)) THEN
    RETURN jsonb_build_object('ok',false,'error','floor_must_clear_chips_and_entry'); END IF;
  UPDATE public.cashier_refund_requests SET status='floor_cleared',floor_by=v_actor,floor_at=now()
    WHERE id=v_ref.id;
  RETURN jsonb_build_object('ok',true,'status','floor_cleared');
END $$;
REVOKE ALL ON FUNCTION public.cashier_floor_clear_refund_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_floor_clear_refund_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_floor_refunds_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_club uuid; v_rows jsonb;
BEGIN
  SELECT club_id INTO v_club FROM public.tournaments WHERE id=p_tournament_id;
  IF v_actor IS NULL OR v_club IS NULL OR NOT public.is_club_floor(v_actor,v_club) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
    SELECT f.id,f.registration_id,f.amount,f.status,f.reason,f.requested_at,
      r.reference_code,coalesce(cm.full_name,p.display_name,'Người chơi') AS player_name
    FROM public.cashier_refund_requests f
    JOIN public.tournament_registrations r ON r.id=f.registration_id
    LEFT JOIN public.profiles p ON p.user_id=r.player_id
    LEFT JOIN LATERAL (SELECT full_name FROM public.club_members m
      WHERE m.club_id=v_club AND m.player_user_id=r.player_id
      ORDER BY m.updated_at DESC,m.id LIMIT 1) cm ON true
    WHERE f.tournament_id=p_tournament_id AND f.status IN ('requested','floor_cleared')
    ORDER BY f.requested_at,f.id LIMIT 100
  ) x;
  RETURN jsonb_build_object('ok',true,'rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.cashier_floor_refunds_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_floor_refunds_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashier_complete_refund_v1(
  p_refund_id uuid,p_cash_amount bigint,p_bank_amount bigint,p_bank_reference text,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_ref public.cashier_refund_requests%ROWTYPE;
  v_reg public.tournament_registrations%ROWTYPE; v_tour public.tournaments%ROWTYPE; v_shift uuid;
BEGIN
  IF v_actor IS NULL OR p_cash_amount IS NULL OR p_bank_amount IS NULL
    OR p_cash_amount<0 OR p_bank_amount<0 OR length(btrim(coalesce(p_evidence,'')))<8 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  SELECT * INTO v_ref FROM public.cashier_refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_cashier(v_actor,v_ref.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF v_ref.status='paid' THEN RETURN jsonb_build_object('ok',true,'already_paid',true); END IF;
  IF v_ref.status<>'floor_cleared' OR p_cash_amount+p_bank_amount<>v_ref.amount THEN
    RETURN jsonb_build_object('ok',false,'error','refund_amount_or_clearance_invalid'); END IF;
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
  -- Floor clearance can become stale between its approval and this payout.
  IF EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.registration_id=v_reg.id
    AND e.status NOT IN ('busted','registered','cancelled'))
    OR EXISTS(SELECT 1 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
      WHERE e.registration_id=v_reg.id AND (s.is_active OR s.chip_count<>0)) THEN
    RETURN jsonb_build_object('ok',false,'error','floor_clearance_stale'); END IF;
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
   -- A busted entry is played history. Keep its result unchanged; only an
   -- unplayed registered entry may be cancelled after the full payout.
   UPDATE public.tournament_entries SET status='cancelled',current_stack=0
     WHERE registration_id=v_reg.id AND status='registered';
  UPDATE public.seat_draw_receipts SET status='cancelled',cancelled_at=now()
    WHERE registration_id=v_reg.id AND status IN ('issued','printed');
  UPDATE public.tournament_registrations SET status='cancelled',cancelled_at=now(),
    cancelled_by=v_actor,cancellation_reason='cashier_refund:'||v_ref.id::text WHERE id=v_reg.id;
  RETURN jsonb_build_object('ok',true,'refund_id',v_ref.id,'amount',v_ref.amount);
END $$;
REVOKE ALL ON FUNCTION public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text) TO authenticated;
