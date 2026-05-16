-- Track last-read timestamps per chat per participant for unread badges
ALTER TABLE public.booking_chats
  ADD COLUMN IF NOT EXISTS player_last_read_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS club_last_read_at timestamptz NOT NULL DEFAULT now();

-- Allow participants to mark-as-read (already covered by existing UPDATE policy on booking_chats)
-- No new policy needed.