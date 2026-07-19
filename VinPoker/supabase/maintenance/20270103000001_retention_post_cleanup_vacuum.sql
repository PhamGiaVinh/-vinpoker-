-- OWNER-RUN POST-CLEANUP MAINTENANCE — production mutation, never autonomous.
-- Run ONE selected VACUUM statement at a time, outside BEGIN/COMMIT, after the
-- first controlled cleanup batches finish. These commands update statistics and
-- make dead tuples reusable; they do not shrink the physical files.
--
-- net._http_response is intentionally absent. Do not TRUNCATE or VACUUM FULL it
-- as part of this rollout.

VACUUM (ANALYZE) public.dealer_rotation_schedule;

VACUUM (ANALYZE) cron.job_run_details;

VACUUM (ANALYZE) public.diagnostic_logs;

VACUUM (ANALYZE) public.cron_metrics;
