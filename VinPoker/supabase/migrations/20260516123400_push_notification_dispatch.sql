-- ============ 1. Add new notification enum values ============
DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'schedule_updated';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'registration_confirmed';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'chat_message';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============ 2. Allow schedule upload tracking on tournaments ============
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS schedule_upload_id uuid;

-- ============ 3. Push dispatch trigger ============
CREATE OR REPLACE FUNCTION public.fn_dispatch_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _url text;
BEGIN
  _url := CASE NEW.type
    WHEN 'schedule_updated' THEN '/tournaments'
    WHEN 'registration_confirmed' THEN '/tournaments'
    WHEN 'chat_message' THEN '/chat/groups/' || COALESCE(NEW.data->>'group_id', '')
    ELSE COALESCE(NEW.data->>'url', '/')
  END;

  PERFORM net.http_post(
    url:='https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/send-push-notification',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A"}'::jsonb,
    body:=jsonb_build_object(
      'user_id', NEW.user_id::text,
      'heading', NEW.title,
      'message', NEW.body,
      'url', _url
    )::jsonb
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_push ON public.notifications;
CREATE TRIGGER trg_dispatch_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_dispatch_push();

-- ============ 4. Chat message notification trigger ============
CREATE OR REPLACE FUNCTION public.fn_chat_message_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sender_name text;
BEGIN
  SELECT display_name INTO _sender_name
  FROM public.profiles
  WHERE user_id = NEW.sender_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    cgm.user_id,
    'chat_message'::public.notification_type,
    COALESCE(NULLIF(_sender_name, ''), 'Thành viên'),
    LEFT(NEW.content, 120),
    jsonb_build_object('group_id', NEW.group_id, 'sender_id', NEW.sender_id)
  FROM public.chat_group_members cgm
  WHERE cgm.group_id = NEW.group_id
    AND cgm.user_id <> NEW.sender_id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_message_notify ON public.chat_group_messages;
CREATE TRIGGER trg_chat_message_notify
  AFTER INSERT ON public.chat_group_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_chat_message_notify();

-- ============ 5. Schedule upload notification trigger ============
CREATE OR REPLACE FUNCTION public.fn_schedule_updated_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_name text;
BEGIN
  IF NEW.schedule_upload_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE data->>'schedule_upload_id' = NEW.schedule_upload_id::text
    LIMIT 1
  ) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _club_name FROM public.clubs WHERE id = NEW.club_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    cm.player_user_id,
    'schedule_updated'::public.notification_type,
    'Lịch thi đấu mới',
    'CLB "' || COALESCE(_club_name, 'không xác định') || '" đã cập nhật lịch thi đấu mới.',
    jsonb_build_object('club_id', NEW.club_id, 'schedule_upload_id', NEW.schedule_upload_id)
  FROM public.club_members cm
  WHERE cm.club_id = NEW.club_id
    AND cm.player_user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_updated_notify ON public.tournaments;
CREATE TRIGGER trg_schedule_updated_notify
  AFTER INSERT ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_schedule_updated_notify();
