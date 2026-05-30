
-- Tin tức
CREATE TABLE public.news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  summary text,
  body text,
  cover_url text,
  status text NOT NULL DEFAULT 'draft', -- draft | published
  is_featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  author_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_news_posts_published ON public.news_posts(status, published_at DESC);

ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "News published readable by all"
ON public.news_posts FOR SELECT USING (
  status = 'published' OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);
CREATE POLICY "Super admin manage news"
ON public.news_posts FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE TRIGGER trg_news_posts_updated_at
BEFORE UPDATE ON public.news_posts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Giải quốc tế
CREATE TABLE public.international_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  series text, -- WSOP, WPT, Triton, EPT...
  country text,
  country_code text, -- ISO-2 cho cờ
  city text,
  venue text,
  start_date date,
  end_date date,
  buy_in_usd bigint,
  guarantee_usd bigint,
  poster_url text,
  website_url text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_intl_events_active ON public.international_events(is_active, start_date);

ALTER TABLE public.international_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "International events public read"
ON public.international_events FOR SELECT USING (
  is_active = true OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);
CREATE POLICY "Super admin manage international events"
ON public.international_events FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE TRIGGER trg_intl_events_updated_at
BEFORE UPDATE ON public.international_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
