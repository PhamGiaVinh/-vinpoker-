
-- Tournament Series (e.g. WSOP, APT, WPT)
CREATE TABLE public.tournament_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  cover_url TEXT,
  club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tournament_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Series public read"
  ON public.tournament_series FOR SELECT
  USING (true);

CREATE POLICY "Super admin manage series"
  ON public.tournament_series FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER trg_series_updated
BEFORE UPDATE ON public.tournament_series
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Posts/articles inside a series (event details, news)
CREATE TABLE public.series_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES public.tournament_series(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.series_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Series posts public read"
  ON public.series_posts FOR SELECT
  USING (true);

CREATE POLICY "Super admin manage series posts"
  ON public.series_posts FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER trg_series_posts_updated
BEFORE UPDATE ON public.series_posts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_series_posts_series ON public.series_posts(series_id, position);
