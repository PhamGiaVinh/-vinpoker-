-- ==============================================================
-- Hotfix: Add DEFAULT to game_type + fix initialize_club_tables
-- ==============================================================

-- Add DEFAULT so INSERT without game_type uses 'NLH'
ALTER TABLE public.game_tables ALTER COLUMN game_type SET DEFAULT 'NLH';

-- Fix the trigger function that creates 100 tables for new clubs
CREATE OR REPLACE FUNCTION public.initialize_club_tables()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  FOR i IN 1..100 LOOP
    INSERT INTO public.game_tables (club_id, table_name, table_type, status, game_type)
    VALUES (NEW.id, 'Bàn ' || i, 'tournament', 'inactive', 'NLH')
    ON CONFLICT (club_id, table_name) WHERE shift_id IS NULL DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;
