\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT coalesce((public.cashier_record_cash_buyin_v1(
  (SELECT id FROM public.tournament_registrations
   WHERE player_id='b1000000-0000-4000-8000-000000000002'),
  6600000,'b6000000-0000-4000-8000-000000000001')->>'already_recorded')::boolean,false);
SELECT pg_sleep(:hold_seconds);
COMMIT;
