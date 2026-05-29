-- =============================================
-- Cleanup: remove swing_config cash & vip rows
-- (only tournament remains)
-- =============================================
DELETE FROM public.swing_config WHERE table_type IN ('cash', 'vip');

-- =============================================
-- Cleanup: remove duplicate game_tables rows
-- where a row with shift_id IS NULL exists
-- alongside another row with same (club_id, table_name)
-- and shift_id IS NOT NULL (pre-constraint duplicates)
-- =============================================
DELETE FROM public.game_tables a
WHERE a.shift_id IS NULL
  AND a.status = 'inactive'
  AND EXISTS (
    SELECT 1 FROM public.game_tables b
    WHERE b.club_id = a.club_id
      AND b.table_name = a.table_name
      AND b.shift_id IS NOT NULL
      AND b.id != a.id
  );

-- =============================================
-- Fix: add ON CONFLICT to initialize_club_tables trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.initialize_club_tables()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.game_tables (club_id, table_name, table_type, status)
  SELECT NEW.id, 'Bàn ' || n::text, 'tournament', 'inactive'
  FROM generate_series(1, 100) n
  ON CONFLICT (club_id, table_name) WHERE shift_id IS NULL DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
