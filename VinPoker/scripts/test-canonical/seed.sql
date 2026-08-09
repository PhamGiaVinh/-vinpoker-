-- VINPOKER_TEST deterministic synthetic seed. No real identities or contacts.
BEGIN;

INSERT INTO auth.users (id, raw_user_meta_data)
VALUES
  ('00000000-0000-4000-8000-000000000001', '{"display_name":"TEST OWNER A"}'::jsonb),
  ('00000000-0000-4000-8000-000000000002', '{"display_name":"TEST OWNER B"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, user_id, display_name)
VALUES
  ('01000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'TEST OWNER A'),
  ('01000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'TEST OWNER B')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.clubs (id, owner_id, name, region, status, description)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'TEST_CLUB_A', 'VINPOKER_TEST', 'approved', 'Synthetic canonical fixture A'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'TEST_CLUB_B', 'VINPOKER_TEST', 'approved', 'Synthetic canonical fixture B')
ON CONFLICT (id) DO UPDATE
SET owner_id = EXCLUDED.owner_id, name = EXCLUDED.name, region = EXCLUDED.region,
    status = EXCLUDED.status, description = EXCLUDED.description;

INSERT INTO public.club_members (id, club_id, member_card_id, full_name, player_user_id, source)
VALUES
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'TEST-A-OWNER', 'TEST OWNER A', '00000000-0000-4000-8000-000000000001', 'manual'),
  ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'TEST-B-OWNER', 'TEST OWNER B', '00000000-0000-4000-8000-000000000002', 'manual')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tournaments (
  id, club_id, name, start_time, buy_in, rake_amount, starting_stack,
  status, live_status, game_type, minutes_per_level, late_reg_close_level,
  prize_pool
)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'TEST A MAIN', '2026-08-08T11:00:00Z', 500000, 100000, 30000, 'completed', 'finished', 'nlh', 20, 6, 5000000),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'TEST B MAIN', '2026-08-08T12:00:00Z', 300000, 50000, 20000, 'completed', 'finished', 'nlh', 15, 5, 1500000)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, status = EXCLUDED.status, live_status = EXCLUDED.live_status,
    prize_pool = EXCLUDED.prize_pool, rake_amount = EXCLUDED.rake_amount;

INSERT INTO public.tournament_registrations (
  id, tournament_id, player_id, club_id, buy_in, total_pay,
  reference_code, status, confirmed_at, committed_at
)
SELECT
  ('30000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  ('31000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  500000, 600000, 'TEST-A-' || lpad(g::text, 3, '0'), 'confirmed',
  '2026-08-08T11:30:00Z'::timestamptz, '2026-08-08T11:00:00Z'::timestamptz
FROM generate_series(1, 12) AS g
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tournament_registrations (
  id, tournament_id, player_id, club_id, buy_in, total_pay,
  reference_code, status, confirmed_at, committed_at
)
SELECT
  ('30000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000002'::uuid,
  ('31000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid,
  300000, 350000, 'TEST-B-' || lpad(g::text, 3, '0'), 'confirmed',
  '2026-08-08T12:30:00Z'::timestamptz, '2026-08-08T12:00:00Z'::timestamptz
FROM generate_series(1, 5) AS g
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fnb_orders (
  id, club_id, status, source, table_label, subtotal_vnd, cogs_vnd,
  client_request_id, payment_method, paid_at, created_at
)
VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'paid', 'counter', 'TEST-A', 300000, 120000, 'TEST-A-FNB-1', 'cash', '2026-08-08T13:00:00Z', '2026-08-08T12:45:00Z'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'paid', 'counter', 'TEST-B', 125000, 50000, 'TEST-B-FNB-1', 'cash', '2026-08-08T13:00:00Z', '2026-08-08T12:45:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dealers (id, club_id, full_name, employment_type, hourly_rate_vnd)
VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'TEST DEALER A1', 'part_time', 100000),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'TEST DEALER A2', 'part_time', 100000),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'TEST DEALER B1', 'part_time', 100000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payroll_periods (
  id, club_id, period_year, period_month, period_start, period_end, status
)
VALUES
  ('51000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 2026, 8, '2026-08-01', '2026-08-31', 'draft'),
  ('51000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 2026, 8, '2026-08-01', '2026-08-31', 'draft')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

INSERT INTO public.dealer_payroll (
  id, period_id, dealer_id, club_id, employment_type, gross_pay_vnd,
  net_pay_vnd, net_pay_after_tax_vnd, status
)
VALUES
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'part_time', 900000, 900000, 900000, 'pending'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'part_time', 600000, 600000, 600000, 'pending'),
  ('52000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'part_time', 700000, 700000, 700000, 'pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tournament_close_report (
  id, tournament_id, club_id, closed_at, entry_count, buy_in_total,
  cash_in_total, club_revenue, prize_total, cashier_balance, reconcile_delta
)
VALUES
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-08-08T18:00:00Z', 12, 6000000, 7200000, 1200000, 5000000, 2200000, 1000000),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '2026-08-08T18:00:00Z', 5, 1500000, 1750000, 250000, 1500000, 250000, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tournament_prize_payments (
  id, tournament_id, club_id, finished_place, prize_amount, recipient_name,
  status, paid_at, method
)
VALUES
  ('61000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 2000000, 'TEST PLAYER A', 'paid', '2026-08-08T18:30:00Z', 'other'),
  ('61000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1, 1000000, 'TEST PLAYER B', 'paid', '2026-08-08T18:30:00Z', 'other')
ON CONFLICT (id) DO NOTHING;

COMMIT;
