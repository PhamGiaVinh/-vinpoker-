-- Remove cash/vip table types, keep only tournament
UPDATE public.game_tables SET table_type = 'tournament' WHERE table_type IN ('cash', 'vip');
