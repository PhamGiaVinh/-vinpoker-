-- Satellite award plan v1. PENDING SOURCE ONLY: do not promote/apply before TEST DB/RLS/UAT review.
-- A locked plan is an immutable TD decision, not a ticket issuance or payout.
-- Client supplies ranks and award quantities; the server owns target price and actor scope.
-- ROLLBACK (only before any plan is locked): revoke the RPC, then remove this new
-- table/function in a controlled rollback migration. Never drop a populated ledger.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS operations_mode text NOT NULL DEFAULT 'standard';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournaments'::regclass
      AND conname = 'tournaments_operations_mode_check'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_operations_mode_check
      CHECK (operations_mode IN ('standard','satellite'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.satellite_award_plans (
  source_tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  target_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  target_entry_price_vnd bigint NOT NULL CHECK (target_entry_price_vnd > 0),
  award_lines jsonb NOT NULL CHECK (jsonb_typeof(award_lines) = 'array'),
  ticket_total integer NOT NULL CHECK (ticket_total > 0 AND ticket_total <= 500),
  cash_total_vnd bigint NOT NULL CHECK (cash_total_vnd >= 0),
  total_liability_vnd bigint NOT NULL CHECK (total_liability_vnd > 0),
  locked_by uuid NOT NULL REFERENCES auth.users(id),
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_award_plan_distinct_tournaments
    CHECK (source_tournament_id <> target_tournament_id)
);

CREATE INDEX IF NOT EXISTS satellite_award_plans_target_idx
  ON public.satellite_award_plans(target_tournament_id);

ALTER TABLE public.satellite_award_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_award_plans FROM PUBLIC, anon, authenticated;
-- No direct table policy/grant. The scoped RPC below is the only browser seam.

CREATE OR REPLACE FUNCTION public.satellite_award_plan_v1(
  p_source_tournament_id uuid,
  p_target_tournament_id uuid,
  p_awards jsonb,
  p_lock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_source public.tournaments%ROWTYPE;
  v_target public.tournaments%ROWTYPE;
  v_existing public.satellite_award_plans%ROWTYPE;
  v_unit_price numeric;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_seen_positions integer[] := ARRAY[]::integer[];
  v_position integer;
  v_tickets integer;
  v_cash bigint;
  v_ticket_total integer := 0;
  v_cash_total numeric := 0;
  v_liability numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_source_tournament_id IS NULL OR p_target_tournament_id IS NULL
     OR p_source_tournament_id = p_target_tournament_id THEN
    RAISE EXCEPTION 'satellite_tournament_pair_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_lock IS NULL OR jsonb_typeof(p_awards) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'satellite_awards_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_awards) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'satellite_awards_invalid' USING ERRCODE = '22023';
  END IF;

  -- Both tournament rows are locked in UUID order, including when two operations
  -- happen to reverse source and target. The existing plan check follows the lock.
  FOR v_id IN
    SELECT t.id FROM public.tournaments t
    WHERE t.id IN (p_source_tournament_id, p_target_tournament_id)
    ORDER BY t.id
  LOOP
    PERFORM 1 FROM public.tournaments t WHERE t.id = v_id FOR UPDATE;
  END LOOP;
  SELECT * INTO v_source FROM public.tournaments
    WHERE id = p_source_tournament_id;
  SELECT * INTO v_target FROM public.tournaments
    WHERE id = p_target_tournament_id;
  IF v_source.id IS NULL OR v_target.id IS NULL
     OR v_source.club_id IS DISTINCT FROM v_target.club_id
     OR v_source.deleted_at IS NOT NULL OR v_target.deleted_at IS NOT NULL
     OR v_source.event_id IS NOT NULL
     OR v_source.operations_mode IS DISTINCT FROM 'satellite'
     OR v_target.operations_mode IS DISTINCT FROM 'standard' THEN
    RAISE EXCEPTION 'satellite_tournament_scope_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM public.clubs c
            WHERE c.id = v_source.club_id AND c.owner_id = v_actor)
    OR public.is_club_floor(v_actor, v_source.club_id)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE = '42501';
  END IF;
  IF v_target.buy_in IS NULL OR v_target.rake_amount IS NULL
     OR v_target.service_fee_amount IS NULL
     OR v_target.buy_in < 0 OR v_target.rake_amount < 0
     OR v_target.service_fee_amount < 0
     OR v_target.buy_in::numeric <> pg_catalog.trunc(v_target.buy_in::numeric)
     OR v_target.rake_amount::numeric <> pg_catalog.trunc(v_target.rake_amount::numeric)
     OR v_target.service_fee_amount::numeric <> pg_catalog.trunc(v_target.service_fee_amount::numeric) THEN
    RAISE EXCEPTION 'satellite_target_price_invalid' USING ERRCODE = '22023';
  END IF;
  v_unit_price := v_target.buy_in::numeric
                + v_target.rake_amount::numeric
                + v_target.service_fee_amount::numeric;
  IF v_unit_price < 1 OR v_unit_price > 9007199254740991 THEN
    RAISE EXCEPTION 'satellite_target_price_invalid' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_awards) LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
       OR COALESCE(v_line->>'position','') !~ '^[1-9][0-9]{0,4}$'
       OR COALESCE(v_line->>'ticketCount','0') !~ '^[0-9]{1,2}$'
       OR COALESCE(v_line->>'cashVnd','0') !~ '^[0-9]{1,15}$' THEN
      RAISE EXCEPTION 'satellite_award_line_invalid' USING ERRCODE = '22023';
    END IF;
    v_position := (v_line->>'position')::integer;
    v_tickets := COALESCE(v_line->>'ticketCount','0')::integer;
    v_cash := COALESCE(v_line->>'cashVnd','0')::bigint;
    IF v_position = ANY(v_seen_positions) OR v_tickets > 10
       OR (v_tickets = 0 AND v_cash = 0) THEN
      RAISE EXCEPTION 'satellite_award_line_duplicate_or_empty' USING ERRCODE = '22023';
    END IF;
    v_seen_positions := array_append(v_seen_positions, v_position);
    v_ticket_total := v_ticket_total + v_tickets;
    v_cash_total := v_cash_total + v_cash::numeric;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'position', v_position, 'ticketCount', v_tickets,
      'cashVnd', v_cash::text
    ));
  END LOOP;
  IF v_ticket_total < 1 OR v_ticket_total > 500 THEN
    RAISE EXCEPTION 'satellite_ticket_count_invalid' USING ERRCODE = '22023';
  END IF;
  v_liability := v_ticket_total::numeric * v_unit_price + v_cash_total;
  IF v_liability > 9007199254740991 THEN
    RAISE EXCEPTION 'satellite_liability_overflow' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(x.value ORDER BY (x.value->>'position')::integer)
    INTO v_lines FROM jsonb_array_elements(v_lines) AS x(value);

  SELECT * INTO v_existing FROM public.satellite_award_plans
    WHERE source_tournament_id = p_source_tournament_id;
  IF v_existing.source_tournament_id IS NOT NULL AND (
       v_existing.target_tournament_id IS DISTINCT FROM p_target_tournament_id
       OR v_existing.target_entry_price_vnd IS DISTINCT FROM v_unit_price::bigint
       OR v_existing.award_lines IS DISTINCT FROM v_lines
     ) THEN
    RAISE EXCEPTION 'satellite_plan_locked_different' USING ERRCODE = '23505';
  END IF;
  -- A matching retry remains idempotent even if the source subsequently closed.
  -- New plans, however, may only be locked before the result/registration closes.
  IF v_existing.source_tournament_id IS NULL THEN
    IF v_source.status::text IN ('cancelled','completed','finished')
       OR EXISTS (SELECT 1 FROM public.tournament_close_report r
                  WHERE r.tournament_id = v_source.id) THEN
      RAISE EXCEPTION 'satellite_result_already_locked' USING ERRCODE = '22023';
    END IF;
    IF v_target.status::text NOT IN ('scheduled','live')
       OR v_target.registration_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'satellite_target_not_open' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_lock AND v_existing.source_tournament_id IS NULL THEN
    INSERT INTO public.satellite_award_plans (
      source_tournament_id, target_tournament_id, club_id,
      target_entry_price_vnd, award_lines, ticket_total,
      cash_total_vnd, total_liability_vnd, locked_by
    ) VALUES (
      p_source_tournament_id, p_target_tournament_id, v_source.club_id,
      v_unit_price::bigint, v_lines, v_ticket_total,
      v_cash_total::bigint, v_liability::bigint, v_actor
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'locked', (p_lock OR v_existing.source_tournament_id IS NOT NULL),
    'sourceTournamentId', p_source_tournament_id,
    'targetTournamentId', p_target_tournament_id,
    'targetEntryPriceVnd', v_unit_price::bigint::text,
    'ticketTotal', v_ticket_total,
    'cashTotalVnd', v_cash_total::bigint::text,
    'totalLiabilityVnd', v_liability::bigint::text,
    'awardLines', v_lines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.satellite_award_plan_v1(uuid,uuid,jsonb,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_award_plan_v1(uuid,uuid,jsonb,boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.satellite_get_award_plan_v1(
  p_source_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_plan public.satellite_award_plans%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT t.club_id INTO v_club_id FROM public.tournaments t
    WHERE t.id = p_source_tournament_id AND t.operations_mode = 'satellite';
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'satellite_source_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM public.clubs c
            WHERE c.id = v_club_id AND c.owner_id = v_actor)
    OR public.is_club_floor(v_actor, v_club_id)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc
               WHERE cc.club_id = v_club_id AND cc.user_id = v_actor)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_plan FROM public.satellite_award_plans p
    WHERE p.source_tournament_id = p_source_tournament_id;
  IF v_plan.source_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'locked', false);
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'locked', true,
    'sourceTournamentId', v_plan.source_tournament_id,
    'targetTournamentId', v_plan.target_tournament_id,
    'targetEntryPriceVnd', v_plan.target_entry_price_vnd::text,
    'ticketTotal', v_plan.ticket_total,
    'cashTotalVnd', v_plan.cash_total_vnd::text,
    'totalLiabilityVnd', v_plan.total_liability_vnd::text,
    'awardLines', v_plan.award_lines,
    'lockedAt', v_plan.locked_at,
    'lockedBy', v_plan.locked_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.satellite_get_award_plan_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_get_award_plan_v1(uuid)
  TO authenticated;

-- A locked ticket's value must keep matching the exact target entry price.
-- Plan lock and economics updates serialize on the tournament row, so an
-- update cannot slip between price validation and plan insertion.
CREATE OR REPLACE FUNCTION public.satellite_award_economics_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ROW(OLD.club_id, OLD.buy_in, OLD.rake_amount,
         OLD.service_fee_amount, OLD.operations_mode)
     IS DISTINCT FROM
     ROW(NEW.club_id, NEW.buy_in, NEW.rake_amount,
         NEW.service_fee_amount, NEW.operations_mode)
     AND EXISTS (
       SELECT 1 FROM public.satellite_award_plans p
       WHERE p.source_tournament_id = OLD.id OR p.target_tournament_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'satellite_locked_economics_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_award_economics_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS satellite_award_economics_guard_v1 ON public.tournaments;
CREATE TRIGGER satellite_award_economics_guard_v1
  BEFORE UPDATE OF club_id, buy_in, rake_amount, service_fee_amount, operations_mode
  ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.satellite_award_economics_guard_v1();
