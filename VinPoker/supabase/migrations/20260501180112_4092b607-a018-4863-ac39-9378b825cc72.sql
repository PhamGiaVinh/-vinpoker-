-- 1) Display name unique (case-insensitive, trimmed)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name_lower text
    GENERATED ALWAYS AS (lower(btrim(display_name))) STORED;

-- Backfill conflict marker for any existing duplicates by appending short id
-- (we don't auto-rewrite; uniqueness is enforced going forward via trigger + index)

-- Partial unique index ignoring nulls/empties
CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_lower_unique
  ON public.profiles (display_name_lower)
  WHERE display_name_lower IS NOT NULL AND display_name_lower <> '';

-- Trigger to validate before insert/update
CREATE OR REPLACE FUNCTION public.validate_unique_display_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lower text := lower(btrim(COALESCE(NEW.display_name, '')));
BEGIN
  IF v_lower = '' THEN
    RAISE EXCEPTION 'Tên hiển thị không được trống';
  END IF;
  IF length(v_lower) < 2 THEN
    RAISE EXCEPTION 'Tên hiển thị phải có ít nhất 2 ký tự';
  END IF;
  IF length(v_lower) > 50 THEN
    RAISE EXCEPTION 'Tên hiển thị tối đa 50 ký tự';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE display_name_lower = v_lower
      AND user_id <> NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Tên hiển thị "%" đã được người khác sử dụng', NEW.display_name USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_unique_name ON public.profiles;
CREATE TRIGGER trg_profiles_unique_name
BEFORE INSERT OR UPDATE OF display_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_unique_display_name();

-- 2) Direct messages tables
CREATE TABLE IF NOT EXISTS public.direct_chats (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a uuid NOT NULL,
  user_b uuid NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  user_a_last_read_at timestamptz NOT NULL DEFAULT now(),
  user_b_last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_distinct CHECK (user_a <> user_b),
  CONSTRAINT chk_ordered CHECK (user_a < user_b)
);
CREATE UNIQUE INDEX IF NOT EXISTS direct_chats_pair_unique ON public.direct_chats(user_a, user_b);
CREATE INDEX IF NOT EXISTS direct_chats_user_a_idx ON public.direct_chats(user_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS direct_chats_user_b_idx ON public.direct_chats(user_b, last_message_at DESC);

ALTER TABLE public.direct_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "DM chat visible to participants"
ON public.direct_chats FOR SELECT
USING (auth.uid() = user_a OR auth.uid() = user_b OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "DM chat created by participant"
ON public.direct_chats FOR INSERT
WITH CHECK (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "DM chat updated by participant"
ON public.direct_chats FOR UPDATE
USING (auth.uid() = user_a OR auth.uid() = user_b OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES public.direct_chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS direct_messages_chat_idx ON public.direct_messages(chat_id, created_at DESC);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "DM messages visible to participants"
ON public.direct_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.direct_chats c
    WHERE c.id = direct_messages.chat_id
      AND (auth.uid() = c.user_a OR auth.uid() = c.user_b OR has_role(auth.uid(), 'super_admin'::app_role))
  )
);

CREATE POLICY "DM messages sent by participant"
ON public.direct_messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.direct_chats c
    WHERE c.id = direct_messages.chat_id
      AND (auth.uid() = c.user_a OR auth.uid() = c.user_b)
  )
);

-- Bump last_message_at on insert
CREATE OR REPLACE FUNCTION public.trg_dm_bump_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.direct_chats SET last_message_at = NEW.created_at WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dm_bump ON public.direct_messages;
CREATE TRIGGER trg_dm_bump
AFTER INSERT ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.trg_dm_bump_chat();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;