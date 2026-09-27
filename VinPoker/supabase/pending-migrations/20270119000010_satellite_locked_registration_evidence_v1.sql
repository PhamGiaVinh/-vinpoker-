-- After Lock, registration funding evidence is immutable. Floor-only seating
-- error/proof/update timestamps remain outside this projection.
-- ROLLBACK: replace this trigger in a forward migration; preserve audit rows.
CREATE OR REPLACE FUNCTION private.satellite_locked_registration_evidence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tour public.tournaments%ROWTYPE;
BEGIN
  IF ROW(NEW.tournament_id,NEW.player_id,NEW.club_id,NEW.buy_in,
         NEW.platform_fixed_fee,NEW.total_pay,NEW.reference_code,
         NEW.price_snapshot,NEW.status,NEW.cashier_paid_at,NEW.confirmed_at,
         NEW.confirmed_by,NEW.cancelled_at,NEW.cancellation_reason)
     IS NOT DISTINCT FROM
     ROW(OLD.tournament_id,OLD.player_id,OLD.club_id,OLD.buy_in,
         OLD.platform_fixed_fee,OLD.total_pay,OLD.reference_code,
         OLD.price_snapshot,OLD.status,OLD.cashier_paid_at,OLD.confirmed_at,
         OLD.confirmed_by,OLD.cancelled_at,OLD.cancellation_reason) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_tour FROM public.tournaments
    WHERE id=OLD.tournament_id FOR SHARE;
  IF v_tour.operations_mode='satellite' AND EXISTS (
    SELECT 1 FROM public.satellite_award_plans p
    WHERE p.source_tournament_id=OLD.tournament_id) THEN
    RAISE EXCEPTION 'satellite_locked_registration_evidence_immutable'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_locked_registration_evidence_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_locked_registration_evidence_v1
  ON public.tournament_registrations;
CREATE TRIGGER satellite_locked_registration_evidence_v1 BEFORE UPDATE
  ON public.tournament_registrations FOR EACH ROW
  EXECUTE FUNCTION private.satellite_locked_registration_evidence_v1();
