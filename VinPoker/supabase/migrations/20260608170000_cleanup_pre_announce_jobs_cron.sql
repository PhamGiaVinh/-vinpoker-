-- Phase 5 PR #3: Cleanup pre_announce_jobs daily at 3 AM
-- Deletes sent/failed/cancelled jobs older than 24 hours

SELECT cron.schedule(
  'cleanup-pre-announce-jobs',
  '0 3 * * *',
  $$
  DELETE FROM public.pre_announce_jobs
  WHERE status IN ('sent', 'failed', 'cancelled')
    AND created_at < now() - interval '24 hours';
  $$
);