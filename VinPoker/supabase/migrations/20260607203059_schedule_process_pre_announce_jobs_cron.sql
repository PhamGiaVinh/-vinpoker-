-- Phase 5 PR #2: Schedule process-pre-announce-jobs cron
-- Runs every 30s to drain pre_announce_jobs queue
-- Idempotent: schedules only if not already scheduled

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'process-pre-announce-jobs'
  ) THEN
    PERFORM cron.schedule(
      'process-pre-announce-jobs',
      '*/30 * * * * *',
      $cron$
      SELECT
        net.http_post(
          url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/process-pre-announce-jobs',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 28000
        ) AS request_id;
      $cron$
    );

    RAISE NOTICE 'Scheduled process-pre-announce-jobs cron job';
  ELSE
    RAISE NOTICE 'process-pre-announce-jobs cron job already exists, skipping';
  END IF;
END $$;
