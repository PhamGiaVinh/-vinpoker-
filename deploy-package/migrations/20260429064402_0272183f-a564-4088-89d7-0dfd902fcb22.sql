CREATE INDEX IF NOT EXISTS idx_stack_reg_user_status_active
  ON public.stack_registrations(user_id, status)
  WHERE status IN ('pending','confirmed');

CREATE INDEX IF NOT EXISTS idx_stack_reg_tournament_created
  ON public.stack_registrations(tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_chats_player_active
  ON public.booking_chats(player_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_chats_club_active
  ON public.booking_chats(club_id, updated_at DESC)
  WHERE archived_at IS NULL;