-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule process-swing every minute
-- Uses anon key for auth (public key, safe to store)
SELECT cron.schedule(
  'process-swing-auto',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/process-swing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A'
    ),
    body := '{}'::jsonb
  );
  $$
);
