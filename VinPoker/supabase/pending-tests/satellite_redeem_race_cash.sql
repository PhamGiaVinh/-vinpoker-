\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='6s';
SET LOCAL deadlock_timeout='500ms';
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
SELECT 1 FROM public.tournaments
 WHERE id='d3000000-0000-4000-8000-000000000012' FOR UPDATE;
SELECT pg_sleep(2);
DO $$ DECLARE v_result jsonb; BEGIN
 v_result:=public.cashier_create_app_registration_v1(
  'd3000000-0000-4000-8000-000000000012',
  'd1000000-0000-4000-8000-000000000014');
 IF v_result->>'ok' IS DISTINCT FROM 'true'
    OR v_result->>'already_registered' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'cash registration race did not create: %',v_result;
 END IF;
 INSERT INTO public.satellite_redeem_race_results(worker,outcome,registration_id)
 VALUES('cash','cash_pending',(v_result->>'registration_id')::uuid);
END $$;
COMMIT;
