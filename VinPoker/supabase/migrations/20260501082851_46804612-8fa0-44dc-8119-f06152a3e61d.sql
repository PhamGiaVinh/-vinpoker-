
-- Notification type enum
DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'deal_committed',
    'deal_funded',
    'deal_auto_cancelled',
    'result_entered',
    'result_verified',
    'result_disputed',
    'release_requested',
    'payout_executed',
    'system_announcement'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- Idempotency: at most one (user, type, deal_id) for lifecycle types
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_lifecycle
  ON public.notifications(user_id, type, ((data->>'deal_id')))
  WHERE type IN (
    'deal_committed','deal_funded','deal_auto_cancelled',
    'result_entered','result_verified','result_disputed',
    'release_requested','payout_executed'
  );

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
CREATE POLICY "Users view own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;
CREATE POLICY "Users delete own notifications"
  ON public.notifications FOR DELETE
  USING (user_id = auth.uid());

-- No INSERT policy: only triggers (SECURITY DEFINER) and admins can insert.

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger function
CREATE OR REPLACE FUNCTION public.fn_deal_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _label TEXT;
BEGIN
  _label := COALESCE(NEW.custom_event_name, 'Deal #' || substr(NEW.id::text, 1, 6));

  -- Player: deal funded
  IF NEW.status = 'funded' AND OLD.status = 'committed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.player_id, 'deal_funded',
      'Tiền đã khóa trong escrow',
      'Deal "' || _label || '" đã được xác nhận. Bạn có thể thi đấu ngay.',
      jsonb_build_object('deal_id', NEW.id, 'label', _label))
    ON CONFLICT DO NOTHING;
  END IF;

  -- Player: deal committed (backer just committed)
  IF NEW.status = 'committed' AND OLD.status = 'listing' AND NEW.backer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.player_id, 'deal_committed',
      'Có Backer cam kết deal của bạn',
      'Backer vừa cam kết deal "' || _label || '". Đang chờ Admin xác nhận tiền.',
      jsonb_build_object('deal_id', NEW.id, 'label', _label))
    ON CONFLICT DO NOTHING;
  END IF;

  -- Auto-cancel timeout: notify both player and (released) backer
  IF NEW.status = 'listing' AND OLD.status = 'committed'
     AND NEW.cancellation_reason = 'auto_cancelled_timeout' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.player_id, 'deal_auto_cancelled',
      'Deal đã hết hạn thanh toán',
      'Backer không hoàn tất chuyển khoản trong 30 phút. Deal "' || _label || '" trở lại listing.',
      jsonb_build_object('deal_id', NEW.id, 'label', _label))
    ON CONFLICT DO NOTHING;
    IF OLD.backer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (OLD.backer_id, 'deal_auto_cancelled',
        'Cam kết đã bị hủy do quá hạn',
        'Bạn không hoàn tất chuyển khoản trong 30 phút cho deal "' || _label || '".',
        jsonb_build_object('deal_id', NEW.id, 'label', _label))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- All super_admins: result entered
  IF NEW.status = 'result_entered' AND OLD.status = 'funded' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT ur.user_id, 'result_entered',
      'Có kết quả mới cần xác nhận',
      'Player đã nhập kết quả cho deal "' || _label || '". Vào Admin → Tab "Kết quả & Giải ngân".',
      jsonb_build_object('deal_id', NEW.id, 'label', _label)
    FROM public.user_roles ur
    WHERE ur.role = 'super_admin'
    ON CONFLICT DO NOTHING;
  END IF;

  -- Player + Backer: result verified
  IF NEW.status = 'result_verified' AND OLD.status = 'result_entered' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.player_id, 'result_verified',
      'Kết quả đã được xác nhận',
      'Deal "' || _label || '" đang chờ Admin giải ngân.',
      jsonb_build_object('deal_id', NEW.id, 'label', _label))
    ON CONFLICT DO NOTHING;
    IF NEW.backer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (NEW.backer_id, 'result_verified',
        'Kết quả đã được xác nhận',
        'Deal "' || _label || '" đang chờ Admin giải ngân.',
        jsonb_build_object('deal_id', NEW.id, 'label', _label))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Player: result disputed
  IF NEW.status = 'result_disputed' AND OLD.status = 'result_entered' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.player_id, 'result_disputed',
      'Kết quả bị tranh chấp',
      'Admin yêu cầu kiểm tra lại kết quả deal "' || _label || '". Vui lòng liên hệ Admin.',
      jsonb_build_object('deal_id', NEW.id, 'label', _label))
    ON CONFLICT DO NOTHING;
  END IF;

  -- Player + Backer: release requested (heads up)
  IF NEW.status = 'release_requested' AND OLD.status = 'result_verified' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.player_id, 'release_requested',
      'Admin đã yêu cầu giải ngân',
      'Deal "' || _label || '" đang chờ Admin thứ 2 ký xác nhận.',
      jsonb_build_object('deal_id', NEW.id, 'label', _label))
    ON CONFLICT DO NOTHING;
    IF NEW.backer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (NEW.backer_id, 'release_requested',
        'Admin đã yêu cầu giải ngân',
        'Deal "' || _label || '" đang chờ Admin thứ 2 ký xác nhận.',
        jsonb_build_object('deal_id', NEW.id, 'label', _label))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Player + Backer: payout executed (completed)
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.player_id, 'payout_executed',
      'Giải ngân hoàn tất',
      'Deal "' || _label || '" đã đóng. Tiền đã được chuyển.',
      jsonb_build_object('deal_id', NEW.id, 'label', _label, 'amount_vnd', NEW.player_payout_vnd))
    ON CONFLICT DO NOTHING;
    IF NEW.backer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (NEW.backer_id, 'payout_executed',
        'Giải ngân hoàn tất',
        'Tiền của bạn từ deal "' || _label || '" đã được chuyển. Vui lòng kiểm tra ngân hàng.',
        jsonb_build_object('deal_id', NEW.id, 'label', _label, 'amount_vnd', NEW.backer_payout_vnd))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_notify ON public.staking_deals;
CREATE TRIGGER trg_deal_notify
  AFTER UPDATE ON public.staking_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_deal_notify();
