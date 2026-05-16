CREATE OR REPLACE FUNCTION public.trg_tour_reg_player_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
      UPDATE public.tournaments
        SET current_players = COALESCE(current_players, 0) + 1,
            updated_at = now()
        WHERE id = NEW.tournament_id;
    ELSIF OLD.status = 'confirmed' AND NEW.status IS DISTINCT FROM 'confirmed' THEN
      UPDATE public.tournaments
        SET current_players = GREATEST(0, COALESCE(current_players, 0) - 1),
            updated_at = now()
        WHERE id = NEW.tournament_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tour_reg_player_count ON public.tournament_registrations;
CREATE TRIGGER tour_reg_player_count
AFTER UPDATE ON public.tournament_registrations
FOR EACH ROW EXECUTE FUNCTION public.trg_tour_reg_player_count();