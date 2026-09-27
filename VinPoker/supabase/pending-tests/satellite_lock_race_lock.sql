\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL deadlock_timeout='500ms';
SELECT set_config('request.jwt.claim.sub','ba000000-0000-4000-8000-000000000001',true);
SELECT (public.satellite_lock_award_plan_v1(
  :'source'::uuid,'bc000000-0000-4000-8000-000000000003',
  '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',
  (SELECT preview_revision FROM public.satellite_lock_race_expected
   WHERE source_tournament_id=:'source'::uuid),
  :'request'::uuid)->>'idempotent')::boolean;
SELECT pg_sleep(:hold_seconds);
COMMIT;
