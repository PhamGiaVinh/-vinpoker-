\set ON_ERROR_STOP on

-- The exact PR2A migration is applied by the workflow before this file.
-- All fixtures are synthetic and disposable; no Supabase project is used.
CREATE OR REPLACE FUNCTION public.tracker_test_context(
  p_actor UUID,
  p_tournament_id UUID,
  p_table_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::TEXT, false);
  RETURN public.get_tracker_table_context_v2(p_tournament_id, p_table_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tracker_test_start(
  p_actor UUID,
  p_tournament_id UUID,
  p_table_id UUID,
  p_button_seat INTEGER,
  p_context_version TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::TEXT, false);
  RETURN public.start_tracker_hand_v2(
    p_tournament_id,
    p_table_id,
    p_button_seat,
    p_context_version,
    p_idempotency_key
  );
END;
$$;

INSERT INTO auth.users (id)
VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000099');

INSERT INTO public.clubs (id, owner_id)
VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000009'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000099');

INSERT INTO public.club_trackers (club_id, user_id)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.club_floors (club_id, user_id)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003');

INSERT INTO public.profiles (id, user_id, display_name, avatar_url)
SELECT id, id, format('Player %s', right(id::TEXT, 2)), NULL
FROM auth.users;

INSERT INTO public.tournaments (
  id, club_id, name, status, current_level, current_level_id, clock_paused_at
)
VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'PR2A Main', 'active', 1, '00000000-0000-0000-0000-000000000401', NULL),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', 'PR2A Concurrent', 'active', 1, '00000000-0000-0000-0000-000000000402', NULL);

INSERT INTO public.game_tables (id, club_id, table_name)
VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000010', 'Physical 1'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000010', 'Physical 2');

INSERT INTO public.tournament_tables (
  id, tournament_id, table_id, table_number, max_seats, status, table_name,
  floor_control_mode, floor_control_revision
)
VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000201', 1, 9, 'active', 'Table 1', 'tracker', 0),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000202', 2, 9, 'active', 'Table 2', 'tracker', 0);

INSERT INTO public.tournament_levels (
  id, tournament_id, level_number, small_blind, big_blind, ante, is_break
)
VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000100', 1, 100, 200, 200, false),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000102', 1, 100, 200, 200, false);

INSERT INTO public.tournament_entries (
  id, tournament_id, player_id, entry_no, status, current_stack, table_id, seat_number
)
VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000004', 1, 'seated', 1000, '00000000-0000-0000-0000-000000000201', 1),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000005', 1, 'seated', 1000, '00000000-0000-0000-0000-000000000201', 2),
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000006', 1, 'seated', 1000, '00000000-0000-0000-0000-000000000201', 3),
  ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000004', 2, 'seated', 1000, '00000000-0000-0000-0000-000000000202', 1),
  ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000005', 2, 'seated', 1000, '00000000-0000-0000-0000-000000000202', 2),
  ('00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000006', 2, 'seated', 1000, '00000000-0000-0000-0000-000000000202', 3);

INSERT INTO public.tournament_seats (
  id, tournament_id, player_id, entry_number, table_id, seat_number,
  chip_count, is_active, entry_id, status
)
VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000004', 1, '00000000-0000-0000-0000-000000000301', 1, 1000, true, '00000000-0000-0000-0000-000000000501', 'active'),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000005', 1, '00000000-0000-0000-0000-000000000301', 2, 1000, true, '00000000-0000-0000-0000-000000000502', 'active'),
  ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000006', 1, '00000000-0000-0000-0000-000000000301', 3, 1000, true, '00000000-0000-0000-0000-000000000503', 'active'),
  ('00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000004', 2, '00000000-0000-0000-0000-000000000302', 1, 1000, true, '00000000-0000-0000-0000-000000000504', 'active'),
  ('00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000005', 2, '00000000-0000-0000-0000-000000000302', 2, 1000, true, '00000000-0000-0000-0000-000000000505', 'active'),
  ('00000000-0000-0000-0000-000000000606', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000006', 2, '00000000-0000-0000-0000-000000000302', 3, 1000, true, '00000000-0000-0000-0000-000000000506', 'active');

UPDATE public.tournament_entries e
SET seat_id = s.id
FROM public.tournament_seats s
WHERE s.entry_id = e.id;

INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
SELECT tournament_id, player_id, entry_number, 1000
FROM public.tournament_seats;

-- Catalog/security proof for the migration's authoritative surface.
SELECT public.tracker_test_assert(
  (SELECT count(*) = 1
   FROM pg_proc
   WHERE oid = 'public.start_tracker_hand_v2(uuid,uuid,integer,text,text)'::regprocedure),
  'exactly one start RPC signature exists'
);
SELECT public.tracker_test_assert(
  (SELECT prosecdef AND pg_get_userbyid(proowner) = 'postgres'
   FROM pg_proc
   WHERE oid = 'public.start_tracker_hand_v2(uuid,uuid,integer,text,text)'::regprocedure),
  'start RPC is SECURITY DEFINER owned by postgres'
);
SELECT public.tracker_test_assert(
  (SELECT proconfig @> ARRAY['search_path=public']
   FROM pg_proc
   WHERE oid = 'public.start_tracker_hand_v2(uuid,uuid,integer,text,text)'::regprocedure),
  'start RPC pins search_path=public'
);
SELECT public.tracker_test_assert(
  has_function_privilege('authenticated', 'public.start_tracker_hand_v2(uuid,uuid,integer,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.start_tracker_hand_v2(uuid,uuid,integer,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.start_tracker_hand_v2(uuid,uuid,integer,text,text)', 'EXECUTE'),
  'start RPC grants only authenticated execution'
);
SELECT public.tracker_test_assert(
  NOT has_table_privilege('authenticated', 'public.tracker_unified_ops_receipts', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.tracker_unified_ops_receipts', 'SELECT'),
  'receipt table is not client-readable'
);

-- Wrong seat_number is a canonical-entry mismatch and must be fail-closed.
UPDATE public.tournament_entries
SET seat_number = 9
WHERE id = '00000000-0000-0000-0000-000000000501';
SELECT public.tracker_test_assert(
  (public.tracker_test_context(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301'
  )->'readiness'->'blockers') @> '[{"code":"seat_entry_mismatch"}]'::JSONB,
  'wrong seat_number blocks readiness'
);
SELECT public.tracker_test_assert(
  (SELECT count(*) = 0 FROM public.tournament_hands),
  'wrong seat_number performs zero hand writes'
);
UPDATE public.tournament_entries
SET seat_number = 1
WHERE id = '00000000-0000-0000-0000-000000000501';

-- Context hash keeps raw negative, zero and NULL distinctions.
CREATE TEMP TABLE tracker_pr2a_contexts (
  label TEXT PRIMARY KEY,
  context_version TEXT NOT NULL
);
INSERT INTO tracker_pr2a_contexts
SELECT 'baseline', (public.tracker_test_context(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000301'
)->>'context_version');

UPDATE public.tournament_chip_counts
SET chip_count = -1
WHERE player_id = '00000000-0000-0000-0000-000000000004'
  AND tournament_id = '00000000-0000-0000-0000-000000000100';
SELECT public.tracker_test_assert(
  (SELECT context_version FROM tracker_pr2a_contexts WHERE label = 'baseline') <> (public.tracker_test_context(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301'
  )->>'context_version'),
  'negative tracker stack changes context hash'
);
UPDATE public.tournament_chip_counts
SET chip_count = 1000
WHERE player_id = '00000000-0000-0000-0000-000000000004'
  AND tournament_id = '00000000-0000-0000-0000-000000000100';

UPDATE public.tournament_levels SET ante = -1
WHERE id = '00000000-0000-0000-0000-000000000401';
SELECT public.tracker_test_assert(
  (SELECT context_version FROM tracker_pr2a_contexts WHERE label = 'baseline') <> (public.tracker_test_context(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301'
  )->>'context_version'),
  'negative ante changes context hash'
);
UPDATE public.tournament_levels SET ante = 200
WHERE id = '00000000-0000-0000-0000-000000000401';

DELETE FROM public.tournament_chip_counts
WHERE player_id = '00000000-0000-0000-0000-000000000004'
  AND tournament_id = '00000000-0000-0000-0000-000000000100';
SELECT public.tracker_test_assert(
  (SELECT context_version FROM tracker_pr2a_contexts WHERE label = 'baseline') <> (public.tracker_test_context(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-000000000301'
  )->>'context_version'),
  'missing tracker projection changes context hash'
);
INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
VALUES ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000004', 1, 1000);

-- A stale table revision rejects start without a hand write.
UPDATE public.tournament_tables SET floor_control_revision = 1
WHERE id = '00000000-0000-0000-0000-000000000301';
SELECT public.tracker_test_assert(
  (public.tracker_test_start(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    2,
    (SELECT context_version FROM tracker_pr2a_contexts WHERE label = 'baseline'),
    'stale-key-0001'
  )->>'error') = 'stale_table_context',
  'stale context is rejected'
);
SELECT public.tracker_test_assert(
  (SELECT count(*) = 0 FROM public.tournament_hands),
  'stale context performs zero hand writes'
);
UPDATE public.tournament_tables SET floor_control_revision = 0
WHERE id = '00000000-0000-0000-0000-000000000301';

CREATE TEMP TABLE tracker_pr2a_start_results (response JSONB);
INSERT INTO tracker_pr2a_start_results
SELECT public.tracker_test_start(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000301',
  2,
  (public.tracker_test_context(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301'
  )->>'context_version'),
  'start-key-0001'
);
SELECT public.tracker_test_assert(
  (SELECT (response->>'ok')::BOOLEAN FROM tracker_pr2a_start_results),
  'authoritative start succeeds'
);
SELECT public.tracker_test_assert(
  (SELECT table_id = '00000000-0000-0000-0000-000000000301'
          AND hand_number = 1
          AND status = 'in_progress'
   FROM public.tournament_hands
   WHERE id = ((SELECT response FROM tracker_pr2a_start_results)->>'hand_id')::UUID),
  'new hand uses canonical tournament table identity and server hand number'
);
SELECT public.tracker_test_assert(
  (SELECT count(*) = 3 AND bool_and(ending_stack IS NULL) AND bool_and(starting_stack = 1000)
   FROM public.hand_players
   WHERE hand_id = ((SELECT response FROM tracker_pr2a_start_results)->>'hand_id')::UUID),
  'hand players are seeded from server stack projections with no client ending stack'
);

SELECT public.tracker_test_assert(
  (public.tracker_test_start(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    2,
    (public.tracker_test_context(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000100',
      '00000000-0000-0000-0000-000000000301'
    )->>'context_version'),
    'start-key-0001'
  )->>'replayed')::BOOLEAN,
  'same idempotency request returns replayed receipt'
);
SELECT public.tracker_test_assert(
  (public.tracker_test_start(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    3,
    (SELECT context_version FROM tracker_pr2a_contexts WHERE label = 'baseline'),
    'start-key-0001'
  )->>'error') = 'idempotency_mismatch',
  'same idempotency key with changed intent is rejected'
);

-- A matching receipt replays even after the tournament becomes terminal; a new
-- request is validated normally and is rejected as not open.
UPDATE public.tournaments
SET status = 'completed'
WHERE id = '00000000-0000-0000-0000-000000000100';
SELECT public.tracker_test_assert(
  (public.tracker_test_start(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    2,
    (SELECT context_version FROM tracker_pr2a_contexts WHERE label = 'baseline'),
    'start-key-0001'
  )->>'replayed')::BOOLEAN,
  'terminal tournament does not block an exact receipt replay'
);
SELECT public.tracker_test_assert(
  (public.tracker_test_start(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000301',
    2,
    (SELECT context_version FROM tracker_pr2a_contexts WHERE label = 'baseline'),
    'start-key-0002'
  )->>'error') = 'tournament_not_open',
  'new idempotency key is rejected for terminal tournament'
);

-- Auth matrix: privilege catalog checks prove anon/service_role cannot
-- execute; Floor-only and an unrelated-club actor can execute the RPC but are
-- denied by the server authorization body.
SELECT public.tracker_test_assert(
  (public.tracker_test_start(
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000302',
    2,
    (public.tracker_test_context(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000302'
    )->>'context_version'),
    'floor-key-0001'
  )->>'error') = 'actor_not_allowed',
  'Floor-only actor cannot start a hand'
);
SELECT public.tracker_test_assert(
  (public.tracker_test_start(
    '00000000-0000-0000-0000-000000000099',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000302',
    2,
    (public.tracker_test_context(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000302'
    )->>'context_version'),
    'cross-club-key-0001'
  )->>'error') = 'actor_not_allowed',
  'unrelated-club actor cannot start a hand'
);

-- Real concurrent calls use two PostgreSQL sessions and the same tournament
-- advisory lock. Exactly one different-key request can create the hand.
SELECT dblink_connect('pr2a_a', 'dbname=' || current_database());
SELECT dblink_connect('pr2a_b', 'dbname=' || current_database());
SELECT dblink_send_query(
  'pr2a_a',
  $$SELECT public.tracker_test_start(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000302',
    2,
    (public.tracker_test_context(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000302'
    )->>'context_version'),
    'concurrent-key-0001'
  )$$
);
SELECT dblink_send_query(
  'pr2a_b',
  $$SELECT public.tracker_test_start(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000302',
    2,
    (public.tracker_test_context(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000302'
    )->>'context_version'),
    'concurrent-key-0002'
  )$$
);
CREATE TEMP TABLE tracker_pr2a_concurrency_results (response JSONB);
INSERT INTO tracker_pr2a_concurrency_results
SELECT response FROM dblink_get_result('pr2a_a') AS result(response JSONB);
INSERT INTO tracker_pr2a_concurrency_results
SELECT response FROM dblink_get_result('pr2a_b') AS result(response JSONB);
SELECT public.tracker_test_assert(
  (SELECT count(*) FROM tracker_pr2a_concurrency_results WHERE (response->>'ok')::BOOLEAN) = 1
  AND (SELECT count(*) FROM tracker_pr2a_concurrency_results WHERE response->>'error' = 'active_hand_exists') = 1
  AND (SELECT count(*) FROM public.tournament_hands WHERE tournament_id = '00000000-0000-0000-0000-000000000102') = 1,
  'concurrent different-key starts serialize without duplicate hands'
);
SELECT dblink_disconnect('pr2a_a');
SELECT dblink_disconnect('pr2a_b');

SELECT public.tracker_test_assert(
  (SELECT count(*) = 0
   FROM public.tournament_hands
   WHERE tournament_id = '00000000-0000-0000-0000-000000000100'
     AND status = 'voided'),
  'no stale-lock auto-void or destructive cleanup occurred'
);

SELECT 'PR2A_DISPOSABLE_DB_PASS' AS result;
