SELECT cron.schedule(
  'archive-old-chats-daily',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url:='https://tprwipyoqtfdclnamwjt.supabase.co/functions/v1/archive-old-chats',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcndpcHlvcXRmZGNsbmFtd2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NDIwODAsImV4cCI6MjA5MjQxODA4MH0.HeyJ-riIG7jcZxUc0k2jPncByU6H92gNtCu1FZtCKVU"}'::jsonb,
    body:=concat('{"time":"', now(), '"}')::jsonb
  );
  $$
);