SELECT cron.schedule(
  'archive-old-chats-daily',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url:='https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/archive-old-chats',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A"}'::jsonb,
    body:=concat('{"time":"', now(), '"}')::jsonb
  );
  $$
);