
-- 1. tournament_streams
CREATE TABLE public.tournament_streams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube','facebook')),
  stream_url TEXT NOT NULL,
  embed_id TEXT,
  title TEXT,
  is_live BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tournament_streams_tournament ON public.tournament_streams(tournament_id);
CREATE INDEX idx_tournament_streams_live ON public.tournament_streams(is_live) WHERE is_live = true;

ALTER TABLE public.tournament_streams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Streams public read"
  ON public.tournament_streams FOR SELECT USING (true);

CREATE POLICY "Admin or club owner manage streams"
  ON public.tournament_streams FOR ALL
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
      JOIN public.clubs c ON c.id = t.club_id
      WHERE t.id = tournament_streams.tournament_id AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
      JOIN public.clubs c ON c.id = t.club_id
      WHERE t.id = tournament_streams.tournament_id AND c.owner_id = auth.uid()
    )
  );

CREATE TRIGGER trg_tournament_streams_updated_at
  BEFORE UPDATE ON public.tournament_streams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. stream_comments
CREATE TABLE public.stream_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stream_comments_tournament ON public.stream_comments(tournament_id, created_at DESC);

ALTER TABLE public.stream_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comments public read"
  ON public.stream_comments FOR SELECT USING (true);

CREATE POLICY "Authenticated users post own comments"
  ON public.stream_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner or admin delete comments"
  ON public.stream_comments FOR DELETE
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'super_admin'::app_role));

-- 3. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.stream_comments;
ALTER TABLE public.stream_comments REPLICA IDENTITY FULL;
