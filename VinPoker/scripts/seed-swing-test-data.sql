-- Seed script — Dealer Swing Test Data
-- Run: psql "postgresql://..." -f scripts/seed-swing-test-data.sql
-- Or:   supabase db query --linked --file scripts/seed-swing-test-data.sql

BEGIN;

-- Clear existing test data (child tables first for FK safety)
DELETE FROM swing_audit_logs;
DELETE FROM swing_metrics;
DELETE FROM dealer_breaks;
DELETE FROM dealer_assignments;
DELETE FROM swing_config;
DELETE FROM club_settings;
DELETE FROM dealer_attendance;
DELETE FROM game_tables;
DELETE FROM dealers;

INSERT INTO clubs (id, name, region, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Saigon Poker Club', 'HCMC', 'approved'),
  ('22222222-2222-2222-2222-222222222222', 'Hanoi Poker Club', 'Hanoi', 'approved'),
  ('33333333-3333-3333-3333-333333333333', 'Da Nang Poker Club', 'DaNang', 'approved')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dealers (id, club_id, full_name, status, tier, employment_type, skills) VALUES
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Nguyen Van A',  'active', 'A', 'full_time', ARRAY['tournament','cash']),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tran Thi B',   'active', 'A', 'full_time', ARRAY['tournament','cash']),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Le Van C',     'active', 'B', 'full_time', ARRAY['tournament']),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Pham Thi D',   'active', 'B', 'full_time', ARRAY['tournament','cash']),
  ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Hoang Van E',  'active', 'B', 'full_time', ARRAY['tournament']),
  ('a0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Ngo Thi F',    'active', 'C', 'full_time', ARRAY['tournament']),
  ('a0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Dang Van G',   'active', 'C', 'full_time', ARRAY['tournament','cash']),
  ('a0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Bui Thi H',    'active', 'A', 'full_time', ARRAY['tournament','cash']),
  ('a0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Vu Van I',     'active', 'C', 'full_time', ARRAY['tournament']),
  ('a0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Do Thi K',     'active', 'B', 'full_time', ARRAY['tournament','cash']),
  ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ly Van M',     'active', 'B', 'full_time', ARRAY['tournament']),
  ('c0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Trinh Van N',  'active', 'B', 'full_time', ARRAY['tournament']);

INSERT INTO game_tables (id, club_id, table_name, table_type, status, game_type, tour_tier) VALUES
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Table 1', 'tournament', 'active', 'NLH', 'MEDIUM'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Table 2', 'tournament', 'active', 'NLH', 'MEDIUM'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Table 3', 'tournament', 'active', 'NLH', 'MEDIUM'),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Table 4', 'tournament', 'active', 'NLH', 'MEDIUM'),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Table 5', 'tournament', 'active', 'NLH', 'MEDIUM'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'HN Table 1', 'tournament', 'active', 'NLH', 'MEDIUM'),
  ('b3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'DN Table 1', 'tournament', 'active', 'NLH', 'MEDIUM');

INSERT INTO dealer_attendance (id, dealer_id, status, current_state, shift_date, check_in_time, overtime_minutes) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'checked_in', 'available', CURRENT_DATE, now() - interval '4 hours', 0),
  ('c1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'checked_in', 'available', CURRENT_DATE, now() - interval '4 hours', 0),
  ('c1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'checked_in', 'available', CURRENT_DATE, now() - interval '3 hours', 0),
  ('c1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'checked_in', 'available', CURRENT_DATE, now() - interval '3 hours', 0),
  ('c1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'checked_in', 'available', CURRENT_DATE, now() - interval '2 hours', 0),
  ('c1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', 'checked_in', 'available', CURRENT_DATE, now() - interval '2 hours', 0),
  ('c1000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 'checked_in', 'available', CURRENT_DATE, now() - interval '1 hour',  0),
  ('c1000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008', 'checked_in', 'available', CURRENT_DATE, now() - interval '1 hour',  0),
  ('c1000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009', 'checked_in', 'available', CURRENT_DATE, now() - interval '30 min',  0),
  ('c1000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010', 'checked_in', 'available', CURRENT_DATE, now() - interval '30 min',  0),
  ('c2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'checked_in', 'available', CURRENT_DATE, now() - interval '2 hours', 0),
  ('c3000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'checked_in', 'available', CURRENT_DATE, now() - interval '2 hours', 0);

INSERT INTO dealer_assignments (id, attendance_id, table_id, status, swing_due_at, version) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'assigned', now() + interval '2 minutes', 1),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'assigned', now() + interval '2 minutes', 1),
  ('d1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', 'assigned', now() + interval '2 minutes', 1);

INSERT INTO club_settings (club_id, auto_swing_enabled) VALUES
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', true),
  ('33333333-3333-3333-3333-333333333333', true)
ON CONFLICT (club_id) DO UPDATE SET auto_swing_enabled = EXCLUDED.auto_swing_enabled;

INSERT INTO swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes, pre_announce_minutes, warn_at_minutes, crit_at_minutes, auto_adjust_duration, min_duration_minutes, club_zone, base_duration_minutes, target_ratio, max_duration_minutes) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tournament', 45, 15, 6, 5, 2, false, 30, 'SGN', 40, 1.43, 60),
  ('22222222-2222-2222-2222-222222222222', 'tournament', 45, 15, 6, 5, 2, false, 30, 'HAN', 40, 1.43, 60),
  ('33333333-3333-3333-3333-333333333333', 'tournament', 45, 15, 6, 5, 2, false, 30, 'DNG', 40, 1.43, 60);

SELECT 'Seed complete!' AS status,
  (SELECT count(*) FROM dealers) AS dealers,
  (SELECT count(*) FROM game_tables) AS tables,
  (SELECT count(*) FROM dealer_attendance) AS checkins,
  (SELECT count(*) FROM dealer_assignments) AS assignments,
  (SELECT count(*) FROM club_settings) AS club_settings,
  (SELECT count(*) FROM swing_config) AS swing_configs;

COMMIT;
