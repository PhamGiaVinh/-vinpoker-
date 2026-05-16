-- booking_chats
CREATE TABLE public.booking_chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  registration_id UUID REFERENCES public.stack_registrations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  payment_confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tournament_id, player_id)
);

ALTER TABLE public.booking_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat visible to participants" ON public.booking_chats
FOR SELECT USING (
  player_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = booking_chats.club_id AND c.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Players create their chat" ON public.booking_chats
FOR INSERT WITH CHECK (player_id = auth.uid());

CREATE POLICY "Participants update chat" ON public.booking_chats
FOR UPDATE USING (
  player_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = booking_chats.club_id AND c.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE TRIGGER trg_booking_chats_updated
BEFORE UPDATE ON public.booking_chats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- chat_messages
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES public.booking_chats(id) ON DELETE CASCADE,
  sender_id UUID,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Messages visible to chat participants" ON public.chat_messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.booking_chats bc
    LEFT JOIN public.clubs c ON c.id = bc.club_id
    WHERE bc.id = chat_messages.chat_id
      AND (bc.player_id = auth.uid() OR c.owner_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'))
  )
);

CREATE POLICY "Participants send messages" ON public.chat_messages
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.booking_chats bc
    LEFT JOIN public.clubs c ON c.id = bc.club_id
    WHERE bc.id = chat_messages.chat_id
      AND (bc.player_id = auth.uid() OR c.owner_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'))
  )
);

CREATE INDEX idx_chat_messages_chat ON public.chat_messages(chat_id, created_at);

-- leaderboard_entries
CREATE TABLE public.leaderboard_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL,
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE,
  winnings NUMERIC NOT NULL DEFAULT 0,
  cashout NUMERIC NOT NULL DEFAULT 0,
  entry_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leaderboard public read" ON public.leaderboard_entries
FOR SELECT USING (true);

CREATE POLICY "Admin and club owner can insert leaderboard" ON public.leaderboard_entries
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'super_admin')
  OR (club_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = leaderboard_entries.club_id AND c.owner_id = auth.uid()))
);

CREATE POLICY "Admin and club owner can update leaderboard" ON public.leaderboard_entries
FOR UPDATE USING (
  public.has_role(auth.uid(), 'super_admin')
  OR (club_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = leaderboard_entries.club_id AND c.owner_id = auth.uid()))
);

CREATE POLICY "Admin and club owner can delete leaderboard" ON public.leaderboard_entries
FOR DELETE USING (
  public.has_role(auth.uid(), 'super_admin')
  OR (club_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = leaderboard_entries.club_id AND c.owner_id = auth.uid()))
);

CREATE TRIGGER trg_leaderboard_updated
BEFORE UPDATE ON public.leaderboard_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_leaderboard_player ON public.leaderboard_entries(player_id);
CREATE INDEX idx_leaderboard_club ON public.leaderboard_entries(club_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.leaderboard_entries;
ALTER TABLE public.booking_chats REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.leaderboard_entries REPLICA IDENTITY FULL;