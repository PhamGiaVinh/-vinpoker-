
-- 1. Unique partial index: 1 active deal per (player, tournament)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_deal_per_tournament_player
  ON public.staking_deals (player_id, tournament_id)
  WHERE tournament_id IS NOT NULL
    AND status NOT IN ('completed','cancelled');

-- 2. Add deal_expiring_soon to notification_type enum
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'deal_expiring_soon';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'deal_auto_closed';

-- 3. Function: notify backers whose committed purchases are about to expire
CREATE OR REPLACE FUNCTION public.notify_expiring_commits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cnt INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id AS purchase_id, p.deal_id, p.backer_id, p.percent,
           d.custom_event_name, d.id AS d_id
    FROM public.staking_purchases p
    JOIN public.staking_deals d ON d.id = p.deal_id
    WHERE p.status = 'committed'
      AND p.committed_at < (now() - INTERVAL '25 minutes')
      AND p.committed_at > (now() - INTERVAL '26 minutes')
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.backer_id,
      'deal_expiring_soon',
      'Sắp hết hạn chuyển khoản',
      'Cam kết của bạn cho deal "' || COALESCE(r.custom_event_name, 'Deal') || '" sẽ tự huỷ sau ~5 phút nếu chưa hoàn tất chuyển khoản.',
      jsonb_build_object('deal_id', r.d_id, 'purchase_id', r.purchase_id, 'minutes_left', 5)
    );
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

-- 4. Cron: run notifier every minute
DO $$
BEGIN
  PERFORM cron.unschedule('notify-expiring-commits');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('notify-expiring-commits', '* * * * *', $$SELECT public.notify_expiring_commits();$$);
