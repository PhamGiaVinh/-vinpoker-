-- Source-only Satellite entry eligibility fence after the registration cutoff.
-- Floor bust, move, chip and seat updates remain outside this funding fence.
-- ROLLBACK: replace this trigger in a forward migration; preserve entry history.
CREATE OR REPLACE FUNCTION private.satellite_entry_cutoff_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tour public.tournaments%ROWTYPE;
  v_tour_id uuid;
BEGIN
  v_tour_id := CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
  IF TG_OP='UPDATE' AND
     ROW(NEW.tournament_id,NEW.registration_id,NEW.player_id,NEW.entry_no,
         NEW.source,(NEW.status='cancelled')) IS NOT DISTINCT FROM
     ROW(OLD.tournament_id,OLD.registration_id,OLD.player_id,OLD.entry_no,
         OLD.source,(OLD.status='cancelled')) THEN
    RETURN NEW;
  END IF;
  -- Source entries are tied to registrations, which make Satellite mode
  -- immutable. No tournament-row lock is taken for ordinary Floor changes.
  SELECT * INTO v_tour FROM public.tournaments WHERE id=v_tour_id FOR SHARE;
  IF v_tour.operations_mode IS DISTINCT FROM 'satellite' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'satellite_entry_history_immutable' USING ERRCODE='23514';
  END IF;
  IF v_tour.registration_closed_at IS NOT NULL THEN
    IF TG_OP='INSERT' OR
       ROW(NEW.tournament_id,NEW.registration_id,NEW.player_id,NEW.entry_no,
           NEW.source) IS DISTINCT FROM
       ROW(OLD.tournament_id,OLD.registration_id,OLD.player_id,OLD.entry_no,
           OLD.source) OR
       (OLD.status='cancelled' AND NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'satellite_entry_cutoff_frozen' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.satellite_award_plans p
               WHERE p.source_tournament_id=v_tour.id)
       AND (NEW.status='cancelled') IS DISTINCT FROM (OLD.status='cancelled') THEN
      RAISE EXCEPTION 'satellite_entry_after_lock_requires_adjustment' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_entry_cutoff_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_entry_cutoff_v1 ON public.tournament_entries;
CREATE TRIGGER satellite_entry_cutoff_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.tournament_entries FOR EACH ROW
  EXECUTE FUNCTION private.satellite_entry_cutoff_v1();
