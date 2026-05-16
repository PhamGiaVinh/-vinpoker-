CREATE TABLE public.gto_ranges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  hands TEXT[] NOT NULL DEFAULT '{}',
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gto_ranges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gto ranges" ON public.gto_ranges
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own gto ranges" ON public.gto_ranges
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own gto ranges" ON public.gto_ranges
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own gto ranges" ON public.gto_ranges
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_gto_ranges_user ON public.gto_ranges(user_id, created_at DESC);

CREATE TRIGGER update_gto_ranges_updated_at
  BEFORE UPDATE ON public.gto_ranges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();