-- 1. Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_deals INTEGER NOT NULL DEFAULT 0;

-- 2. deal_ratings
CREATE TABLE IF NOT EXISTS public.deal_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  rater_id UUID NOT NULL,
  ratee_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player','backer')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(deal_id, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_ratings_ratee ON public.deal_ratings(ratee_id);
CREATE INDEX IF NOT EXISTS idx_deal_ratings_deal ON public.deal_ratings(deal_id);

ALTER TABLE public.deal_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ratings public read"
  ON public.deal_ratings FOR SELECT
  USING (true);

-- Insert via edge function (validations enforced server-side); also allow direct insert by rater for safety
CREATE POLICY "Rater inserts own rating"
  ON public.deal_ratings FOR INSERT
  WITH CHECK (rater_id = auth.uid());

-- No updates/deletes from client (no policies = denied)

-- 3. Recompute trigger: update profile aggregates on insert
CREATE OR REPLACE FUNCTION public.recompute_profile_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg NUMERIC(3,2);
  v_count INTEGER;
BEGIN
  SELECT ROUND(AVG(rating)::numeric, 2), COUNT(*)
  INTO v_avg, v_count
  FROM public.deal_ratings
  WHERE ratee_id = NEW.ratee_id;

  UPDATE public.profiles
  SET rating_avg = COALESCE(v_avg, 0),
      total_deals = v_count,
      updated_at = now()
  WHERE user_id = NEW.ratee_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_ratings_recompute ON public.deal_ratings;
CREATE TRIGGER trg_deal_ratings_recompute
AFTER INSERT ON public.deal_ratings
FOR EACH ROW EXECUTE FUNCTION public.recompute_profile_rating();