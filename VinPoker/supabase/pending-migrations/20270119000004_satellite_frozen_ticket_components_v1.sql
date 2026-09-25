-- Forward-only target ticket component snapshot. Apply after #1334's write
-- hold and the award-plan / ticket-issue pending migrations. SOURCE ONLY.
-- Lock and Issue remain blocked by satellite_preview_write_hold_v1 and the
-- default-OFF Centerpoint release gate; this migration grants no writer.
-- Historical plans/tickets without a trustworthy split remain NULL, not a
-- guessed reconstruction from today's target tournament price. Such a plan
-- cannot issue a new ticket until separately reviewed and migrated.
-- ROLLBACK: revoke consumer access in a new migration; retain frozen monetary
-- columns and all historical rows. Never drop populated financial history.

ALTER TABLE public.satellite_award_plans
  ADD COLUMN IF NOT EXISTS target_buy_in_vnd bigint,
  ADD COLUMN IF NOT EXISTS target_fee_vnd bigint;
ALTER TABLE public.satellite_tickets
  ADD COLUMN IF NOT EXISTS target_buy_in_vnd bigint,
  ADD COLUMN IF NOT EXISTS target_fee_vnd bigint;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.satellite_award_plans'::pg_catalog.regclass
      AND conname='satellite_plan_target_components_v1') THEN
    ALTER TABLE public.satellite_award_plans
      ADD CONSTRAINT satellite_plan_target_components_v1 CHECK (
        (target_buy_in_vnd IS NULL AND target_fee_vnd IS NULL)
        OR (target_buy_in_vnd > 0 AND target_fee_vnd >= 0
            AND target_buy_in_vnd::numeric + target_fee_vnd::numeric = target_entry_price_vnd)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.satellite_tickets'::pg_catalog.regclass
      AND conname='satellite_ticket_target_components_v1') THEN
    ALTER TABLE public.satellite_tickets
      ADD CONSTRAINT satellite_ticket_target_components_v1 CHECK (
        (target_buy_in_vnd IS NULL AND target_fee_vnd IS NULL)
        OR (target_buy_in_vnd > 0 AND target_fee_vnd >= 0
            AND target_buy_in_vnd::numeric + target_fee_vnd::numeric = target_entry_price_vnd)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.satellite_capture_target_components_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_target public.tournaments%ROWTYPE;
  v_buy_in numeric;
  v_fee numeric;
BEGIN
  -- The existing award RPC already locks source/target tournaments before
  -- INSERT. This row lock also protects the direct service-role path and makes
  -- the component read agree with the existing total-price check.
  SELECT * INTO v_target FROM public.tournaments
  WHERE id = NEW.target_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_target.club_id IS DISTINCT FROM NEW.club_id
     OR v_target.operations_mode IS DISTINCT FROM 'standard'
     OR v_target.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'satellite_target_component_scope_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_target.buy_in IS NULL OR v_target.rake_amount IS NULL
     OR v_target.service_fee_amount IS NULL
     OR v_target.buy_in::text IN ('NaN','Infinity','-Infinity')
     OR v_target.rake_amount::text IN ('NaN','Infinity','-Infinity')
     OR v_target.service_fee_amount::text IN ('NaN','Infinity','-Infinity')
     OR v_target.buy_in::numeric <> pg_catalog.trunc(v_target.buy_in::numeric)
     OR v_target.rake_amount::numeric <> pg_catalog.trunc(v_target.rake_amount::numeric)
     OR v_target.service_fee_amount::numeric <> pg_catalog.trunc(v_target.service_fee_amount::numeric)
     OR v_target.rake_amount < 0 OR v_target.service_fee_amount < 0 THEN
    RAISE EXCEPTION 'satellite_target_component_price_mismatch' USING ERRCODE = '22023';
  END IF;
  v_buy_in := v_target.buy_in::numeric;
  v_fee := v_target.rake_amount::numeric + v_target.service_fee_amount::numeric;
  IF v_buy_in <= 0 OR v_fee < 0
     OR v_buy_in + v_fee IS DISTINCT FROM NEW.target_entry_price_vnd::numeric
     OR v_buy_in + v_fee > 9007199254740991 THEN
    RAISE EXCEPTION 'satellite_target_component_price_mismatch' USING ERRCODE = '22023';
  END IF;
  NEW.target_buy_in_vnd := v_buy_in::bigint;
  NEW.target_fee_vnd := v_fee::bigint;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.satellite_capture_target_components_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS satellite_capture_target_components_v1 ON public.satellite_award_plans;
CREATE TRIGGER satellite_capture_target_components_v1 BEFORE INSERT
  ON public.satellite_award_plans FOR EACH ROW
  EXECUTE FUNCTION private.satellite_capture_target_components_v1();

CREATE OR REPLACE FUNCTION private.satellite_copy_ticket_components_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan public.satellite_award_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.satellite_award_plans
    WHERE source_tournament_id = NEW.source_tournament_id;
  IF NOT FOUND OR v_plan.target_buy_in_vnd IS NULL OR v_plan.target_fee_vnd IS NULL
     OR v_plan.club_id IS DISTINCT FROM NEW.club_id
     OR v_plan.target_tournament_id IS DISTINCT FROM NEW.target_tournament_id
     OR v_plan.target_entry_price_vnd IS DISTINCT FROM NEW.target_entry_price_vnd THEN
    RAISE EXCEPTION 'satellite_ticket_frozen_components_required' USING ERRCODE = '23514';
  END IF;
  NEW.target_buy_in_vnd := v_plan.target_buy_in_vnd;
  NEW.target_fee_vnd := v_plan.target_fee_vnd;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.satellite_copy_ticket_components_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS satellite_copy_ticket_components_v1 ON public.satellite_tickets;
CREATE TRIGGER satellite_copy_ticket_components_v1 BEFORE INSERT
  ON public.satellite_tickets FOR EACH ROW
  EXECUTE FUNCTION private.satellite_copy_ticket_components_v1();

CREATE OR REPLACE FUNCTION private.satellite_frozen_components_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.target_entry_price_vnd, NEW.target_buy_in_vnd, NEW.target_fee_vnd)
     IS DISTINCT FROM
     ROW(OLD.target_entry_price_vnd, OLD.target_buy_in_vnd, OLD.target_fee_vnd) THEN
    RAISE EXCEPTION 'satellite_frozen_target_components_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.satellite_frozen_components_immutable_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS satellite_plan_components_immutable_v1 ON public.satellite_award_plans;
CREATE TRIGGER satellite_plan_components_immutable_v1 BEFORE UPDATE
  ON public.satellite_award_plans FOR EACH ROW
  EXECUTE FUNCTION private.satellite_frozen_components_immutable_v1();
DROP TRIGGER IF EXISTS satellite_ticket_components_immutable_v1 ON public.satellite_tickets;
CREATE TRIGGER satellite_ticket_components_immutable_v1 BEFORE UPDATE
  ON public.satellite_tickets FOR EACH ROW
  EXECUTE FUNCTION private.satellite_frozen_components_immutable_v1();
