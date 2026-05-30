CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Remove old job if exists
DO $$
BEGIN
  PERFORM cron.unschedule('auto-publish-news-scheduled');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-publish-news-scheduled',
  '* * * * *',
  $$
    UPDATE public.news_posts
       SET status = 'published',
           updated_at = now()
     WHERE status = 'scheduled'
       AND published_at IS NOT NULL
       AND published_at <= now();
  $$
);