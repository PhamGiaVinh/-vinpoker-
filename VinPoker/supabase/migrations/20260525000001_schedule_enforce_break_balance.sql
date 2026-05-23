-- Schedule enforceBreakBalance edge function every 15 minutes via pg_cron
-- Requires pg_cron extension (pre-installed on Supabase)

-- Ensure pg_cron extension is available
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule: every 15 minutes
-- Calls the edge function with service role via pg_net.http_post
-- The edge function uses the Authorization header to validate the caller
SELECT cron.schedule(
  'enforce-break-balance',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/enforceBreakBalance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- NOTE: 
-- 1. The service_role_key must be set via: 
--    ALTER DATABASE postgres SET "app.settings.service_role_key" TO '<your_service_role_key>';
-- 2. Alternatively, run in SQL Editor:
--    SELECT cron.schedule('enforce-break-balance', '*/15 * * * *', $$SELECT net.http_post(url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/enforceBreakBalance', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <service_role_key>'), body := '{}'::jsonb) AS request_id;$$);
-- 3. View scheduled jobs: SELECT * FROM cron.job;
-- 4. Unschedule: SELECT cron.unschedule('enforce-break-balance');
