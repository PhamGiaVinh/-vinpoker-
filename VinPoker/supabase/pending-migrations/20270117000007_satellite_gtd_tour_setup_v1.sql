-- PENDING SOURCE ONLY. Satellite target and minimum tickets are decided in Floor
-- tour setup, never inferred from a monetary GTD or selected later at Cashier.
-- Depends on Satellite 01 (operations_mode) and 06 (server quote).
-- ROLLBACK: keep satelliteAwardsV1 OFF; use a reviewed forward migration.
-- Preserve any configured tour and locked financial history.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS satellite_target_tournament_id uuid
    REFERENCES public.tournaments(id) ON DELETE RESTRICT;
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS satellite_gtd_tickets integer;

-- Stop rather than silently assign a target or GTD to a preexisting tour.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tournaments t
             WHERE t.operations_mode = 'satellite'
               AND (t.satellite_target_tournament_id IS NULL
                    OR t.satellite_gtd_tickets IS NULL)) THEN
    RAISE EXCEPTION 'satellite_existing_tours_need_setup_review' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.tournaments'::regclass
                   AND conname = 'satellite_tour_setup_shape_v1') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT satellite_tour_setup_shape_v1
      CHECK (
        (operations_mode = 'satellite'
          AND satellite_target_tournament_id IS NOT NULL
          AND satellite_gtd_tickets BETWEEN 1 AND 500
          AND guarantee_amount IS NULL)
        OR (operations_mode <> 'satellite'
          AND satellite_target_tournament_id IS NULL
          AND satellite_gtd_tickets IS NULL)
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.satellite_tour_setup_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_target public.tournaments%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.operations_mode = 'satellite'
       AND NEW.club_id IS DISTINCT FROM OLD.club_id THEN
      RAISE EXCEPTION 'satellite_club_immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.operations_mode IS DISTINCT FROM 'satellite'
       AND NEW.operations_mode = 'satellite'
       AND (OLD.status::text <> 'scheduled'
         OR EXISTS (SELECT 1 FROM public.tournament_registrations r
                    WHERE r.tournament_id = OLD.id)) THEN
      RAISE EXCEPTION 'satellite_setup_after_registration' USING ERRCODE = '23514';
    END IF;
    IF OLD.operations_mode = 'satellite'
       AND NEW.operations_mode IS DISTINCT FROM 'satellite'
       AND (OLD.status::text <> 'scheduled'
         OR EXISTS (SELECT 1 FROM public.tournament_registrations r
                    WHERE r.tournament_id = OLD.id)
         OR EXISTS (SELECT 1 FROM public.satellite_award_plans p
                    WHERE p.source_tournament_id = OLD.id)) THEN
      RAISE EXCEPTION 'satellite_setup_frozen' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.operations_mode IS DISTINCT FROM 'satellite' THEN RETURN NEW; END IF;
  IF NEW.satellite_target_tournament_id IS NULL
     OR NEW.satellite_target_tournament_id = NEW.id
     OR NEW.satellite_gtd_tickets IS NULL
     OR NEW.satellite_gtd_tickets NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'satellite_target_and_gtd_required' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status::text <> 'scheduled' THEN
    RAISE EXCEPTION 'satellite_must_start_scheduled' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD.satellite_target_tournament_id, OLD.satellite_gtd_tickets)
       IS NOT DISTINCT FROM ROW(NEW.satellite_target_tournament_id, NEW.satellite_gtd_tickets) THEN
      RETURN NEW;
    END IF;
    IF OLD.status::text <> 'scheduled'
       OR EXISTS (SELECT 1 FROM public.tournament_registrations r
                  WHERE r.tournament_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.satellite_award_plans p
                  WHERE p.source_tournament_id = OLD.id) THEN
      RAISE EXCEPTION 'satellite_setup_frozen' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT * INTO v_target FROM public.tournaments t
    WHERE t.id = NEW.satellite_target_tournament_id FOR SHARE;
  IF v_target.id IS NULL
     OR v_target.club_id IS DISTINCT FROM NEW.club_id
     OR v_target.operations_mode IS DISTINCT FROM 'standard'
     OR v_target.deleted_at IS NOT NULL
     OR v_target.status::text NOT IN ('scheduled', 'live')
     OR v_target.registration_closed_at IS NOT NULL
     OR v_target.buy_in IS NULL OR v_target.buy_in <= 0
     OR v_target.rake_amount IS NULL OR v_target.rake_amount < 0
     OR v_target.service_fee_amount IS NULL OR v_target.service_fee_amount < 0 THEN
    RAISE EXCEPTION 'satellite_target_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS satellite_tour_setup_guard_v1 ON public.tournaments;
CREATE TRIGGER satellite_tour_setup_guard_v1
  BEFORE INSERT OR UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.satellite_tour_setup_guard_v1();
REVOKE ALL ON FUNCTION public.satellite_tour_setup_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role;
