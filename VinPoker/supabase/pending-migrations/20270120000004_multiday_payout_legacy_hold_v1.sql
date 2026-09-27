-- SOURCE ONLY. Package Final Day payout remains held until a verified
-- contribution/overlay/obligation snapshot and atomic finalize writer exist.
-- This is not a payout writer and does not treat a GTD shortfall as money.
-- Existing single-day and non-package payout paths are unchanged.
-- ROLLBACK: replace this guard with a forward, server-owned payout writer;
-- preserve historical prize/payment/run rows and do not rewrite paid amounts.
DO $preflight$ BEGIN
 IF to_regclass('public.tournament_prizes') IS NULL OR
    to_regclass('public.tournament_payout_runs') IS NULL OR
    to_regclass('public.tournament_prize_payments') IS NULL THEN
   RAISE EXCEPTION 'multi_day_payout_baseline_missing' USING ERRCODE='23514';
 END IF;
END $preflight$;

CREATE FUNCTION private.multi_day_legacy_payout_hold_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tournament uuid; v_event uuid; v_pass integer;
BEGIN
 FOR v_pass IN 1..CASE WHEN TG_OP='UPDATE' THEN 2 ELSE 1 END LOOP
   IF v_pass=1 AND TG_OP<>'INSERT' THEN
     v_tournament:=OLD.tournament_id;
   ELSE
     v_tournament:=NEW.tournament_id;
   END IF;
   SELECT e.id INTO v_event FROM public.tournaments t
     JOIN public.tournament_events e ON e.id=t.event_id
     WHERE t.id=v_tournament AND t.phase='final'
     FOR SHARE OF e;
   IF v_event IS NOT NULL AND (
      EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=v_event)
      OR EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 q
        WHERE q.event_id=v_event)
      OR EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
        JOIN public.multi_day_package_release_v1 g ON g.id AND g.enabled
          AND r.club_id=ANY(g.allowed_club_ids) WHERE r.event_id=v_event)) THEN
     RAISE EXCEPTION 'multi_day_verified_payout_writer_required' USING ERRCODE='42501';
   END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_legacy_payout_hold_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_legacy_prize_hold_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_prizes FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_legacy_payout_hold_v1();
CREATE TRIGGER multi_day_legacy_payout_run_hold_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_payout_runs FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_legacy_payout_hold_v1();
CREATE TRIGGER multi_day_legacy_payment_hold_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_prize_payments FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_legacy_payout_hold_v1();
