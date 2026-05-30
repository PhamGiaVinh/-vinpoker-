SELECT cron.unschedule('notify-expiring-commits');
SELECT cron.schedule('notify-expiring-commits', '*/2 * * * *', 'SELECT public.notify_expiring_commits();');