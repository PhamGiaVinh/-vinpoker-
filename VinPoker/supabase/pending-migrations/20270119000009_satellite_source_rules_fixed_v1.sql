-- Satellite entry economics and starting-chip rules become immutable as soon
-- as a source registration or Cashier movement exists. Ordinary Floor state
-- (seats, chips, hands, live status) is not covered by this trigger.
-- ROLLBACK: replace this guard in a forward migration; retain source history.
CREATE OR REPLACE FUNCTION private.satellite_source_rules_fixed_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.operations_mode='satellite'
     AND ROW(NEW.buy_in,NEW.rake_amount,NEW.service_fee_amount,
             NEW.starting_stack,NEW.free_rake_enabled,NEW.free_rake_slots)
         IS DISTINCT FROM
         ROW(OLD.buy_in,OLD.rake_amount,OLD.service_fee_amount,
             OLD.starting_stack,OLD.free_rake_enabled,OLD.free_rake_slots)
     AND (EXISTS (SELECT 1 FROM public.tournament_registrations r
                  WHERE r.tournament_id=OLD.id)
          OR EXISTS (SELECT 1 FROM public.cashier_buyin_movements m
                     WHERE m.tournament_id=OLD.id)) THEN
    RAISE EXCEPTION 'satellite_source_rules_fixed_after_source'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_source_rules_fixed_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_source_rules_fixed_v1 ON public.tournaments;
CREATE TRIGGER satellite_source_rules_fixed_v1 BEFORE UPDATE
  ON public.tournaments FOR EACH ROW
  EXECUTE FUNCTION private.satellite_source_rules_fixed_v1();
