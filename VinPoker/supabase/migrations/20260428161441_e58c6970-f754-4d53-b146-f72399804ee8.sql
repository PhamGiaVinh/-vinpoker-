-- Enum for backing interest status
CREATE TYPE public.backing_interest_status AS ENUM ('pending', 'contacted', 'declined');

-- Table: player_stats
CREATE TABLE public.player_stats (
  player_id UUID NOT NULL PRIMARY KEY,
  tournaments_played INT NOT NULL DEFAULT 0,
  tournaments_cashed INT NOT NULL DEFAULT 0,
  itm_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  roi_percentage NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_profit_loss BIGINT NOT NULL DEFAULT 0,
  biggest_cash_amount BIGINT NOT NULL DEFAULT 0,
  biggest_cash_tournament_id UUID,
  current_streak INT NOT NULL DEFAULT 0,
  avg_finish NUMERIC(6,2) NOT NULL DEFAULT 0,
  looking_for_backing BOOLEAN NOT NULL DEFAULT false,
  backing_description TEXT,
  backing_percentage_available INT,
  verified BOOLEAN NOT NULL DEFAULT false,
  last_20_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Player stats public read" ON public.player_stats FOR SELECT USING (true);
CREATE POLICY "Player can upsert own stats" ON public.player_stats FOR INSERT WITH CHECK (auth.uid() = player_id OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Player can update own stats" ON public.player_stats FOR UPDATE USING (auth.uid() = player_id OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Super admin delete stats" ON public.player_stats FOR DELETE USING (has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_player_stats_updated BEFORE UPDATE ON public.player_stats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: backing_interests
CREATE TABLE public.backing_interests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL,
  interested_user_id UUID NOT NULL,
  percentage_interested INT NOT NULL CHECK (percentage_interested BETWEEN 1 AND 100),
  message TEXT,
  status public.backing_interest_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.backing_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Interest visible to participants" ON public.backing_interests FOR SELECT
  USING (auth.uid() = player_id OR auth.uid() = interested_user_id OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "User creates own interest" ON public.backing_interests FOR INSERT
  WITH CHECK (auth.uid() = interested_user_id);
CREATE POLICY "Player updates interest status" ON public.backing_interests FOR UPDATE
  USING (auth.uid() = player_id OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Sender or admin delete interest" ON public.backing_interests FOR DELETE
  USING (auth.uid() = interested_user_id OR has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_backing_interests_player ON public.backing_interests(player_id);
CREATE INDEX idx_backing_interests_user ON public.backing_interests(interested_user_id);
CREATE TRIGGER trg_backing_interests_updated BEFORE UPDATE ON public.backing_interests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: backer_reviews
CREATE TABLE public.backer_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL,
  backer_id UUID NOT NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  deal_amount BIGINT,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.backer_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews public read" ON public.backer_reviews FOR SELECT USING (true);
CREATE POLICY "Backer creates own review" ON public.backer_reviews FOR INSERT WITH CHECK (auth.uid() = backer_id);
CREATE POLICY "Backer updates own review" ON public.backer_reviews FOR UPDATE USING (auth.uid() = backer_id OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Backer or admin delete review" ON public.backer_reviews FOR DELETE USING (auth.uid() = backer_id OR has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_backer_reviews_player ON public.backer_reviews(player_id);
CREATE TRIGGER trg_backer_reviews_updated BEFORE UPDATE ON public.backer_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();