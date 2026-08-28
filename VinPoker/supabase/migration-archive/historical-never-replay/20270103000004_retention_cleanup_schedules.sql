-- ============================================================================
-- 20270103000004_retention_cleanup_schedules.sql
--
-- Activates the bounded retention helpers only after the owner-created
-- CONCURRENTLY index on cron.job_run_details(start_time) is present. Four jobs
-- run hourly at staggered minutes, so cleanup does not create a concurrency
-- spike and each transaction deletes at most 5,000 rows.
--
-- APPLY ONLY AFTER:
--   1. PR1/PR2 performance changes have been monitored for 24 hours.
--   2. A production backup completed.
--   3. supabase/maintenance/20270103000000_cron_run_details_index.sql completed.
--
-- OWNER-GATED APPLY. Do not apply autonomously.
--
-- ROLLBACK (owner-gated): unschedule the four job names below. Keep the cleanup
-- functions inert for inspection until the rollback is verified.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('cron.idx_job_run_details_start_time') IS NULL THEN
    RAISE EXCEPTION
      'cron.idx_job_run_details_start_time is required before retention schedules';
  END IF;
END;
$$;

DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'retention-rotation-schedule',
      'retention-cron-job-runs',
      'retention-diagnostic-logs',
      'retention-cron-metrics'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$$;

-- Staggered hourly execution; no two retention jobs share a minute.
SELECT cron.schedule(
  'retention-rotation-schedule',
  '7 * * * *',
  $$SELECT public.cleanup_next_dealer_rotation_schedule(5000);$$
);

SELECT cron.schedule(
  'retention-cron-job-runs',
  '17 * * * *',
  $$SELECT public.cleanup_cron_job_run_details(5000);$$
);

SELECT cron.schedule(
  'retention-diagnostic-logs',
  '27 * * * *',
  $$SELECT public.cleanup_diagnostic_logs(5000);$$
);

SELECT cron.schedule(
  'retention-cron-metrics',
  '37 * * * *',
  $$SELECT public.cleanup_next_cron_metrics(5000);$$
);

COMMIT;
