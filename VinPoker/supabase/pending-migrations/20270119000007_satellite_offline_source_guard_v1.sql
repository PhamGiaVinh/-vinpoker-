-- Canonical Ops offline buy-in writes a confirmed registration and seat but no
-- Cashier movement or frozen price snapshot. It must not create Satellite
-- funding until an audited ledger-producing offline writer exists. The real
-- Ops RPC remains available to ordinary tournaments unchanged.
-- ROLLBACK: replace this trigger in a forward migration, retaining history.
CREATE OR REPLACE FUNCTION private.satellite_offline_source_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mode text;
BEGIN
  IF NEW.status='confirmed' AND NEW.price_snapshot IS NULL THEN
    SELECT t.operations_mode INTO v_mode FROM public.tournaments t
      WHERE t.id=NEW.tournament_id FOR SHARE;
    IF v_mode='satellite' THEN
      RAISE EXCEPTION 'satellite_offline_buyin_requires_cashier_ledger'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_offline_source_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_offline_source_guard_v1 ON public.tournament_registrations;
CREATE TRIGGER satellite_offline_source_guard_v1 BEFORE INSERT
  ON public.tournament_registrations FOR EACH ROW
  EXECUTE FUNCTION private.satellite_offline_source_guard_v1();
