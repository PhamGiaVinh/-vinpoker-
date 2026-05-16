CREATE INDEX IF NOT EXISTS idx_bankroll_entries_user_game_date ON public.bankroll_entries (user_id, game_type, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_intl_events_active_start ON public.international_events (is_active, start_date);
CREATE INDEX IF NOT EXISTS idx_intl_events_display_order_active ON public.international_events (display_order) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_staking_purchases_deal_status ON public.staking_purchases (deal_id, status);
CREATE INDEX IF NOT EXISTS idx_staking_purchases_backer_status ON public.staking_purchases (backer_id, status);

CREATE INDEX IF NOT EXISTS idx_staking_deals_status_deadline ON public.staking_deals (status, registration_deadline);
CREATE INDEX IF NOT EXISTS idx_staking_deals_player_status ON public.staking_deals (player_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tour_regs_tournament_status ON public.tournament_registrations (tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_tour_regs_player_status ON public.tournament_registrations (player_id, status);

CREATE INDEX IF NOT EXISTS idx_tournaments_deleted_start ON public.tournaments (deleted_at, start_time);

CREATE INDEX IF NOT EXISTS idx_player_results_player_date ON public.player_results (player_id, event_date DESC);