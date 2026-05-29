-- Pool 100 bàn inactive cho mỗi club (mặc định tournament)
-- Tạo 100 bàn cho club đã tồn tại
INSERT INTO public.game_tables (club_id, table_name, table_type, status)
SELECT c.id, 'Bàn ' || n::text, 'tournament', 'inactive'
FROM public.clubs c
CROSS JOIN generate_series(1, 100) n
ON CONFLICT (club_id, table_name) WHERE shift_id IS NULL DO NOTHING;

-- Trigger: tự động tạo 100 bàn khi club mới được tạo
CREATE OR REPLACE FUNCTION public.initialize_club_tables()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.game_tables (club_id, table_name, table_type, status)
  SELECT NEW.id, 'Bàn ' || n::text, 'tournament', 'inactive'
  FROM generate_series(1, 100) n;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_initialize_club_tables ON public.clubs;
CREATE TRIGGER trg_initialize_club_tables
  AFTER INSERT ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.initialize_club_tables();
