\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='6s';
SET LOCAL deadlock_timeout='500ms';
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
SELECT set_config('test.serial',:'serial',true);
SELECT set_config('test.worker',:'worker',true);
SELECT set_config('test.player',:'player',true);
SELECT set_config('test.request',:'request',true);
SELECT 1 FROM public.tournaments
 WHERE id='d3000000-0000-4000-8000-000000000012' FOR UPDATE;
SELECT pg_sleep(:hold_seconds);
DO $$ DECLARE v_code uuid; v_result jsonb; v_error text; BEGIN
 SELECT redemption_code INTO v_code FROM public.satellite_tickets
 WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
 AND serial_no=current_setting('test.serial')::integer;
 BEGIN
  v_result:=public.satellite_redeem_ticket_v1(v_code,
    current_setting('test.request')::uuid,current_setting('test.player')::uuid);
  INSERT INTO public.satellite_redeem_race_results(worker,outcome,registration_id)
  VALUES(current_setting('test.worker'),'redeemed',(v_result->>'registrationId')::uuid);
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
  IF v_error NOT IN ('satellite_player_already_seated',
     'satellite_initial_entry_already_exists') THEN RAISE; END IF;
  INSERT INTO public.satellite_redeem_race_results(worker,outcome)
  VALUES(current_setting('test.worker'),v_error);
 END;
END $$;
COMMIT;
