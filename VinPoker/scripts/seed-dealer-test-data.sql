-- ==============================================================
-- SEED SCRIPT: Dealer Swing Manager test data
-- Run this in Supabase Dashboard > SQL Editor
-- ==============================================================

-- Step 1: Grant dealer_control to all current auth users
-- (Replace the subquery with a specific user ID if you prefer)
INSERT INTO public.club_dealer_controls (user_id, club_id)
SELECT au.id, c.id
FROM auth.users au
CROSS JOIN public.clubs c
WHERE NOT EXISTS (
  SELECT 1 FROM public.club_dealer_controls cdc
  WHERE cdc.user_id = au.id AND cdc.club_id = c.id
)
ON CONFLICT DO NOTHING;

-- Verify
SELECT au.email, c.name AS club_name, cdc.*
FROM public.club_dealer_controls cdc
JOIN auth.users au ON au.id = cdc.user_id
JOIN public.clubs c ON c.id = cdc.club_id;

-- Step 2: Create sample dealers for each club
INSERT INTO public.dealers (club_id, full_name, tier, status) VALUES
-- Hanoi Royal Poker (22222222-2222-2222-2222-222222222222)
('22222222-2222-2222-2222-222222222222', 'Nguyen Van An', 'A', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Tran Thi Binh', 'A', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Le Van Cuong', 'B', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Pham Thi Dung', 'B', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Hoang Van Em', 'B', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Ngo Thi Phuong', 'C', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Vu Van Giang', 'C', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Do Thi Hanh', 'C', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Ly Van Hoang', 'A', 'scheduled'),
('22222222-2222-2222-2222-222222222222', 'Mai Thi Huong', 'B', 'scheduled'),
-- Saigon Poker Club (11111111-1111-1111-1111-111111111111)
('11111111-1111-1111-1111-111111111111', 'Duong Van Khoa', 'A', 'scheduled'),
('11111111-1111-1111-1111-111111111111', 'Vo Thi Lan', 'B', 'scheduled'),
('11111111-1111-1111-1111-111111111111', 'Trinh Van Manh', 'C', 'scheduled'),
('11111111-1111-1111-1111-111111111111', 'Bui Thi Ngoc', 'B', 'scheduled'),
('11111111-1111-1111-1111-111111111111', 'Dang Van Phuc', 'A', 'scheduled')
ON CONFLICT DO NOTHING;

-- Step 3: Create sample tours (dealer_shifts) for each club
INSERT INTO public.dealer_shifts (club_id, tour_name, start_time, end_time, tour_tier) VALUES
('22222222-2222-2222-2222-222222222222', 'Tour Sáng', '08:00', '12:00', 'HIGH'),
('22222222-2222-2222-2222-222222222222', 'Tour Chiều', '13:00', '17:00', 'MEDIUM'),
('22222222-2222-2222-2222-222222222222', 'Tour Tối', '18:00', '22:00', 'LOW'),
('11111111-1111-1111-1111-111111111111', 'Tour Sáng', '08:00', '12:00', 'MEDIUM'),
('11111111-1111-1111-1111-111111111111', 'Tour Chiều', '13:00', '17:00', 'LOW')
ON CONFLICT DO NOTHING;

-- Step 4: Create sample game tables for each club
INSERT INTO public.game_tables (club_id, table_name, table_type, status) VALUES
-- Hanoi Royal Poker
('22222222-2222-2222-2222-222222222222', 'T01', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'T02', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'T03', 'tournament', 'active'),
('22222222-2222-2222-2222-222222222222', 'T05', 'vip', 'active'),
('22222222-2222-2222-2222-222222222222', 'T06', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'T08', 'tournament', 'active'),
('22222222-2222-2222-2222-222222222222', 'T10', 'cash', 'active'),
('22222222-2222-2222-2222-222222222222', 'VIP1', 'vip', 'active'),
-- Saigon Poker Club
('11111111-1111-1111-1111-111111111111', 'S01', 'cash', 'active'),
('11111111-1111-1111-1111-111111111111', 'S02', 'cash', 'active'),
('11111111-1111-1111-1111-111111111111', 'S03', 'tournament', 'active')
ON CONFLICT DO NOTHING;

-- Step 5: Ensure swing_config defaults exist
INSERT INTO public.swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes, warn_at_minutes, crit_at_minutes)
SELECT c.id, t.type, 45, 20, 5, 1
FROM public.clubs c
CROSS JOIN (VALUES ('cash'), ('tournament'), ('vip')) AS t(type)
ON CONFLICT (club_id, table_type) DO NOTHING;

-- Step 6: Ensure shift_break_policies defaults exist
INSERT INTO public.shift_break_policies (club_id, shift_type)
SELECT id, 'default' FROM public.clubs
ON CONFLICT (club_id, shift_type) DO NOTHING;

-- Step 7: Generate Telegram Chat ID for clubs
UPDATE public.club_settings SET telegram_chat_id = '-1003620964119'
WHERE telegram_chat_id IS NULL;

-- Step 8: Verify
SELECT 'Dealers:' AS info, COUNT(*)::text FROM public.dealers
UNION ALL
SELECT 'Tables:', COUNT(*)::text FROM public.game_tables
UNION ALL
SELECT 'Tours:', COUNT(*)::text FROM public.dealer_shifts
UNION ALL
SELECT 'Controls:', COUNT(*)::text FROM public.club_dealer_controls
UNION ALL
SELECT 'Configs:', COUNT(*)::text FROM public.swing_config;
