-- Remove duplicate cron job that uses anon key instead of service_role.
-- Keep jobid=8 (process-swing, uses current_setting('secrets.service_role_key'))
-- Drop jobid=19 (process-swing-auto, hardcoded anon token)
-- Safe unschedule: only attempt if the job exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing-auto') THEN
    PERFORM cron.unschedule('process-swing-auto');
  END IF;
END $$;
