\set ON_ERROR_STOP on

-- Local-only dependencies for the exact current-main mode writer. This file
-- does not replace the writer body or represent a production migration.
CREATE TABLE IF NOT EXISTS public.club_cashiers (
  club_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID,
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The exact current-main writers require authenticated club-scoped actors.
-- Keep the identities local to this disposable fixture; production auth data
-- is never read by this harness.
INSERT INTO auth.users (id)
VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.clubs (id, owner_id)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_trackers (club_id, user_id)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (club_id, user_id) DO NOTHING;

INSERT INTO public.club_floors (club_id, user_id)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000003'
)
ON CONFLICT (club_id, user_id) DO NOTHING;

INSERT INTO public.tournaments (
  id, club_id, name, status, current_level, current_level_id, clock_paused_at
)
VALUES (
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000010',
  'PR2A Legacy Mode Race',
  'active',
  1,
  '00000000-0000-0000-0000-000000000403',
  NULL
);

INSERT INTO public.game_tables (id, club_id, table_name)
VALUES (
  '00000000-0000-0000-0000-000000000203',
  '00000000-0000-0000-0000-000000000010',
  'Legacy Mode Physical'
);

INSERT INTO public.tournament_tables (
  id, tournament_id, table_id, table_number, max_seats, status, table_name,
  floor_control_mode, floor_control_revision
)
VALUES (
  '00000000-0000-0000-0000-000000000303',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000203',
  3,
  9,
  'active',
  'Legacy Mode Table',
  'tracker',
  0
);

INSERT INTO public.tournament_levels (
  id, tournament_id, level_number, small_blind, big_blind, ante, is_break
)
VALUES (
  '00000000-0000-0000-0000-000000000403',
  '00000000-0000-0000-0000-000000000103',
  1,
  100,
  200,
  200,
  false
);

INSERT INTO public.tournament_entries (
  id, tournament_id, player_id, entry_no, status, current_stack, table_id, seat_number
)
VALUES
  ('00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000004', 3, 'seated', 1000, '00000000-0000-0000-0000-000000000203', 1),
  ('00000000-0000-0000-0000-000000000508', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000005', 3, 'seated', 1000, '00000000-0000-0000-0000-000000000203', 2),
  ('00000000-0000-0000-0000-000000000509', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000006', 3, 'seated', 1000, '00000000-0000-0000-0000-000000000203', 3);

INSERT INTO public.tournament_seats (
  id, tournament_id, player_id, entry_number, table_id, seat_number,
  chip_count, is_active, entry_id, status
)
VALUES
  ('00000000-0000-0000-0000-000000000607', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000004', 3, '00000000-0000-0000-0000-000000000303', 1, 1000, true, '00000000-0000-0000-0000-000000000507', 'active'),
  ('00000000-0000-0000-0000-000000000608', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000005', 3, '00000000-0000-0000-0000-000000000303', 2, 1000, true, '00000000-0000-0000-0000-000000000508', 'active'),
  ('00000000-0000-0000-0000-000000000609', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000006', 3, '00000000-0000-0000-0000-000000000303', 3, 1000, true, '00000000-0000-0000-0000-000000000509', 'active');

UPDATE public.tournament_entries e
SET seat_id = s.id
FROM public.tournament_seats s
WHERE s.entry_id = e.id;

INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
SELECT tournament_id, player_id, entry_number, 1000
FROM public.tournament_seats
WHERE tournament_id = '00000000-0000-0000-0000-000000000103';

CREATE OR REPLACE FUNCTION public.tracker_test_start_attempt(
  p_actor UUID,
  p_tournament_id UUID,
  p_table_id UUID,
  p_context_version TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::TEXT, false);
  RETURN public.start_tracker_hand_v2(
    p_tournament_id, p_table_id, 2, p_context_version, p_idempotency_key
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_mode_attempt(
  p_actor UUID,
  p_tournament_id UUID,
  p_table_id UUID,
  p_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_revision BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::TEXT, false);
  SELECT floor_control_revision INTO v_revision
  FROM public.tournament_tables
  WHERE id = p_table_id;
  RETURN public.floor_set_table_control_mode(
    p_tournament_id, p_table_id, p_mode, v_revision
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM);
END;
$$;
