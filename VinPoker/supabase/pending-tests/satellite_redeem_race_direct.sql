\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='6s';
SET LOCAL deadlock_timeout='500ms';
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('test.worker',:'worker',true);
SELECT set_config('test.player',:'player',true);
DO $$ DECLARE v_reg uuid; v_error text; BEGIN
 BEGIN
  INSERT INTO public.tournament_registrations
   (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status)
  VALUES('d3000000-0000-4000-8000-000000000012',
   current_setting('test.player')::uuid,
   'd2000000-0000-4000-8000-000000000011',6000000,6600000,
   'SAT-DIRECT-'||current_setting('test.worker'),'pending')
  RETURNING id INTO v_reg;
  INSERT INTO public.satellite_redeem_race_results(worker,outcome,registration_id)
  VALUES(current_setting('test.worker'),'direct_pending',v_reg);
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
  IF v_error <> 'satellite_target_player_already_seated' THEN RAISE; END IF;
  INSERT INTO public.satellite_redeem_race_results(worker,outcome)
  VALUES(current_setting('test.worker'),v_error);
 END;
END $$;
SELECT pg_sleep(:hold_seconds);
COMMIT;
