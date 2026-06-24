-- Marketing module (MKT-3) — schedule the marketing-dispatch Edge fn via pg_cron.
--
-- SOURCE-ONLY migration. APPLY LAST, and ONLY AFTER:
--   1. 000000 + 000001 + 000002 are applied in a controlled session, AND
--   2. the `marketing-dispatch` Edge function is deployed (it has been dry-invoked with no due
--      posts and returned cleanly), AND
--   3. TELEGRAM_BOT_TOKEN is present in the project's Edge secrets.
-- If you schedule this BEFORE the function/secret exist, the cron will fail every minute.
--
-- Runs every minute (pg_cron minimum). Idempotent: schedules only if not already scheduled.
-- The Authorization Bearer is the PUBLIC anon JWT (already committed in other cron migrations,
-- e.g. 20260607203059) — it is NOT a secret; the function authenticates the work via the
-- service-role key it reads from its own env, not from this header.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-dispatch') THEN
    PERFORM cron.schedule(
      'marketing-dispatch',
      '* * * * *',  -- every minute (pg_cron minimum resolution)
      $cron$
      SELECT
        net.http_post(
          url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/marketing-dispatch',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 28000
        ) AS request_id;
      $cron$
    );
    RAISE NOTICE 'Scheduled marketing-dispatch cron job';
  ELSE
    RAISE NOTICE 'marketing-dispatch cron job already exists, skipping';
  END IF;
END $$;

-- ROLLBACK: SELECT cron.unschedule('marketing-dispatch');
