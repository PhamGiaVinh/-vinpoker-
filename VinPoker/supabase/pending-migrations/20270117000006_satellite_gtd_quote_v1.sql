-- PENDING SOURCE ONLY. Read-only GTD quote; never issues tickets or approves overlay.
-- Depends on Satellite award-plan migration 01 for tournaments.operations_mode.
-- ROLLBACK: revoke EXECUTE through a reviewed forward migration. No money rows
-- are written by this function; preserve any later approved award/funding ledgers.

CREATE OR REPLACE FUNCTION public.satellite_gtd_quote_v1(
  p_source_tournament_id uuid,
  p_target_tournament_id uuid,
  p_guaranteed_tickets integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source public.tournaments%ROWTYPE;
  v_target public.tournaments%ROWTYPE;
  v_entry_count integer;
  v_pool numeric;
  v_gross numeric;
  v_price numeric;
  v_earned numeric;
  v_tickets integer;
  v_cash numeric;
  v_overlay numeric;
  v_awards jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_source_tournament_id IS NULL OR p_target_tournament_id IS NULL
     OR p_source_tournament_id=p_target_tournament_id
     OR p_guaranteed_tickets IS NULL OR p_guaranteed_tickets NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'satellite_gtd_request_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_source FROM public.tournaments
    WHERE id=p_source_tournament_id;
  SELECT * INTO v_target FROM public.tournaments
    WHERE id=p_target_tournament_id;
  IF v_source.id IS NULL OR v_target.id IS NULL
     OR v_source.club_id IS DISTINCT FROM v_target.club_id
     OR v_source.deleted_at IS NOT NULL OR v_target.deleted_at IS NOT NULL
     OR v_source.event_id IS NOT NULL
     OR v_source.status::text='cancelled'
     OR v_target.status::text NOT IN ('scheduled','live')
     OR v_target.registration_closed_at IS NOT NULL
     OR v_source.operations_mode IS DISTINCT FROM 'satellite'
     OR v_target.operations_mode IS DISTINCT FROM 'standard' THEN
    RAISE EXCEPTION 'satellite_tournament_pair_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    EXISTS(SELECT 1 FROM public.clubs c
           WHERE c.id=v_source.club_id AND c.owner_id=v_actor)
    OR public.is_club_floor(v_actor,v_source.club_id)
    OR public.has_role(v_actor,'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE = '42501';
  END IF;
  IF v_target.buy_in IS NULL OR v_target.buy_in<=0
     OR v_target.rake_amount IS NULL OR v_target.rake_amount<0
     OR v_target.service_fee_amount IS NULL OR v_target.service_fee_amount<0 THEN
    RAISE EXCEPTION 'satellite_target_price_invalid' USING ERRCODE = '22023';
  END IF;
  v_price := v_target.buy_in::numeric + v_target.rake_amount::numeric
           + v_target.service_fee_amount::numeric;
  IF v_price<>pg_catalog.trunc(v_price) OR v_price>9007199254740991 THEN
    RAISE EXCEPTION 'satellite_target_price_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer,coalesce(sum(r.buy_in),0)::numeric,
    coalesce(sum(r.total_pay),0)::numeric
    INTO v_entry_count,v_pool,v_gross
  FROM public.tournament_registrations r
  WHERE r.tournament_id=p_source_tournament_id AND r.status='confirmed';
  IF EXISTS(SELECT 1 FROM public.tournament_registrations r
            WHERE r.tournament_id=p_source_tournament_id AND r.status='confirmed'
              AND (r.buy_in<0 OR r.total_pay<r.buy_in))
     OR v_pool<0 OR v_gross<v_pool OR v_gross>9007199254740991
     OR v_pool<>pg_catalog.trunc(v_pool) THEN
    RAISE EXCEPTION 'satellite_source_registration_amount_invalid' USING ERRCODE = '23514';
  END IF;
  v_earned := pg_catalog.floor(v_pool/v_price);
  IF v_earned>500 THEN
    RAISE EXCEPTION 'satellite_ticket_count_exceeds_capacity' USING ERRCODE = '22023';
  END IF;
  v_tickets := greatest(p_guaranteed_tickets,v_earned::integer);
  v_overlay := greatest(0,v_tickets::numeric*v_price-v_pool);
  v_cash := greatest(0,v_pool-v_tickets::numeric*v_price);
  IF v_pool+v_overlay<>v_tickets::numeric*v_price+v_cash
     OR v_tickets::numeric*v_price+v_cash>9007199254740991 THEN
    RAISE EXCEPTION 'satellite_gtd_conservation_failed' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'position',rank_no,'ticketCount',1,'cashVnd','0') ORDER BY rank_no),'[]'::jsonb)
    INTO v_awards
  FROM generate_series(1,v_tickets) AS rank_no;
  IF v_cash>0 THEN
    v_awards := v_awards || jsonb_build_array(jsonb_build_object(
      'position',v_tickets+1,'ticketCount',0,'cashVnd',v_cash::bigint::text));
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'provisional',NOT public.is_tournament_registration_closed(v_source.id),
    'sourceTournamentId',v_source.id,'targetTournamentId',v_target.id,
    'entryCount',v_entry_count,'guaranteedTickets',p_guaranteed_tickets,
    'targetEntryPriceVnd',v_price::bigint::text,
    'sourceRegistrationGrossVnd',v_gross::bigint::text,
    'sourceEntryFeesVnd',(v_gross-v_pool)::bigint::text,
    'sourcePoolVnd',v_pool::bigint::text,
    'ticketCount',v_tickets,'ticketLiabilityVnd',(v_tickets::numeric*v_price)::bigint::text,
    'cashPrizeVnd',v_cash::bigint::text,'overlayRequiredVnd',v_overlay::bigint::text,
    'awardLines',v_awards
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_gtd_quote_v1(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_gtd_quote_v1(uuid,uuid,integer)
  TO authenticated;
