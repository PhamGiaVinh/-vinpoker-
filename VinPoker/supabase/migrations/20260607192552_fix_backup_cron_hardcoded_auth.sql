-- PR #1 Hotfix v3: Re-schedule backup cron with hardcoded anon key
-- Previous schedule used current_setting('app.settings.service_role_key')
-- which is unset in this DB, causing every cron run to fail.
-- Use the anon key directly (same pattern as process-swing cron).

DO $$
DECLARE
  v_jobid INTEGER;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'run-dealer-ready-backup';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'run-dealer-ready-backup',
  '* * * * *',  -- every 60s
  $cmd$
  SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/run-dealer-ready-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);
