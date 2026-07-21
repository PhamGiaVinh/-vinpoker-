-- OWNER-RUN MAINTENANCE STEP — production mutation, never autonomous.
-- Run this statement ALONE (not inside BEGIN/COMMIT and not through db push).
-- CREATE INDEX CONCURRENTLY avoids a long exclusive table lock.
--
-- Verify after completion:
--   SELECT to_regclass('cron.idx_job_run_details_start_time');
--
-- ROLLBACK (also run alone):
--   DROP INDEX CONCURRENTLY IF EXISTS cron.idx_job_run_details_start_time;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_run_details_start_time
  ON cron.job_run_details (start_time);
