-- 1. Add registration_deadline column
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ;

-- 2. Function to auto-close deals past their registration deadline
CREATE OR REPLACE FUNCTION public.auto_close_expired_deals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR d IN
    SELECT id, status, filled_percent, percentage_sold, player_id, custom_event_name
    FROM public.staking_deals
    WHERE registration_deadline IS NOT NULL
      AND registration_deadline < now()
      AND status IN ('listing'::staking_deal_status, 'committing'::staking_deal_status)
      AND early_closed = false
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.staking_deals
    SET early_closed = true,
        early_closed_at = now(),
        status = CASE
          WHEN filled_percent > 0 THEN 'committed'::staking_deal_status
          ELSE 'cancelled'::staking_deal_status
        END,
        cancellation_reason = CASE
          WHEN filled_percent = 0 THEN 'registration_deadline_no_backers'
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = d.id;

    INSERT INTO public.staking_audit_logs (deal_id, action, performed_by, old_status, new_status, metadata)
    VALUES (
      d.id, 'auto_closed_deadline', NULL, d.status::text,
      CASE WHEN d.filled_percent > 0 THEN 'committed' ELSE 'cancelled' END,
      jsonb_build_object('filled_percent', d.filled_percent, 'percentage_sold', d.percentage_sold)
    );

    -- Notify player
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      d.player_id, 'deal_auto_closed',
      'Deal đã đóng đăng ký',
      'Deal "' || COALESCE(d.custom_event_name, 'Deal') || '" đã đóng vì hết hạn đăng ký. Đã bán ' || d.filled_percent || '/' || d.percentage_sold || '%.',
      jsonb_build_object('deal_id', d.id, 'filled_percent', d.filled_percent)
    )
    ON CONFLICT DO NOTHING;

    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

-- 3. Schedule cron job (every minute)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-expired-deals') THEN
    PERFORM cron.schedule(
      'auto-close-expired-deals',
      '* * * * *',
      $cron$ SELECT public.auto_close_expired_deals(); $cron$
    );
  END IF;
END $$;