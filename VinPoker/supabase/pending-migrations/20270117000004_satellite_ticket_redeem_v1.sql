-- PENDING SOURCE ONLY. Depends on Satellite plan, issue, funding and Cashier V2.
-- Cashier consumes the private ticket code only after registration + seat succeed.
-- A ticket is a non-cash internal tender: the source funds the target buy-in
-- and fees. No cash/bank movement is created on voucher redemption.
-- ROLLBACK: keep the feature flag off and revoke new RPCs through a reviewed
-- forward migration. Preserve redeemed tickets, registrations and receipts.

DO $$
BEGIN
  IF to_regprocedure('public.cashier_tour_registration_insert_guard_v1()') IS NULL
     OR to_regprocedure('public.confirm_registration_and_assign_seat(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.confirm_reentry_and_assign_seat(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'satellite_redemption_dependencies_missing' USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.satellite_tickets
  ADD COLUMN IF NOT EXISTS claim_reference_code text;
ALTER TABLE public.satellite_tickets
  ADD COLUMN IF NOT EXISTS claim_actor uuid;
ALTER TABLE public.satellite_tickets
  ADD COLUMN IF NOT EXISTS claim_player_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS satellite_ticket_registration_once
  ON public.satellite_tickets(registration_id) WHERE registration_id IS NOT NULL;
-- One immutable internal transfer per consumed ticket. It is consideration
-- already funded at the source, never a target Cashier cash/bank movement.
CREATE TABLE IF NOT EXISTS public.satellite_voucher_transfers (
  ticket_id uuid PRIMARY KEY REFERENCES public.satellite_tickets(id) ON DELETE RESTRICT,
  registration_id uuid NOT NULL UNIQUE REFERENCES public.tournament_registrations(id) ON DELETE RESTRICT,
  source_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  target_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  face_value_vnd bigint NOT NULL CHECK (face_value_vnd > 0),
  target_buy_in_vnd bigint NOT NULL CHECK (target_buy_in_vnd > 0),
  target_fees_vnd bigint NOT NULL CHECK (target_fees_vnd >= 0),
  transferred_by uuid NOT NULL REFERENCES auth.users(id),
  transferred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_voucher_transfer_value CHECK (
    face_value_vnd::numeric = target_buy_in_vnd::numeric + target_fees_vnd::numeric
  )
);
ALTER TABLE public.satellite_voucher_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_voucher_transfers FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.satellite_voucher_transfer_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'satellite_voucher_transfer_immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS satellite_voucher_transfer_immutable ON public.satellite_voucher_transfers;
CREATE TRIGGER satellite_voucher_transfer_immutable BEFORE UPDATE OR DELETE
  ON public.satellite_voucher_transfers FOR EACH ROW
  EXECUTE FUNCTION public.satellite_voucher_transfer_immutable_v1();
REVOKE ALL ON FUNCTION public.satellite_voucher_transfer_immutable_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.satellite_tickets'::regclass
                   AND conname = 'satellite_ticket_claim_shape') THEN
    ALTER TABLE public.satellite_tickets ADD CONSTRAINT satellite_ticket_claim_shape
      CHECK (
        (claim_reference_code IS NULL AND claim_actor IS NULL AND claim_player_id IS NULL)
        OR (status = 'issued' AND claim_reference_code IS NOT NULL
            AND claim_actor IS NOT NULL AND claim_player_id IS NOT NULL)
      );
  END IF;
END;
$$;

-- Cashier V2's browser insert guard remains in force. A claim made by the
-- server-owned redemption RPC permits only its exact voucher registration.
CREATE OR REPLACE FUNCTION public.cashier_tour_registration_insert_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tour_club uuid;
BEGIN
  SELECT t.club_id INTO v_tour_club FROM public.tournaments t WHERE t.id=NEW.tournament_id;
  IF auth.role()='authenticated' AND (public.cashier_tour_active_v1(v_tour_club)
    OR NEW.price_snapshot IS NOT NULL OR NEW.cashier_paid_at IS NOT NULL
    OR NEW.cashier_seating_error IS NOT NULL) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.satellite_tickets st
      JOIN public.tournaments t ON t.id=st.target_tournament_id
      WHERE st.claim_reference_code=NEW.reference_code
        AND st.claim_actor=auth.uid() AND st.claim_player_id=NEW.player_id
        AND st.status='issued' AND st.club_id=v_tour_club
        AND st.target_tournament_id=NEW.tournament_id
        AND st.target_entry_price_vnd=NEW.total_pay
        AND NEW.buy_in=t.buy_in
        AND NEW.platform_fixed_fee=coalesce(t.rake_amount,0)+coalesce(t.service_fee_amount,0)
        AND NEW.price_snapshot IS NULL AND NEW.cashier_paid_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Tour buy-in registration must be created by server';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cashier_tour_registration_insert_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- Once a voucher is redeemed, old void/refund paths must not pay its face
-- value back as cash. A separate controlled voucher reversal is needed.
CREATE OR REPLACE FUNCTION public.satellite_voucher_registration_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.satellite_tickets st
             WHERE st.registration_id=OLD.id AND st.status='redeemed')
     AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'satellite_voucher_registration_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS satellite_voucher_registration_guard ON public.tournament_registrations;
CREATE TRIGGER satellite_voucher_registration_guard BEFORE UPDATE
  ON public.tournament_registrations FOR EACH ROW
  EXECUTE FUNCTION public.satellite_voucher_registration_guard_v1();
REVOKE ALL ON FUNCTION public.satellite_voucher_registration_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.satellite_lookup_ticket_v1(p_redemption_code uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.satellite_tickets%ROWTYPE;
  v_tour public.tournaments%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_redemption_code IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ticket FROM public.satellite_tickets
    WHERE redemption_code=p_redemption_code;
  IF v_ticket.id IS NULL OR NOT public.is_club_cashier(v_actor,v_ticket.club_id) THEN
    RAISE EXCEPTION 'satellite_ticket_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id=v_ticket.target_tournament_id;
  RETURN jsonb_build_object(
    'ok',true,'serial',v_ticket.serial_no,'status',v_ticket.status,
    'targetTournamentId',v_ticket.target_tournament_id,
    'targetTournamentName',v_tour.name,
    'entryPriceVnd',v_ticket.target_entry_price_vnd::text,
    'buyInVnd',v_tour.buy_in::bigint::text,
    'feesVnd',(v_ticket.target_entry_price_vnd-v_tour.buy_in::bigint)::text,
    'registrationId',v_ticket.registration_id,
    'redeemedAt',v_ticket.redeemed_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_lookup_ticket_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_lookup_ticket_v1(uuid)
  TO authenticated;

-- Search is scoped to the serving club and target. Existing voucher guests
-- appear through seat history even without an auth profile. Never trust a
-- browser-supplied player name when an existing player ID was selected.
CREATE OR REPLACE FUNCTION public.satellite_find_bearer_v1(
  p_target_tournament_id uuid, p_query text
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club uuid;
  v_query text := btrim(coalesce(p_query,''));
  v_rows jsonb;
BEGIN
  SELECT t.club_id INTO v_club FROM public.tournaments t
    WHERE t.id=p_target_tournament_id;
  IF v_actor IS NULL OR v_club IS NULL OR NOT public.is_club_cashier(v_actor,v_club) THEN
    RAISE EXCEPTION 'satellite_target_not_found' USING ERRCODE = '22023';
  END IF;
  IF length(v_query) NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'satellite_bearer_query_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('playerId',x.player_id,
    'displayName',x.display_name,'source',x.source)), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT DISTINCT ON (candidate.player_id) candidate.player_id,
      candidate.display_name, candidate.source
    FROM (
      SELECT m.player_user_id AS player_id, m.full_name AS display_name,
        'member'::text AS source
      FROM public.club_members m
      WHERE m.club_id=v_club AND m.player_user_id IS NOT NULL
        AND length(btrim(coalesce(m.full_name,''))) BETWEEN 2 AND 100
        AND strpos(lower(m.full_name),lower(v_query))>0
      UNION ALL
      SELECT s.player_id,s.player_name,'target_entry'::text
      FROM public.tournament_seats s
      WHERE s.tournament_id=p_target_tournament_id
        AND s.player_id IS NOT NULL
        AND length(btrim(coalesce(s.player_name,''))) BETWEEN 2 AND 100
        AND strpos(lower(s.player_name),lower(v_query))>0
    ) candidate
    ORDER BY candidate.player_id,candidate.source
    LIMIT 10
  ) x;
  RETURN jsonb_build_object('ok',true,'players',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_find_bearer_v1(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_find_bearer_v1(uuid,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.satellite_redeem_ticket_v1(
  p_redemption_code uuid,
  p_target_tournament_id uuid,
  p_player_id uuid DEFAULT NULL,
  p_player_name text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target_id uuid;
  v_ticket public.satellite_tickets%ROWTYPE;
  v_tour public.tournaments%ROWTYPE;
  v_player_id uuid;
  v_name text;
  v_source_entry_id uuid;
  v_source_status text;
  v_reg_id uuid;
  v_ref text;
  v_seat jsonb;
  v_existing_name text;
  v_is_reentry boolean := false;
  v_rows integer;
BEGIN
  IF v_actor IS NULL OR p_redemption_code IS NULL OR p_target_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  -- Ticket lookup precedes locks only to identify the target. Never return
  -- its existence to a caller outside the issuing club.
  SELECT target_tournament_id INTO v_target_id FROM public.satellite_tickets
    WHERE redemption_code=p_redemption_code;
  IF v_target_id IS NULL OR v_target_id IS DISTINCT FROM p_target_tournament_id THEN
    RAISE EXCEPTION 'satellite_ticket_not_found' USING ERRCODE = '22023';
  END IF;
  -- The target tournament lock serializes seat selection and registrations.
  SELECT * INTO v_tour FROM public.tournaments
    WHERE id=v_target_id FOR UPDATE;
  SELECT * INTO v_ticket FROM public.satellite_tickets
    WHERE redemption_code=p_redemption_code FOR UPDATE;
  IF v_ticket.id IS NULL OR v_tour.id IS NULL
     OR v_ticket.target_tournament_id IS DISTINCT FROM v_tour.id
     OR v_ticket.club_id IS DISTINCT FROM v_tour.club_id
     OR NOT public.is_club_cashier(v_actor,v_ticket.club_id) THEN
    RAISE EXCEPTION 'satellite_ticket_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT public.cashier_tour_active_v1(v_tour.club_id) THEN
    RAISE EXCEPTION 'satellite_cashier_tour_disabled' USING ERRCODE = '42501';
  END IF;
  IF v_ticket.status='redeemed' THEN
    SELECT s.player_name INTO v_existing_name FROM public.tournament_seats s
      WHERE s.entry_id=(SELECT e.id FROM public.tournament_entries e
                        WHERE e.registration_id=v_ticket.registration_id
                        ORDER BY e.created_at DESC LIMIT 1)
      ORDER BY s.assigned_at DESC NULLS LAST LIMIT 1;
    IF (p_player_id IS NOT NULL AND p_player_id IS DISTINCT FROM v_ticket.redeemed_for_player_id)
       OR (p_player_id IS NULL AND
           lower(btrim(coalesce(p_player_name,''))) IS DISTINCT FROM lower(coalesce(v_existing_name,''))) THEN
      RAISE EXCEPTION 'satellite_ticket_already_used_for_another_player' USING ERRCODE = '23505';
    END IF;
    SELECT jsonb_build_object('registrationId',r.id,'playerId',r.player_id,
      'receiptCode',sdr.receipt_code,'tableNumber',sdr.table_number,
      'seatNumber',sdr.seat_number) INTO v_seat
    FROM public.tournament_registrations r
    JOIN public.seat_draw_receipts sdr ON sdr.registration_id=r.id
    WHERE r.id=v_ticket.registration_id AND sdr.status IN ('issued','printed')
    ORDER BY sdr.issued_at DESC LIMIT 1;
    IF v_seat IS NULL THEN
      RAISE EXCEPTION 'satellite_redeemed_receipt_missing' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'serial',v_ticket.serial_no,
      'targetTournamentId',v_ticket.target_tournament_id,'seat',v_seat);
  END IF;
  IF v_ticket.status<>'issued' THEN
    RAISE EXCEPTION 'satellite_ticket_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_tour.status::text NOT IN ('scheduled','live')
     OR v_tour.registration_closed_at IS NOT NULL
     OR public.is_tournament_registration_closed(v_tour.id)
     OR EXISTS(SELECT 1 FROM public.tournament_close_report r
               WHERE r.tournament_id=v_tour.id) THEN
    RAISE EXCEPTION 'satellite_target_registration_closed' USING ERRCODE = '22023';
  END IF;
  IF v_tour.operations_mode IS DISTINCT FROM 'standard'
     OR v_tour.buy_in IS NULL OR v_tour.buy_in<=0
     OR v_tour.rake_amount IS NULL OR v_tour.service_fee_amount IS NULL
     OR v_ticket.target_entry_price_vnd IS DISTINCT FROM
        (v_tour.buy_in+v_tour.rake_amount+v_tour.service_fee_amount)::bigint THEN
    RAISE EXCEPTION 'satellite_target_price_changed' USING ERRCODE = '23514';
  END IF;
  v_player_id := coalesce(p_player_id,gen_random_uuid());
  IF p_player_id IS NULL THEN
    v_name := nullif(btrim(p_player_name),'');
  ELSE
    SELECT coalesce(
      (SELECT nullif(btrim(p.display_name),'') FROM public.profiles p
       WHERE p.user_id=v_player_id),
      (SELECT nullif(btrim(m.full_name),'') FROM public.club_members m
       WHERE m.club_id=v_tour.club_id AND m.player_user_id=v_player_id
       ORDER BY m.updated_at DESC,m.id DESC LIMIT 1),
      (SELECT nullif(btrim(s.player_name),'') FROM public.tournament_seats s
       WHERE s.tournament_id=v_tour.id AND s.player_id=v_player_id
       ORDER BY s.assigned_at DESC NULLS LAST LIMIT 1)
    ) INTO v_name;
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'satellite_bearer_name_required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_seats s
            WHERE s.tournament_id=v_tour.id AND s.player_id=v_player_id
              AND s.is_active) THEN
    RAISE EXCEPTION 'satellite_player_still_seated' USING ERRCODE = '22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_registrations r
            WHERE r.tournament_id=v_tour.id AND r.player_id=v_player_id
              AND r.status='pending') THEN
    RAISE EXCEPTION 'satellite_player_pending_registration' USING ERRCODE = '22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_registrations r
            WHERE r.tournament_id=v_tour.id AND r.player_id=v_player_id
              AND r.status='confirmed') THEN
    SELECT e.id,e.status INTO v_source_entry_id,v_source_status
    FROM public.tournament_entries e
    WHERE e.tournament_id=v_tour.id AND e.player_id=v_player_id
    ORDER BY e.entry_no DESC,e.created_at DESC LIMIT 1;
    IF v_source_entry_id IS NULL OR v_source_status IS DISTINCT FROM 'busted'
       OR EXISTS(SELECT 1 FROM public.tournament_registrations r
                 WHERE r.source_entry_id=v_source_entry_id
                   AND r.status IN ('pending','confirmed')) THEN
      RAISE EXCEPTION 'satellite_reentry_not_eligible' USING ERRCODE = '22023';
    END IF;
    v_is_reentry := true;
  END IF;

  -- The claim is visible only inside this transaction. The Cashier V2 insert
  -- guard accepts a registration only when its exact ticket/actor/price match.
  v_ref := 'SAT'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
  UPDATE public.satellite_tickets SET
    claim_reference_code=v_ref,claim_actor=v_actor,claim_player_id=v_player_id
    WHERE id=v_ticket.id AND status='issued';
  INSERT INTO public.tournament_registrations (
    tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
    reference_code,status,source_entry_id,committed_at
  ) VALUES (
    v_tour.id,v_player_id,v_tour.club_id,v_tour.buy_in::bigint,
    (v_tour.rake_amount+v_tour.service_fee_amount)::bigint,
    v_ticket.target_entry_price_vnd,v_ref,'pending',v_source_entry_id,now()
  ) RETURNING id INTO v_reg_id;

  IF v_is_reentry THEN
    v_seat := public.confirm_reentry_and_assign_seat(v_reg_id,v_actor,'random_balanced');
  ELSE
    v_seat := public.confirm_registration_and_assign_seat(v_reg_id,v_actor,'random_balanced');
  END IF;
  IF coalesce((v_seat->>'ok')::boolean,false) IS NOT TRUE
     OR nullif(v_seat->>'entry_id','') IS NULL
     OR nullif(v_seat->>'seat_id','') IS NULL
     OR nullif(v_seat->>'receipt_id','') IS NULL THEN
    RAISE EXCEPTION 'satellite_seat_failed:%',coalesce(v_seat->>'error','unknown')
      USING ERRCODE = '23514';
  END IF;
  -- Existing draw helpers derive the profile name; offline voucher bearers
  -- have no profile, so replace only the just-created seat/receipt display.
  UPDATE public.tournament_seats SET player_name=v_name
    WHERE id=(v_seat->>'seat_id')::uuid AND entry_id=(v_seat->>'entry_id')::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'satellite_seat_link_missing' USING ERRCODE = '23514';
  END IF;
  UPDATE public.seat_draw_receipts SET display_name=v_name
    WHERE id=(v_seat->>'receipt_id')::uuid AND registration_id=v_reg_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'satellite_receipt_link_missing' USING ERRCODE = '23514';
  END IF;
  UPDATE public.satellite_tickets SET status='redeemed',redeemed_at=now(),
    redeemed_by=v_actor,redeemed_for_player_id=v_player_id,registration_id=v_reg_id,
    claim_reference_code=NULL,claim_actor=NULL,claim_player_id=NULL
    WHERE id=v_ticket.id AND status='issued';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'satellite_ticket_claim_lost' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.satellite_voucher_transfers (
    ticket_id,registration_id,source_tournament_id,target_tournament_id,
    club_id,face_value_vnd,target_buy_in_vnd,target_fees_vnd,transferred_by
  ) VALUES (
    v_ticket.id,v_reg_id,v_ticket.source_tournament_id,v_tour.id,
    v_tour.club_id,v_ticket.target_entry_price_vnd,v_tour.buy_in::bigint,
    (v_tour.rake_amount+v_tour.service_fee_amount)::bigint,v_actor
  );
  RETURN jsonb_build_object(
    'ok',true,'idempotent',false,'serial',v_ticket.serial_no,
    'targetTournamentId',v_tour.id,'registrationId',v_reg_id,
    'playerId',v_player_id,'playerName',v_name,'reentry',v_is_reentry,
    'entryPriceVnd',v_ticket.target_entry_price_vnd::text,
    'cashReceivedVnd','0','seat',v_seat
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_redeem_ticket_v1(uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_redeem_ticket_v1(uuid,uuid,uuid,text)
  TO authenticated;

-- The generic Cashier V2 worklist treats confirmed registrations without
-- cash movements as legacy/incomplete. This scoped overlay identifies ticket
-- tender without exposing private redemption codes or offering cash refunds.
CREATE OR REPLACE FUNCTION public.satellite_redemptions_for_worklist_v1(
  p_target_tournament_id uuid, p_registration_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club uuid;
  v_rows jsonb;
BEGIN
  SELECT t.club_id INTO v_club FROM public.tournaments t
    WHERE t.id=p_target_tournament_id;
  IF v_actor IS NULL OR v_club IS NULL OR NOT public.is_club_cashier(v_actor,v_club) THEN
    RAISE EXCEPTION 'satellite_target_not_found' USING ERRCODE = '22023';
  END IF;
  IF p_registration_ids IS NULL OR coalesce(array_length(p_registration_ids,1),0)>50 THEN
    RAISE EXCEPTION 'satellite_worklist_page_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('registrationId',x.registration_id,
    'serial',x.serial_no,'sourceTournamentName',x.source_name,
    'bearerName',x.display_name)),'[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT st.registration_id,st.serial_no,src.name AS source_name,sdr.display_name
    FROM public.satellite_tickets st
    JOIN public.tournaments src ON src.id=st.source_tournament_id
    LEFT JOIN LATERAL (
      SELECT r.display_name FROM public.seat_draw_receipts r
      WHERE r.registration_id=st.registration_id AND r.status IN ('issued','printed')
      ORDER BY r.issued_at DESC LIMIT 1
    ) sdr ON true
    WHERE st.target_tournament_id=p_target_tournament_id
      AND st.club_id=v_club AND st.status='redeemed'
      AND st.registration_id=ANY(p_registration_ids)
  ) x;
  RETURN jsonb_build_object('ok',true,'rows',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_redemptions_for_worklist_v1(uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_redemptions_for_worklist_v1(uuid,uuid[])
  TO authenticated;

-- Reconcile source collection/funding to issued ticket face value, then split
-- that same liability into redeemed internal transfers and still-open tickets.
CREATE OR REPLACE FUNCTION public.satellite_get_transfer_summary_v1(p_source_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_funding public.satellite_award_funding%ROWTYPE;
  v_issued_count integer;
  v_issued_value numeric;
  v_redeemed_count integer;
  v_redeemed_value numeric;
  v_open_value numeric;
  v_transfer_count integer;
  v_transfer_value numeric;
BEGIN
  SELECT * INTO v_funding FROM public.satellite_award_funding
    WHERE source_tournament_id=p_source_tournament_id;
  IF v_actor IS NULL OR v_funding.source_tournament_id IS NULL OR NOT (
    EXISTS(SELECT 1 FROM public.clubs c
           WHERE c.id=v_funding.club_id AND c.owner_id=v_actor)
    OR public.is_club_floor(v_actor,v_funding.club_id)
    OR public.is_club_cashier(v_actor,v_funding.club_id)
  ) THEN
    RAISE EXCEPTION 'satellite_funding_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer,coalesce(sum(st.target_entry_price_vnd),0)::numeric,
    count(*) FILTER (WHERE st.status='redeemed')::integer,
    coalesce(sum(st.target_entry_price_vnd) FILTER (WHERE st.status='redeemed'),0)::numeric,
    coalesce(sum(st.target_entry_price_vnd) FILTER (WHERE st.status='issued'),0)::numeric
    INTO v_issued_count,v_issued_value,v_redeemed_count,v_redeemed_value,v_open_value
  FROM public.satellite_tickets st
  WHERE st.source_tournament_id=p_source_tournament_id;
  SELECT count(*)::integer,coalesce(sum(tr.face_value_vnd),0)::numeric
    INTO v_transfer_count,v_transfer_value
  FROM public.satellite_voucher_transfers tr
  JOIN public.satellite_tickets st ON st.id=tr.ticket_id
  WHERE tr.source_tournament_id=p_source_tournament_id
    AND tr.registration_id=st.registration_id
    AND tr.target_tournament_id=st.target_tournament_id
    AND tr.club_id=st.club_id
    AND tr.face_value_vnd=st.target_entry_price_vnd
    AND st.status='redeemed';
  IF (v_issued_count > 0 AND
      v_issued_value IS DISTINCT FROM v_funding.ticket_liability_vnd::numeric)
     OR v_redeemed_count IS DISTINCT FROM v_transfer_count
     OR v_redeemed_value IS DISTINCT FROM v_transfer_value
     OR v_issued_value IS DISTINCT FROM v_redeemed_value+v_open_value THEN
    RAISE EXCEPTION 'satellite_source_transfer_ledger_inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('ok',true,'issuedCount',v_issued_count,
    'issuedValueVnd',v_issued_value::bigint::text,
    'redeemedCount',v_redeemed_count,
    'transferredValueVnd',v_transfer_value::bigint::text,
    'outstandingValueVnd',v_open_value::bigint::text,
    'unissuedValueVnd',(CASE WHEN v_issued_count=0 THEN
      v_funding.ticket_liability_vnd ELSE 0 END)::text,
    'sourcePoolVnd',v_funding.source_pool_vnd::text,
    'overlayVnd',v_funding.overlay_vnd::text,
    'cashLiabilityVnd',v_funding.cash_liability_vnd::text,
    'remainingVnd',v_funding.remaining_vnd::text);
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_get_transfer_summary_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_get_transfer_summary_v1(uuid)
  TO authenticated;

-- Read-only, scoped close preview. A browser must not infer cash from a
-- voucher registration's total_pay before the close trigger runs.
CREATE OR REPLACE FUNCTION public.satellite_target_voucher_summary_v1(p_target_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club uuid;
  v_redeemed_count integer;
  v_transfer_count integer;
  v_value numeric;
  v_gross numeric;
BEGIN
  SELECT t.club_id INTO v_club FROM public.tournaments t
    WHERE t.id=p_target_tournament_id;
  IF v_actor IS NULL OR v_club IS NULL OR NOT (
    public.is_club_cashier(v_actor,v_club) OR
    EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_club AND c.owner_id=v_actor)
  ) THEN
    RAISE EXCEPTION 'satellite_target_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO v_redeemed_count
  FROM public.satellite_tickets st
  WHERE st.target_tournament_id=p_target_tournament_id AND st.status='redeemed';
  SELECT count(*)::integer,coalesce(sum(tr.face_value_vnd),0)::numeric
    INTO v_transfer_count,v_value
  FROM public.satellite_voucher_transfers tr
  JOIN public.satellite_tickets st ON st.id=tr.ticket_id
  JOIN public.tournament_registrations r ON r.id=tr.registration_id
  WHERE tr.target_tournament_id=p_target_tournament_id
    AND tr.club_id=v_club AND tr.registration_id=st.registration_id
    AND tr.source_tournament_id=st.source_tournament_id
    AND tr.face_value_vnd=st.target_entry_price_vnd
    AND r.tournament_id=p_target_tournament_id AND r.status='confirmed'
    AND r.total_pay=tr.face_value_vnd AND r.buy_in=tr.target_buy_in_vnd
    AND st.status='redeemed';
  SELECT coalesce(sum(r.total_pay),0)::numeric INTO v_gross
  FROM public.tournament_registrations r
  WHERE r.tournament_id=p_target_tournament_id AND r.status='confirmed';
  IF v_redeemed_count IS DISTINCT FROM v_transfer_count
     OR v_gross < v_value OR v_gross > 9007199254740991 THEN
    RAISE EXCEPTION 'satellite_target_transfer_ledger_inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('ok',true,'ticketCount',v_transfer_count,
    'grossRegistrationVnd',v_gross::bigint::text,
    'voucherTransferVnd',v_value::bigint::text,
    'nonVoucherRegistrationVnd',(v_gross-v_value)::bigint::text);
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_target_voucher_summary_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_target_voucher_summary_v1(uuid)
  TO authenticated;

-- close_tournament historically sums every registration.total_pay as cash.
-- For a voucher, that number is value transferred from the source Satellite,
-- not new cash at the target Cashier. Keep prize-pool buy_in and fee revenue,
-- but remove voucher tender from cash_in and cashier_balance snapshots.
CREATE OR REPLACE FUNCTION public.satellite_adjust_target_close_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ticket_count integer;
  v_total_redeemed integer;
  v_voucher_value numeric;
  v_voucher_buyin numeric;
  v_transfer_count integer;
  v_transfer_value numeric;
  v_registration_count integer;
  v_all_buyin numeric;
  v_all_pay numeric;
BEGIN
  SELECT count(*)::integer INTO v_total_redeemed
  FROM public.satellite_tickets st
  WHERE st.target_tournament_id=NEW.tournament_id AND st.status='redeemed';
  IF v_total_redeemed=0 THEN RETURN NEW; END IF;
  SELECT count(*)::integer,
         coalesce(sum(st.target_entry_price_vnd),0)::numeric,
         coalesce(sum(r.buy_in),0)::numeric
    INTO v_ticket_count,v_voucher_value,v_voucher_buyin
  FROM public.satellite_tickets st
  JOIN public.tournament_registrations r ON r.id=st.registration_id
  WHERE st.target_tournament_id=NEW.tournament_id
    AND st.status='redeemed' AND r.status='confirmed'
    AND r.tournament_id=st.target_tournament_id
    AND r.player_id=st.redeemed_for_player_id
    AND r.total_pay=st.target_entry_price_vnd;
  IF v_ticket_count IS DISTINCT FROM v_total_redeemed THEN
    RAISE EXCEPTION 'satellite_target_voucher_ledger_inconsistent' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::integer,coalesce(sum(tr.face_value_vnd),0)::numeric
    INTO v_transfer_count,v_transfer_value
  FROM public.satellite_voucher_transfers tr
  JOIN public.satellite_tickets st ON st.id=tr.ticket_id
  WHERE tr.target_tournament_id=NEW.tournament_id
    AND tr.registration_id=st.registration_id
    AND tr.source_tournament_id=st.source_tournament_id
    AND tr.club_id=st.club_id
    AND tr.face_value_vnd=st.target_entry_price_vnd
    AND tr.target_buy_in_vnd=(SELECT r.buy_in FROM public.tournament_registrations r
                              WHERE r.id=tr.registration_id);
  IF v_transfer_count IS DISTINCT FROM v_ticket_count
     OR v_transfer_value IS DISTINCT FROM v_voucher_value THEN
    RAISE EXCEPTION 'satellite_target_transfer_ledger_inconsistent' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::integer,coalesce(sum(r.buy_in),0)::numeric,
         coalesce(sum(r.total_pay),0)::numeric
    INTO v_registration_count,v_all_buyin,v_all_pay
  FROM public.tournament_registrations r
  WHERE r.tournament_id=NEW.tournament_id AND r.status='confirmed';
  IF NEW.entry_count IS DISTINCT FROM v_registration_count
     OR NEW.buy_in_total::numeric IS DISTINCT FROM v_all_buyin
     OR NEW.cash_in_total::numeric IS DISTINCT FROM v_all_pay
     OR NEW.club_revenue::numeric IS DISTINCT FROM v_all_pay-v_all_buyin
     OR NEW.cash_in_total::numeric < v_voucher_value THEN
    RAISE EXCEPTION 'satellite_target_close_snapshot_mismatch' USING ERRCODE = '23514';
  END IF;
  NEW.cash_in_total := (v_all_pay-v_voucher_value)::bigint;
  -- Existing cashier_balance is the tour settlement balance, not drawer cash.
  -- The internal transfer funds the voucher share without another cash intake.
  NEW.cashier_balance := NEW.cash_in_total+v_voucher_value::bigint-NEW.prize_total;
  NEW.detail := coalesce(NEW.detail,'{}'::jsonb) || jsonb_build_object(
    'satelliteVoucherCount',v_ticket_count,
    'satelliteVoucherTransferVnd',v_voucher_value::bigint::text,
    'satelliteVoucherBuyInVnd',v_voucher_buyin::bigint::text,
    'satelliteVoucherFeesVnd',(v_voucher_value-v_voucher_buyin)::bigint::text,
    'grossConsiderationVnd',v_all_pay::bigint::text,
    'cashTenderInVnd',(v_all_pay-v_voucher_value)::bigint::text,
    'settlementBalanceIncludesInternalTransfer',true,
    'cashInExcludesSatelliteVoucher',true
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS satellite_adjust_target_close ON public.tournament_close_report;
CREATE TRIGGER satellite_adjust_target_close BEFORE INSERT
  ON public.tournament_close_report FOR EACH ROW
  EXECUTE FUNCTION public.satellite_adjust_target_close_v1();
REVOKE ALL ON FUNCTION public.satellite_adjust_target_close_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- The legacy close RPC returns its pre-trigger local cash total. This wrapper
-- returns the persisted report instead; the satellite-enabled UI uses it for
-- every tour so a voucher close never displays gross value as new cash.
CREATE OR REPLACE FUNCTION public.satellite_close_tournament_v1(
  p_tournament_id uuid, p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_report public.tournament_close_report%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  v_result := public.close_tournament(p_tournament_id,p_reason);
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;
  SELECT * INTO v_report FROM public.tournament_close_report
    WHERE tournament_id=p_tournament_id;
  IF v_report.id IS NULL OR v_report.id::text IS DISTINCT FROM v_result->>'report_id' THEN
    RAISE EXCEPTION 'satellite_close_report_missing' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'outcome',v_result->>'outcome','report_id',v_report.id,
    'entry_count',v_report.entry_count,'buy_in_total',v_report.buy_in_total,
    'cash_in_total',v_report.cash_in_total,'club_revenue',v_report.club_revenue,
    'prize_total',v_report.prize_total,'cashier_balance',v_report.cashier_balance,
    'reconcile_delta',v_report.reconcile_delta,'reconciled',v_report.reconciled,
    'satelliteVoucherTransferVnd',v_report.detail->>'satelliteVoucherTransferVnd'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_close_tournament_v1(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_close_tournament_v1(uuid,text)
  TO authenticated;
