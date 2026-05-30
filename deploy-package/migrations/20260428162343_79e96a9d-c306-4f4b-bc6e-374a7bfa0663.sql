-- Enums
CREATE TYPE public.upcoming_event_status AS ENUM ('open', 'closed', 'completed');

-- Table: player_upcoming_events
CREATE TABLE public.player_upcoming_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL,
  tournament_id UUID,
  event_name TEXT NOT NULL,
  venue TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  buy_in BIGINT NOT NULL DEFAULT 0,
  selling_percentage INT NOT NULL DEFAULT 20 CHECK (selling_percentage BETWEEN 1 AND 100),
  markup NUMERIC(3,2) NOT NULL DEFAULT 1.0 CHECK (markup BETWEEN 1.0 AND 5.0),
  notes TEXT,
  cover_url TEXT,
  status public.upcoming_event_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.player_upcoming_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Upcoming events public read" ON public.player_upcoming_events FOR SELECT USING (true);
CREATE POLICY "Player insert own event" ON public.player_upcoming_events FOR INSERT WITH CHECK (auth.uid() = player_id);
CREATE POLICY "Player update own event" ON public.player_upcoming_events FOR UPDATE USING (auth.uid() = player_id OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Player delete own event" ON public.player_upcoming_events FOR DELETE USING (auth.uid() = player_id OR has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_upcoming_player ON public.player_upcoming_events(player_id);
CREATE INDEX idx_upcoming_date ON public.player_upcoming_events(event_date);
CREATE TRIGGER trg_upcoming_updated BEFORE UPDATE ON public.player_upcoming_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: event_proofs
CREATE TABLE public.event_proofs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.player_upcoming_events(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.event_proofs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Proofs public read" ON public.event_proofs FOR SELECT USING (true);
CREATE POLICY "Player insert proof for own event" ON public.event_proofs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.player_upcoming_events e WHERE e.id = event_proofs.event_id AND e.player_id = auth.uid()));
CREATE POLICY "Player delete proof for own event" ON public.event_proofs FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.player_upcoming_events e WHERE e.id = event_proofs.event_id AND e.player_id = auth.uid()) OR has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_event_proofs_event ON public.event_proofs(event_id);

-- Table: player_results
CREATE TABLE public.player_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL,
  tournament_name TEXT NOT NULL,
  venue TEXT,
  event_date DATE NOT NULL,
  buy_in BIGINT NOT NULL DEFAULT 0,
  prize BIGINT NOT NULL DEFAULT 0,
  position INT,
  total_entries INT,
  proof_url TEXT,
  verified_by_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.player_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Results public read" ON public.player_results FOR SELECT USING (true);
CREATE POLICY "Player insert own result" ON public.player_results FOR INSERT WITH CHECK (auth.uid() = player_id);
CREATE POLICY "Player update own result" ON public.player_results FOR UPDATE USING (auth.uid() = player_id OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Player delete own result" ON public.player_results FOR DELETE USING (auth.uid() = player_id OR has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_results_player ON public.player_results(player_id);
CREATE INDEX idx_results_date ON public.player_results(event_date DESC);
CREATE TRIGGER trg_results_updated BEFORE UPDATE ON public.player_results FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function: recompute player stats from results
CREATE OR REPLACE FUNCTION public.recompute_player_stats(_player_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _played INT;
  _cashed INT;
  _total_buyin BIGINT;
  _total_prize BIGINT;
  _profit BIGINT;
  _itm NUMERIC(5,2);
  _roi NUMERIC(6,2);
  _biggest BIGINT;
  _avg_finish NUMERIC(6,2);
  _streak INT;
  _last20 JSONB;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE prize > 0),
    COALESCE(SUM(buy_in), 0),
    COALESCE(SUM(prize), 0),
    COALESCE(MAX(prize), 0),
    COALESCE(AVG(NULLIF(position, 0)), 0)
  INTO _played, _cashed, _total_buyin, _total_prize, _biggest, _avg_finish
  FROM public.player_results
  WHERE player_id = _player_id;

  _profit := _total_prize - _total_buyin;
  _itm := CASE WHEN _played > 0 THEN ROUND((_cashed::NUMERIC / _played) * 100, 2) ELSE 0 END;
  _roi := CASE WHEN _total_buyin > 0 THEN ROUND((_profit::NUMERIC / _total_buyin) * 100, 2) ELSE 0 END;

  -- streak (most recent consecutive cashes)
  WITH ordered AS (
    SELECT prize, ROW_NUMBER() OVER (ORDER BY event_date DESC, created_at DESC) AS rn
    FROM public.player_results WHERE player_id = _player_id
  )
  SELECT COALESCE(COUNT(*), 0) INTO _streak
  FROM ordered
  WHERE rn <= (SELECT COALESCE(MIN(rn), 0) FROM ordered WHERE prize = 0)
    AND prize > 0;
  IF _streak IS NULL THEN
    SELECT COUNT(*) INTO _streak FROM public.player_results WHERE player_id = _player_id AND prize > 0;
  END IF;

  -- last 20 results jsonb
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', event_date,
    'name', tournament_name,
    'position', position,
    'buy_in', buy_in,
    'prize', prize,
    'profit', prize - buy_in
  ) ORDER BY event_date DESC, created_at DESC), '[]'::jsonb)
  INTO _last20
  FROM (
    SELECT * FROM public.player_results
    WHERE player_id = _player_id
    ORDER BY event_date DESC, created_at DESC
    LIMIT 20
  ) sub;

  INSERT INTO public.player_stats (
    player_id, tournaments_played, tournaments_cashed, itm_rate, roi_percentage,
    total_profit_loss, biggest_cash_amount, avg_finish, current_streak, last_20_results
  ) VALUES (
    _player_id, _played, _cashed, _itm, _roi, _profit, _biggest, _avg_finish, _streak, _last20
  )
  ON CONFLICT (player_id) DO UPDATE SET
    tournaments_played = EXCLUDED.tournaments_played,
    tournaments_cashed = EXCLUDED.tournaments_cashed,
    itm_rate = EXCLUDED.itm_rate,
    roi_percentage = EXCLUDED.roi_percentage,
    total_profit_loss = EXCLUDED.total_profit_loss,
    biggest_cash_amount = EXCLUDED.biggest_cash_amount,
    avg_finish = EXCLUDED.avg_finish,
    current_streak = EXCLUDED.current_streak,
    last_20_results = EXCLUDED.last_20_results,
    updated_at = now();
END;
$$;

-- Trigger function on player_results
CREATE OR REPLACE FUNCTION public.trg_results_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM public.recompute_player_stats(OLD.player_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_player_stats(NEW.player_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_results_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.player_results
FOR EACH ROW EXECUTE FUNCTION public.trg_results_recompute();

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('backing-proofs', 'backing-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Backing proofs public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'backing-proofs');
CREATE POLICY "Owner upload backing proof" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'backing-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner delete backing proof" ON storage.objects FOR DELETE
  USING (bucket_id = 'backing-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner update backing proof" ON storage.objects FOR UPDATE
  USING (bucket_id = 'backing-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);