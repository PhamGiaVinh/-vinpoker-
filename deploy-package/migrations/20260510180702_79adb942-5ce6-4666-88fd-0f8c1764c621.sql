
-- bankroll_entries
CREATE TABLE public.bankroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  game_type text NOT NULL CHECK (game_type IN ('tournament','cash')),
  buyin numeric(14,2),
  rake numeric(14,2),
  prize_won numeric(14,2),
  entries integer,
  stakes text,
  hours numeric(6,2),
  profit_loss numeric(14,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bankroll_entries_user_date ON public.bankroll_entries(user_id, entry_date DESC);

ALTER TABLE public.bankroll_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own bankroll entries"
ON public.bankroll_entries FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own bankroll entries"
ON public.bankroll_entries FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own bankroll entries"
ON public.bankroll_entries FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users delete own bankroll entries"
ON public.bankroll_entries FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER trg_bankroll_entries_updated_at
BEFORE UPDATE ON public.bankroll_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- bankroll_settings
CREATE TABLE public.bankroll_settings (
  user_id uuid PRIMARY KEY,
  starting_bankroll numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  ror_threshold numeric(5,2) NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bankroll_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own bankroll settings"
ON public.bankroll_settings FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own bankroll settings"
ON public.bankroll_settings FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own bankroll settings"
ON public.bankroll_settings FOR UPDATE
USING (auth.uid() = user_id);

CREATE TRIGGER trg_bankroll_settings_updated_at
BEFORE UPDATE ON public.bankroll_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
