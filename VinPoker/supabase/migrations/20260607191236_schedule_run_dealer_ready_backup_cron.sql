-- PR #1 Hotfix: Schedule the 60s backup cron
-- The EF was deployed in commit ee7e5b6 but pg_cron.schedule was not added.
-- Without this, the backup safety net never runs.

SELECT cron.schedule(
  'run-dealer-ready-backup',
  '* * * * *',  -- every 60s
  $cmd$
  SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/run-dealer-ready-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);
