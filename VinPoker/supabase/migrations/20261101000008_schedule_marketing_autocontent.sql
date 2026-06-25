-- Marketing module (MKT-7 Part 2) — schedule the marketing-autocontent generator via pg_cron.
--
-- SOURCE-ONLY. Apply AFTER 000007 is applied + the marketing-autocontent Edge fn is deployed.
-- Runs every 30 minutes; the generator only creates DRAFTS, idempotently (one per deterministic
-- client_request_id), so frequent ticks are safe: schedule → 1 draft/day (06:00-09:00 VN window),
-- livestream → 1 draft/stream, overlay → 1 draft/tournament/day. Generates nothing for clubs whose
-- marketing_auto_jobs row is disabled (default).
-- The Bearer is the PUBLIC anon JWT (cron→fn gate only; the fn uses its own service-role key).
-- Idempotent: schedules only if not already scheduled.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-autocontent') THEN
    PERFORM cron.schedule(
      'marketing-autocontent',
      '*/30 * * * *',
      $cron$
      SELECT
        net.http_post(
          url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/marketing-autocontent',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 28000
        ) AS request_id;
      $cron$
    );
    RAISE NOTICE 'Scheduled marketing-autocontent cron job';
  ELSE
    RAISE NOTICE 'marketing-autocontent cron job already exists, skipping';
  END IF;
END $$;

-- ROLLBACK: SELECT cron.unschedule('marketing-autocontent');
