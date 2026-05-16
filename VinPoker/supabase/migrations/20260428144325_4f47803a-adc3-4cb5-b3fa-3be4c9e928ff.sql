ALTER TABLE public.booking_chats
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_booking_chats_archived_at
  ON public.booking_chats (archived_at);

CREATE INDEX IF NOT EXISTS idx_booking_chats_tournament_id
  ON public.booking_chats (tournament_id);