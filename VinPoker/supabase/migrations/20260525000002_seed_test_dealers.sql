-- Seed test data for Dealer Swing Manager
-- Grant dealer_control to all auth users for all clubs
INSERT INTO public.club_dealer_controls (user_id, club_id)
SELECT au.id, c.id
FROM auth.users au
CROSS JOIN public.clubs c
WHERE NOT EXISTS (
  SELECT 1 FROM public.club_dealer_controls cdc
  WHERE cdc.user_id = au.id AND cdc.club_id = c.id
)
ON CONFLICT DO NOTHING;

-- Sample dealers
INSERT INTO public.dealers (club_id, full_name, tier, status) VALUES
('22222222-2222-2222-2222-222222222222', 'Nguyen Van An', 'A', 'active'),
('22222222-2222-2222-2222-222222222222', 'Tran Thi Binh', 'A', 'active'),
('22222222-2222-2222-2222-222222222222', 'Le Van Cuong', 'B', 'active'),
('22222222-2222-2222-2222-222222222222', 'Pham Thi Dung', 'B', 'active'),
('22222222-2222-2222-2222-222222222222', 'Hoang Van Em', 'B', 'active'),
('22222222-2222-2222-2222-222222222222', 'Ngo Thi Phuong', 'C', 'active'),
('22222222-2222-2222-2222-222222222222', 'Vu Van Giang', 'C', 'active'),
('22222222-2222-2222-2222-222222222222', 'Do Thi Hanh', 'C', 'active'),
('22222222-2222-2222-2222-222222222222', 'Ly Van Hoang', 'A', 'active'),
('22222222-2222-2222-2222-222222222222', 'Mai Thi Huong', 'B', 'active'),
('11111111-1111-1111-1111-111111111111', 'Duong Van Khoa', 'A', 'active'),
('11111111-1111-1111-1111-111111111111', 'Vo Thi Lan', 'B', 'active'),
('11111111-1111-1111-1111-111111111111', 'Trinh Van Manh', 'C', 'active'),
('11111111-1111-1111-1111-111111111111', 'Bui Thi Ngoc', 'B', 'active'),
('11111111-1111-1111-1111-111111111111', 'Dang Van Phuc', 'A', 'active')
ON CONFLICT DO NOTHING;

-- Sample tours
INSERT INTO public.dealer_shifts (club_id, tour_name, start_time, end_time, tour_tier) VALUES
('22222222-2222-2222-2222-222222222222', 'Tour Sang', '08:00', '12:00', 'HIGH'),
('22222222-2222-2222-2222-222222222222', 'Tour Chieu', '13:00', '17:00', 'MEDIUM'),
('22222222-2222-2222-2222-222222222222', 'Tour Toi', '18:00', '22:00', 'LOW'),
('11111111-1111-1111-1111-111111111111', 'Tour Sang', '08:00', '12:00', 'MEDIUM'),
('11111111-1111-1111-1111-111111111111', 'Tour Chieu', '13:00', '17:00', 'LOW')
ON CONFLICT DO NOTHING;

-- Sample game tables
INSERT INTO public.game_tables (club_id, table_name, table_type, status) VALUES
('22222222-2222-2222-2222-222222222222', 'T01', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'T02', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'T03', 'tournament', 'active'),
('22222222-2222-2222-2222-222222222222', 'T05', 'vip', 'active'),
('22222222-2222-2222-2222-222222222222', 'T06', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'T08', 'tournament', 'active'),
('22222222-2222-2222-2222-222222222222', 'T10', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'VIP1', 'vip', 'active'),
('11111111-1111-1111-1111-111111111111', 'S01', 'cash', 'active'),
('11111111-1111-1111-1111-111111111111', 'S02', 'cash', 'active'),
('11111111-1111-1111-1111-111111111111', 'S03', 'tournament', 'active')
ON CONFLICT DO NOTHING;

-- Ensure swing_config defaults
INSERT INTO public.swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes, warn_at_minutes, crit_at_minutes)
SELECT c.id, t.type, 45, 20, 5, 1
FROM public.clubs c
CROSS JOIN (VALUES ('cash'), ('tournament'), ('vip')) AS t(type)
ON CONFLICT (club_id, table_type) DO NOTHING;

-- Ensure shift_break_policies defaults
INSERT INTO public.shift_break_policies (club_id, shift_type)
SELECT id, 'default' FROM public.clubs
ON CONFLICT (club_id, shift_type) DO NOTHING;

-- Set Telegram chat ID for clubs
UPDATE public.club_settings SET telegram_chat_id = '-1003620964119'
WHERE telegram_chat_id IS NULL;
