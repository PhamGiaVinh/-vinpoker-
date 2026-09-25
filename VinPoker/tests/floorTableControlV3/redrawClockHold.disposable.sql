\set ON_ERROR_STOP on

-- Executable contract on the workflow's disposable PostgreSQL 17 database.
-- Positive redraw transitions use the authenticated plan/apply/continue RPCs;
-- only initial tournament/table/entry state is seeded by the fixture owner.
BEGIN;

UPDATE public.centerpoint_tournament_ops_release
SET enabled = true,
    allowed_club_ids = ARRAY['00000000-0000-0000-0000-000000000010'::uuid],
    updated_at = now()
WHERE id;

INSERT INTO public.tournaments (
  id, club_id, name, status, live_status, clock_started_at,
  clock_paused_at, pause_accumulated
) VALUES
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000010', 'Redraw Continue running', 'live', 'playing', now() - interval '1 hour', NULL, 0),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000010', 'Redraw Continue pre-paused', 'live', 'playing', now() - interval '1 hour', now() - interval '10 minutes', 0),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000010', 'Redraw Continue later-pause', 'live', 'playing', now() - interval '1 hour', NULL, 0),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000010', 'Redraw start-hand race', 'live', 'playing', now() - interval '1 hour', NULL, 0);

INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000530', '00000000-0000-0000-0000-000000000010', 'Redraw test 30', 30, 'available'),
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000010', 'Redraw test 31', 31, 'available'),
  ('00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-000000000010', 'Redraw test 32', 32, 'available'),
  ('00000000-0000-0000-0000-000000000533', '00000000-0000-0000-0000-000000000010', 'Redraw test 33', 33, 'available');

INSERT INTO public.table_sessions (
  id, club_id, game_table_id, session_type, tournament_id,
  control_mode, control_epoch, revision
) VALUES
  ('00000000-0000-0000-0000-000000000630', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000530', 'tournament', '00000000-0000-0000-0000-000000000109', 'manual', 1, 1),
  ('00000000-0000-0000-0000-000000000631', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000531', 'tournament', '00000000-0000-0000-0000-000000000110', 'manual', 1, 1),
  ('00000000-0000-0000-0000-000000000632', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000532', 'tournament', '00000000-0000-0000-0000-000000000111', 'manual', 1, 1),
  ('00000000-0000-0000-0000-000000000633', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000533', 'tournament', '00000000-0000-0000-0000-000000000112', 'tracker', 1, 1);

INSERT INTO public.tournament_tables (
  id, tournament_id, game_table_id, table_session_id, table_number,
  max_seats, status, floor_control_mode
) VALUES
  ('00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000530', '00000000-0000-0000-0000-000000000630', 30, 9, 'active', 'manual'),
  ('00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000631', 31, 9, 'active', 'manual'),
  ('00000000-0000-0000-0000-000000000742', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-000000000632', 32, 9, 'active', 'manual'),
  ('00000000-0000-0000-0000-000000000743', '00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000533', '00000000-0000-0000-0000-000000000633', 33, 9, 'active', 'tracker');

INSERT INTO public.profiles (user_id, display_name) VALUES
  ('00000000-0000-0000-0000-000000000919', 'Redraw running'),
  ('00000000-0000-0000-0000-000000000920', 'Redraw pre-paused'),
  ('00000000-0000-0000-0000-000000000921', 'Redraw later-pause'),
  ('00000000-0000-0000-0000-000000000922', 'Redraw start-hand');

INSERT INTO public.tournament_entries (
  id, tournament_id, registration_id, player_id, entry_no, current_stack, status
) VALUES
  ('00000000-0000-0000-0000-000000000819', '00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000b19', '00000000-0000-0000-0000-000000000919', 19, 30000, 'seated'),
  ('00000000-0000-0000-0000-000000000820', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000b20', '00000000-0000-0000-0000-000000000920', 20, 30000, 'seated'),
  ('00000000-0000-0000-0000-000000000821', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000b21', '00000000-0000-0000-0000-000000000921', 21, 30000, 'seated'),
  ('00000000-0000-0000-0000-000000000822', '00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000b22', '00000000-0000-0000-0000-000000000922', 22, 30000, 'seated');

INSERT INTO public.tournament_seats (
  tournament_id, player_id, entry_number, table_id, tournament_table_id,
  table_session_id, seat_number, chip_count, entry_id, is_active, status
) VALUES
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000919', 19, '00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000630', 1, 30000, '00000000-0000-0000-0000-000000000819', true, 'active'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000920', 20, '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000631', 1, 30000, '00000000-0000-0000-0000-000000000820', true, 'active'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000921', 21, '00000000-0000-0000-0000-000000000742', '00000000-0000-0000-0000-000000000742', '00000000-0000-0000-0000-000000000632', 1, 30000, '00000000-0000-0000-0000-000000000821', true, 'active'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000922', 22, '00000000-0000-0000-0000-000000000743', '00000000-0000-0000-0000-000000000743', '00000000-0000-0000-0000-000000000633', 1, 30000, '00000000-0000-0000-0000-000000000822', true, 'active');

INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
VALUES ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000922', 22, 30000);

-- Match the narrow table capabilities the real SECURITY INVOKER start_hand RPC
-- needs in Supabase; these grants exist only in the disposable contract DB.
GRANT SELECT ON public.clubs, public.club_trackers, public.tournaments,
  public.tournament_tables, public.tournament_seats,
  public.tournament_chip_counts, public.tournament_hands TO authenticated;
GRANT SELECT, INSERT ON public.tournament_hands, public.hand_players TO authenticated;

CREATE TEMP TABLE redraw_clock_test_cases (
  scenario text PRIMARY KEY,
  batch_id uuid NOT NULL,
  request_id uuid NOT NULL,
  first_result jsonb
);
GRANT ALL ON redraw_clock_test_cases TO authenticated;

-- Use the same club Floor actor as the other authenticated contract suite.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  v_plan jsonb;
  v_apply jsonb;
  v_stale jsonb;
  v_tv_first jsonb;
  v_tv_second jsonb;
  v_tv_third jsonb;
  v_batch uuid;
  v_request uuid := '00000000-0000-0000-0000-000000003109';
  v_apply_definition text;
BEGIN
  v_apply_definition := pg_catalog.pg_get_functiondef(
    'public.floor_apply_tournament_redraw_v1(uuid,uuid)'::regprocedure
  );
  IF v_apply_definition !~ $pattern$'manual_move'[[:space:]]*,[[:space:]]*'floor_redraw_v1'$pattern$ THEN
    RAISE EXCEPTION 'loaded floor_apply_tournament_redraw_v1 definition is not the pending forward-corrected RPC';
  END IF;

  v_plan := public.floor_plan_tournament_redraw_v1(
    '00000000-0000-0000-0000-000000000109', 9,
    ARRAY['00000000-0000-0000-0000-000000000530'::uuid],
    '00000000-0000-0000-0000-000000003009'
  );
  IF v_plan->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'redraw plan failed: %', v_plan; END IF;
  v_batch := (v_plan->>'batch_id')::uuid;
  v_apply := public.floor_apply_tournament_redraw_v1(v_batch, '00000000-0000-0000-0000-000000003109');
  IF v_apply->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'redraw apply failed: %', v_apply; END IF;
  IF (SELECT count(*) FROM public.seat_assignment_history
      WHERE metadata->>'redraw_batch_id' = v_batch::text) <> 1
     OR EXISTS (
       SELECT 1 FROM public.seat_assignment_history
       WHERE metadata->>'redraw_batch_id' = v_batch::text
         AND (draw_type IS DISTINCT FROM 'manual_move'
           OR reason IS DISTINCT FROM 'floor_redraw_v1')
     ) THEN
    RAISE EXCEPTION 'redraw audit row must use the live draw_type contract and keep the implementation marker in reason';
  END IF;
  INSERT INTO pg_temp.redraw_clock_test_cases(scenario, batch_id, request_id)
  VALUES ('running', v_batch, v_request);

  v_stale := public.floor_continue_tournament_redraw_v1(v_batch, 0, '00000000-0000-0000-0000-000000003110');
  IF v_stale->>'error' IS DISTINCT FROM 'STALE_REDRAW_REVISION' THEN
    RAISE EXCEPTION 'stale redraw revision was not rejected: %', v_stale;
  END IF;
  v_tv_first := public.get_public_tournament_redraw_v1('00000000-0000-0000-0000-000000000109');
  v_tv_second := public.get_public_tournament_redraw_v1('00000000-0000-0000-0000-000000000109');
  v_tv_third := public.get_public_tournament_redraw_v1('00000000-0000-0000-0000-000000000109');
  IF v_tv_first IS DISTINCT FROM v_tv_second OR v_tv_second IS DISTINCT FROM v_tv_third
     OR jsonb_array_length(v_tv_third->'moves') <> 1 THEN
    RAISE EXCEPTION 'authenticated TV reads changed or omitted snapshot: %, %, %', v_tv_first, v_tv_second, v_tv_third;
  END IF;
END;
$$;

-- Record the applied-but-held state, then exercise three actual anonymous TV
-- calls (three page reloads/displays) and compare all mutation-bearing state.
RESET ROLE;
CREATE TEMP TABLE redraw_clock_read_baseline AS
SELECT t.id AS tournament_id, t.clock_paused_at, t.clock_control_revision,
       s.redraw_hold_batch_id, s.revision AS session_revision,
       b.redraw_revision, b.hold_completed_at,
       (SELECT count(*) FROM public.tournament_seats seat_row
        WHERE seat_row.tournament_id = t.id AND seat_row.is_active) AS active_seats
FROM public.tournaments t
JOIN public.table_sessions s ON s.tournament_id = t.id AND s.id = '00000000-0000-0000-0000-000000000630'
JOIN pg_temp.redraw_clock_test_cases test_case ON test_case.scenario = 'running'
JOIN public.tournament_redraw_batches b ON b.id = test_case.batch_id
WHERE t.id = '00000000-0000-0000-0000-000000000109';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM redraw_clock_read_baseline
    WHERE clock_paused_at IS NOT NULL
      AND redraw_hold_batch_id IS NOT NULL
      AND redraw_hold_batch_id = (SELECT batch_id FROM pg_temp.redraw_clock_test_cases WHERE scenario = 'running')
      AND redraw_revision = 1
  ) THEN RAISE EXCEPTION 'apply did not atomically establish clock pause and redraw hold'; END IF;
END;
$$;
SET LOCAL ROLE anon;
DO $$
DECLARE a jsonb; b jsonb; c jsonb;
BEGIN
  a := public.get_public_tournament_redraw_v1('00000000-0000-0000-0000-000000000109');
  b := public.get_public_tournament_redraw_v1('00000000-0000-0000-0000-000000000109');
  c := public.get_public_tournament_redraw_v1('00000000-0000-0000-0000-000000000109');
  IF a IS DISTINCT FROM b OR b IS DISTINCT FROM c OR jsonb_array_length(c->'moves') <> 1 THEN
    RAISE EXCEPTION 'TV reload snapshots changed or were incomplete: %, %, %', a, b, c;
  END IF;
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM redraw_clock_read_baseline baseline
    JOIN public.tournaments t ON t.id = baseline.tournament_id
    JOIN public.table_sessions s ON s.id = '00000000-0000-0000-0000-000000000630'
    LEFT JOIN public.tournament_redraw_batches b ON b.id = baseline.redraw_hold_batch_id
    WHERE t.clock_paused_at IS DISTINCT FROM baseline.clock_paused_at
       OR t.clock_control_revision IS DISTINCT FROM baseline.clock_control_revision
       OR s.redraw_hold_batch_id IS DISTINCT FROM baseline.redraw_hold_batch_id
       OR s.revision IS DISTINCT FROM baseline.session_revision
       OR b.redraw_revision IS DISTINCT FROM baseline.redraw_revision
       OR b.hold_completed_at IS DISTINCT FROM baseline.hold_completed_at
       OR (SELECT count(*) FROM public.tournament_seats seat_row
           WHERE seat_row.tournament_id = t.id AND seat_row.is_active) <> baseline.active_seats
  ) THEN RAISE EXCEPTION 'TV reads mutated redraw, clock, or seat state'; END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE v_case record; v_continue jsonb;
BEGIN
  SELECT * INTO v_case FROM pg_temp.redraw_clock_test_cases WHERE scenario = 'running';
  v_continue := public.floor_continue_tournament_redraw_v1(v_case.batch_id, 1, v_case.request_id);
  IF v_continue->>'ok' IS DISTINCT FROM 'true' OR v_continue->>'clock_resumed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'apply->Continue did not release hold and resume eligible clock: %', v_continue;
  END IF;
  UPDATE pg_temp.redraw_clock_test_cases SET first_result = v_continue WHERE scenario = 'running';
END;
$$;
RESET ROLE;

-- Commit the first Continue before the simulated lost-response retry.
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE v_case record; v_retry jsonb; v_conflict jsonb;
BEGIN
  SELECT * INTO v_case FROM pg_temp.redraw_clock_test_cases WHERE scenario = 'running';
  v_retry := public.floor_continue_tournament_redraw_v1(v_case.batch_id, 1, v_case.request_id);
  IF v_retry IS DISTINCT FROM v_case.first_result THEN
    RAISE EXCEPTION 'post-commit same-request retry did not return original receipt: % <> %', v_retry, v_case.first_result;
  END IF;
  v_conflict := public.floor_continue_tournament_redraw_v1(v_case.batch_id, 2, v_case.request_id);
  IF v_conflict->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'changed payload with same request id did not conflict: %', v_conflict;
  END IF;
  v_conflict := public.floor_continue_tournament_redraw_v1(
    v_case.batch_id, 1, '00000000-0000-0000-0000-000000003111'
  );
  IF v_conflict->>'error' IS DISTINCT FROM 'STALE_REDRAW_REVISION' THEN
    RAISE EXCEPTION 'new request after completion was not rejected as stale: %', v_conflict;
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tournaments
    WHERE id = '00000000-0000-0000-0000-000000000109' AND clock_paused_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'post-commit retry re-paused or failed to keep the clock running'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_sessions
    WHERE id = '00000000-0000-0000-0000-000000000630' AND redraw_hold_batch_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'post-commit retry recreated the redraw hold'; END IF;
  IF (SELECT redraw_revision FROM public.tournament_redraw_batches
      WHERE id = (SELECT batch_id FROM pg_temp.redraw_clock_test_cases WHERE scenario = 'running')) <> 2 THEN
    RAISE EXCEPTION 'post-commit retry advanced redraw revision more than once';
  END IF;
  IF (SELECT clock_control_revision FROM public.tournaments
      WHERE id = '00000000-0000-0000-0000-000000000109') <> 2 THEN
    RAISE EXCEPTION 'post-commit retry performed a second clock resume';
  END IF;
END;
$$;

-- Pre-existing pause must remain paused after a redraw that did not own it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE p jsonb; a jsonb; c jsonb; batch uuid;
BEGIN
  p := public.floor_plan_tournament_redraw_v1(
    '00000000-0000-0000-0000-000000000110', 9,
    ARRAY['00000000-0000-0000-0000-000000000531'::uuid], '00000000-0000-0000-0000-000000003010'
  );
  IF p->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pre-paused plan failed: %', p; END IF;
  batch := (p->>'batch_id')::uuid;
  a := public.floor_apply_tournament_redraw_v1(batch, '00000000-0000-0000-0000-000000003112');
  IF a->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pre-paused apply failed: %', a; END IF;
  c := public.floor_continue_tournament_redraw_v1(batch, 1, '00000000-0000-0000-0000-000000003113');
  IF c->>'ok' IS DISTINCT FROM 'true' OR c->>'clock_resumed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'pre-existing pause was not preserved: %', c;
  END IF;
  INSERT INTO pg_temp.redraw_clock_test_cases(scenario, batch_id, request_id, first_result)
  VALUES ('pre_paused', batch, '00000000-0000-0000-0000-000000003113', c);
END;
$$;
RESET ROLE;

-- Simulate an independent TD pause intent after Apply. There is no standalone
-- pause RPC in this schema contract; the clock revision trigger observes the
-- authoritative clock update and Continue must not undo it.
UPDATE public.tournaments
SET clock_paused_at = clock_paused_at,
    updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000111';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE p jsonb; a jsonb; c jsonb; batch uuid;
BEGIN
  p := public.floor_plan_tournament_redraw_v1(
    '00000000-0000-0000-0000-000000000111', 9,
    ARRAY['00000000-0000-0000-0000-000000000532'::uuid], '00000000-0000-0000-0000-000000003014'
  );
  IF p->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'later-pause plan failed: %', p; END IF;
  batch := (p->>'batch_id')::uuid;
  a := public.floor_apply_tournament_redraw_v1(batch, '00000000-0000-0000-0000-000000003115');
  IF a->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'later-pause apply failed: %', a; END IF;
  INSERT INTO pg_temp.redraw_clock_test_cases(scenario, batch_id, request_id)
  VALUES ('later_pause', batch, '00000000-0000-0000-0000-000000003116');
END;
$$;
RESET ROLE;
-- A later pause intent is a no-op on paused_at but still advances the actual
-- clock revision trigger, preventing redraw Continue from owning that resume.
UPDATE public.tournaments SET clock_paused_at = clock_paused_at, updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000111';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE v_case record; c jsonb;
BEGIN
  SELECT * INTO v_case FROM pg_temp.redraw_clock_test_cases WHERE scenario = 'later_pause';
  c := public.floor_continue_tournament_redraw_v1(v_case.batch_id, 1, v_case.request_id);
  IF c->>'ok' IS DISTINCT FROM 'true' OR c->>'clock_resumed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'later independent pause/revision was not preserved: %', c;
  END IF;
END;
$$;
RESET ROLE;

-- Leave tournament 112 applied and held for the concurrent real start_hand race.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE p jsonb; a jsonb; batch uuid;
BEGIN
  p := public.floor_plan_tournament_redraw_v1(
    '00000000-0000-0000-0000-000000000112', 9,
    ARRAY['00000000-0000-0000-0000-000000000533'::uuid], '00000000-0000-0000-0000-000000003017'
  );
  IF p->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'race plan failed: %', p; END IF;
  batch := (p->>'batch_id')::uuid;
  a := public.floor_apply_tournament_redraw_v1(batch, '00000000-0000-0000-0000-000000003118');
  IF a->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'race apply failed: %', a; END IF;
  INSERT INTO pg_temp.redraw_clock_test_cases(scenario, batch_id, request_id)
  VALUES ('start_hand_race', batch, '00000000-0000-0000-0000-000000003119');
END;
$$;
RESET ROLE;

COMMIT;
SELECT 'REDRAW_CLOCK_HOLD_PG17_CONTRACT_PASS' AS result;
