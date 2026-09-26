\set ON_ERROR_STOP on
DO $$ BEGIN
 IF (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='ticket-a' AND outcome='redeemed') IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='ticket-b' AND outcome='satellite_player_already_seated')
      IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='cash' AND outcome='cash_pending') IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='ticket-after-cash'
       AND outcome='satellite_initial_entry_already_exists') IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='direct-first' AND outcome='direct_pending') IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='ticket-after-direct'
       AND outcome='satellite_initial_entry_already_exists') IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='ticket-first' AND outcome='redeemed') IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.satellite_redeem_race_results
     WHERE worker='direct-after-ticket'
       AND outcome='satellite_target_player_already_seated') IS DISTINCT FROM true
  OR (SELECT count(*)=2 FROM public.satellite_ticket_value_transfers) IS DISTINCT FROM true
  OR (SELECT count(*)=0 FROM public.cashier_buyin_movements m
      JOIN public.satellite_ticket_value_transfers t
        ON t.registration_id=m.registration_id) IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.tournament_registrations
      WHERE tournament_id='d3000000-0000-4000-8000-000000000012'
        AND player_id='d1000000-0000-4000-8000-000000000013'
        AND status='confirmed') IS DISTINCT FROM true
  OR (SELECT count(*)=1 FROM public.tournament_registrations
      WHERE tournament_id='d3000000-0000-4000-8000-000000000012'
        AND player_id='d1000000-0000-4000-8000-000000000014'
        AND status='pending') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Satellite Redeem concurrent conservation/eligibility failed';
 END IF;
END $$;
