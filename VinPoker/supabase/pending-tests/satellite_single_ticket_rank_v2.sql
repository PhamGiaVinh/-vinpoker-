-- Disposable database only, after both pending award-plan migrations.
-- Do not run on the linked production project.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
BEGIN
  IF NOT public.satellite_single_ticket_awards_v2(
      '[{"position":1,"ticketCount":1,"cashVnd":"0"},{"position":2,"ticketCount":0,"cashVnd":"1000000"}]'::jsonb)
     OR public.satellite_single_ticket_awards_v2(
      '[{"position":1,"ticketCount":2,"cashVnd":"0"}]'::jsonb)
     OR public.satellite_single_ticket_awards_v2('null'::jsonb) THEN
    RAISE EXCEPTION 'single-ticket predicate mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.satellite_award_plans'::pg_catalog.regclass
      AND conname = 'satellite_award_one_ticket_per_rank_v2') THEN
    RAISE EXCEPTION 'single-ticket table constraint missing';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated',
      'public.satellite_award_plan_v1(uuid,uuid,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'old multi-ticket RPC remains callable';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated',
      'public.satellite_award_plan_v2(uuid,uuid,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'new RPC is unavailable';
  END IF;
END $test$;

ROLLBACK;
