-- Live state columns for tournaments
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS current_players integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_level integer,
  ADD COLUMN IF NOT EXISTS current_blinds text,
  ADD COLUMN IF NOT EXISTS live_status text NOT NULL DEFAULT 'registering';

-- Validate live_status via trigger (avoid CHECK rigidity)
CREATE OR REPLACE FUNCTION public.validate_tournament_live_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.live_status NOT IN ('registering','playing','finished') THEN
    RAISE EXCEPTION 'Invalid live_status: %', NEW.live_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tournament_live_status ON public.tournaments;
CREATE TRIGGER trg_validate_tournament_live_status
BEFORE INSERT OR UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.validate_tournament_live_status();

-- Realtime
ALTER TABLE public.tournaments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments;

-- Restrict club creation: only super_admin
DROP POLICY IF EXISTS "Authenticated users can create clubs" ON public.clubs;
CREATE POLICY "Only super admins can create clubs"
ON public.clubs FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));