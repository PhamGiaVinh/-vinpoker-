-- PENDING SOURCE ONLY. Depends on Satellite award plan and ticket issue v1.
-- The source prize pool funds cash prizes and full target ticket prices (buy-in
-- plus fees). An owner explicitly locks any shortfall as club overlay.
-- ROLLBACK: disable client/RPC EXECUTE with a new reviewed migration. Preserve
-- immutable funding and issued-ticket history; never delete populated rows.

CREATE TABLE IF NOT EXISTS public.satellite_award_funding (
  source_tournament_id uuid PRIMARY KEY REFERENCES public.satellite_award_plans(source_tournament_id) ON DELETE RESTRICT,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  source_close_report_id uuid NOT NULL REFERENCES public.tournament_close_report(id) ON DELETE RESTRICT,
  source_confirmed_gross_vnd bigint NOT NULL CHECK (source_confirmed_gross_vnd >= 0),
  source_entry_fees_vnd bigint NOT NULL CHECK (source_entry_fees_vnd >= 0),
  source_pool_vnd bigint NOT NULL CHECK (source_pool_vnd >= 0),
  ticket_liability_vnd bigint NOT NULL CHECK (ticket_liability_vnd > 0),
  cash_liability_vnd bigint NOT NULL CHECK (cash_liability_vnd >= 0),
  overlay_vnd bigint NOT NULL CHECK (overlay_vnd >= 0),
  remaining_vnd bigint NOT NULL CHECK (remaining_vnd >= 0),
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_funding_conservation CHECK (
    source_pool_vnd::numeric + overlay_vnd::numeric =
    ticket_liability_vnd::numeric + cash_liability_vnd::numeric + remaining_vnd::numeric
  ),
  CONSTRAINT satellite_source_collection_split CHECK (
    source_confirmed_gross_vnd::numeric =
    source_pool_vnd::numeric + source_entry_fees_vnd::numeric
  )
);
ALTER TABLE public.satellite_award_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_award_funding FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.satellite_funding_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'satellite_funding_immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS satellite_funding_immutable ON public.satellite_award_funding;
CREATE TRIGGER satellite_funding_immutable BEFORE UPDATE OR DELETE
  ON public.satellite_award_funding FOR EACH ROW
  EXECUTE FUNCTION public.satellite_funding_immutable_v1();
REVOKE ALL ON FUNCTION public.satellite_funding_immutable_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.satellite_approve_funding_v1(
  p_source_tournament_id uuid,
  p_overlay_vnd bigint DEFAULT NULL,
  p_lock boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source public.tournaments%ROWTYPE;
  v_plan public.satellite_award_plans%ROWTYPE;
  v_report public.tournament_close_report%ROWTYPE;
  v_existing public.satellite_award_funding%ROWTYPE;
  v_ticket numeric;
  v_required numeric;
  v_overlay numeric;
  v_remaining numeric;
  v_entries integer;
  v_pool numeric;
  v_gross numeric;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL
     OR (p_lock AND p_overlay_vnd IS NULL)
     OR (p_overlay_vnd IS NOT NULL AND p_overlay_vnd < 0) OR p_lock IS NULL THEN
    RAISE EXCEPTION 'satellite_funding_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_source FROM public.tournaments
    WHERE id = p_source_tournament_id FOR UPDATE;
  IF v_source.id IS NULL OR v_source.operations_mode IS DISTINCT FROM 'satellite'
     OR v_source.status::text <> 'completed' THEN
    RAISE EXCEPTION 'satellite_source_not_closed' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c
                 WHERE c.id = v_source.club_id AND c.owner_id = v_actor) THEN
    RAISE EXCEPTION 'satellite_owner_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id = p_source_tournament_id FOR UPDATE;
  SELECT * INTO v_report FROM public.tournament_close_report
    WHERE tournament_id = p_source_tournament_id;
  IF v_plan.source_tournament_id IS NULL OR v_report.id IS NULL
     OR v_plan.club_id IS DISTINCT FROM v_source.club_id
     OR v_report.club_id IS DISTINCT FROM v_source.club_id THEN
    RAISE EXCEPTION 'satellite_funding_scope_invalid' USING ERRCODE = '22023';
  END IF;
  -- The generic close report records Satellite cash prizes. Requiring exact
  -- equality avoids counting those prizes twice or ignoring another payout.
  IF v_report.prize_total IS DISTINCT FROM v_plan.cash_total_vnd THEN
    RAISE EXCEPTION 'satellite_cash_prizes_not_reconciled' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer, coalesce(sum(r.buy_in),0)::numeric,
    coalesce(sum(r.total_pay),0)::numeric
    INTO v_entries, v_pool, v_gross
  FROM public.tournament_registrations r
  WHERE r.tournament_id = p_source_tournament_id AND r.status = 'confirmed';
  IF v_report.entry_count IS DISTINCT FROM v_entries
     OR v_report.buy_in_total::numeric IS DISTINCT FROM v_pool
     OR v_report.cash_in_total::numeric IS DISTINCT FROM v_gross
     OR v_report.club_revenue::numeric IS DISTINCT FROM v_gross-v_pool
     OR v_gross < v_pool THEN
    RAISE EXCEPTION 'satellite_source_close_snapshot_stale' USING ERRCODE = '22023';
  END IF;
  v_ticket := v_plan.ticket_total::numeric * v_plan.target_entry_price_vnd::numeric;
  v_required := v_ticket + v_plan.cash_total_vnd::numeric;
  IF v_required <> v_plan.total_liability_vnd::numeric OR v_required > 9007199254740991 THEN
    RAISE EXCEPTION 'satellite_plan_liability_mismatch' USING ERRCODE = '23514';
  END IF;
  v_overlay := greatest(0, v_required - v_pool);
  IF p_overlay_vnd IS NOT NULL AND p_overlay_vnd::numeric <> v_overlay THEN
    RAISE EXCEPTION 'satellite_overlay_mismatch' USING ERRCODE = '22023';
  END IF;
  v_remaining := v_pool + v_overlay - v_required;
  SELECT * INTO v_existing FROM public.satellite_award_funding
    WHERE source_tournament_id = p_source_tournament_id;
  IF v_existing.source_tournament_id IS NOT NULL THEN
    IF v_existing.source_close_report_id IS DISTINCT FROM v_report.id
       OR v_existing.source_pool_vnd::numeric IS DISTINCT FROM v_pool
       OR v_existing.source_confirmed_gross_vnd::numeric IS DISTINCT FROM v_gross
       OR v_existing.source_entry_fees_vnd::numeric IS DISTINCT FROM v_gross-v_pool
       OR v_existing.ticket_liability_vnd::numeric IS DISTINCT FROM v_ticket
       OR v_existing.cash_liability_vnd IS DISTINCT FROM v_plan.cash_total_vnd
       OR v_existing.overlay_vnd IS DISTINCT FROM p_overlay_vnd THEN
      RAISE EXCEPTION 'satellite_funding_locked_different' USING ERRCODE = '23505';
    END IF;
  ELSIF p_lock THEN
    INSERT INTO public.satellite_award_funding (
      source_tournament_id, club_id, source_close_report_id,
      source_confirmed_gross_vnd, source_entry_fees_vnd, source_pool_vnd,
      ticket_liability_vnd, cash_liability_vnd, overlay_vnd, remaining_vnd, approved_by
    ) VALUES (
      p_source_tournament_id, v_source.club_id, v_report.id,
      v_gross::bigint, (v_gross-v_pool)::bigint, v_pool::bigint,
      v_ticket::bigint, v_plan.cash_total_vnd, p_overlay_vnd, v_remaining::bigint, v_actor
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'locked', (p_lock OR v_existing.source_tournament_id IS NOT NULL),
    'sourcePoolVnd', v_pool::bigint::text,
    'sourceConfirmedGrossVnd', v_gross::bigint::text,
    'sourceEntryFeesVnd', (v_gross-v_pool)::bigint::text,
    'ticketLiabilityVnd', v_ticket::bigint::text,
    'cashLiabilityVnd', v_plan.cash_total_vnd::text,
    'overlayVnd', v_overlay::bigint::text,
    'remainingVnd', v_remaining::bigint::text,
    'closeReportId', v_report.id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_approve_funding_v1(uuid,bigint,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_approve_funding_v1(uuid,bigint,boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.satellite_get_funding_v1(p_source_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_funding public.satellite_award_funding%ROWTYPE;
  v_can_approve boolean;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT t.club_id INTO v_club_id FROM public.tournaments t
    WHERE t.id = p_source_tournament_id AND t.operations_mode = 'satellite';
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'satellite_source_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.clubs c
                WHERE c.id = v_club_id AND c.owner_id = v_actor)
    INTO v_can_approve;
  IF NOT (v_can_approve OR public.is_club_floor(v_actor, v_club_id)
          OR public.has_role(v_actor, 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_funding FROM public.satellite_award_funding
    WHERE source_tournament_id = p_source_tournament_id;
  IF v_funding.source_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'locked', false, 'canApprove', v_can_approve);
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'locked', true, 'canApprove', v_can_approve,
    'sourcePoolVnd', v_funding.source_pool_vnd::text,
    'sourceConfirmedGrossVnd', v_funding.source_confirmed_gross_vnd::text,
    'sourceEntryFeesVnd', v_funding.source_entry_fees_vnd::text,
    'ticketLiabilityVnd', v_funding.ticket_liability_vnd::text,
    'cashLiabilityVnd', v_funding.cash_liability_vnd::text,
    'overlayVnd', v_funding.overlay_vnd::text,
    'remainingVnd', v_funding.remaining_vnd::text,
    'closeReportId', v_funding.source_close_report_id,
    'approvedAt', v_funding.approved_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_get_funding_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_get_funding_v1(uuid)
  TO authenticated;

-- Existing issue RPC does not know about source funding. This trigger makes
-- that invariant mandatory even if an old frontend calls the issue RPC.
CREATE OR REPLACE FUNCTION public.satellite_require_funding_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_funding public.satellite_award_funding%ROWTYPE;
  v_plan public.satellite_award_plans%ROWTYPE;
  v_report public.tournament_close_report%ROWTYPE;
BEGIN
  SELECT * INTO v_funding FROM public.satellite_award_funding
    WHERE source_tournament_id = NEW.source_tournament_id;
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id = NEW.source_tournament_id;
  SELECT * INTO v_report FROM public.tournament_close_report
    WHERE id = v_funding.source_close_report_id;
  IF v_funding.source_tournament_id IS NULL
     OR v_funding.club_id IS DISTINCT FROM NEW.club_id
     OR v_funding.source_close_report_id IS DISTINCT FROM v_report.id
     OR v_funding.ticket_liability_vnd::numeric IS DISTINCT FROM
        v_plan.ticket_total::numeric * v_plan.target_entry_price_vnd::numeric
     OR v_funding.cash_liability_vnd IS DISTINCT FROM NEW.cash_total_vnd
     OR v_funding.source_pool_vnd IS DISTINCT FROM v_report.buy_in_total
     OR v_funding.source_confirmed_gross_vnd IS DISTINCT FROM v_report.cash_in_total
     OR v_funding.source_entry_fees_vnd IS DISTINCT FROM v_report.club_revenue
     OR v_funding.source_pool_vnd::numeric + v_funding.overlay_vnd::numeric
        <> v_funding.ticket_liability_vnd::numeric +
           v_funding.cash_liability_vnd::numeric + v_funding.remaining_vnd::numeric THEN
    RAISE EXCEPTION 'satellite_funding_not_locked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS satellite_issue_requires_funding ON public.satellite_award_issues;
CREATE TRIGGER satellite_issue_requires_funding BEFORE INSERT
  ON public.satellite_award_issues FOR EACH ROW
  EXECUTE FUNCTION public.satellite_require_funding_v1();
REVOKE ALL ON FUNCTION public.satellite_require_funding_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.satellite_award_issues i
    LEFT JOIN public.satellite_award_funding f
      ON f.source_tournament_id = i.source_tournament_id
    WHERE f.source_tournament_id IS NULL
  ) THEN
    RAISE EXCEPTION 'satellite_existing_issues_without_funding'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
