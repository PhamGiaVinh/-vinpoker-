\set ON_ERROR_STOP on
-- Runs after disposableDb.serverContract.sql and rosterActionsRepair.disposable.sql.
-- Exact TEST IDs only; the CI PostgreSQL service is discarded after this job.
\ir ../../supabase/migrations/20270115000008_floor_deferred_tracker_move_v1.sql
\ir ../../supabase/migrations/20270115000009_tracker_record_hand_v3_identity.sql
\ir ../../supabase/migrations/20270115000010_tracker_v3_hand_start_context.sql

INSERT INTO public.club_trackers (club_id, user_id) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001');

CREATE OR REPLACE FUNCTION public.deferred_test_fail_after_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_catalog.current_setting('deferred_test.fail_writer', true) = 'on'
     AND NEW.entry_id = '00000000-0000-0000-0000-000000000842'::uuid THEN
    RAISE EXCEPTION 'TEST writer failure after terminal hand update';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_deferred_test_fail_after_terminal
BEFORE UPDATE OF chip_count ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION public.deferred_test_fail_after_terminal();

SELECT public.floor_table_v3_assert(
  has_function_privilege('authenticated', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.floor_pending_tracker_moves', 'INSERT'),
  'deferred move queue is caller-bound and has no direct table write');
SELECT public.floor_table_v3_assert(
  has_function_privilege('authenticated', 'public.get_tracker_hand_input_tables_v3(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_tracker_hand_input_tables_v3(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)', 'EXECUTE'),
  'Tracker V3 read/start RPCs are authenticated-only');

INSERT INTO public.tournaments (id, club_id, status) VALUES
  ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000010', 'active');
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000010', 'TEST Source', 41, 'available'),
  ('00000000-0000-0000-0000-000000000542', '00000000-0000-0000-0000-000000000010', 'TEST Tracker', 42, 'available'),
  ('00000000-0000-0000-0000-000000000543', '00000000-0000-0000-0000-000000000010', 'TEST Legacy', 43, 'available');
INSERT INTO public.tournament_entries
  (id, tournament_id, registration_id, player_id, entry_no, current_stack, status)
VALUES
  ('00000000-0000-0000-0000-000000000841', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000a41', '00000000-0000-0000-0000-000000000941', 1, 30000, 'registered'),
  ('00000000-0000-0000-0000-000000000842', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000a42', '00000000-0000-0000-0000-000000000942', 1, 40000, 'registered'),
  ('00000000-0000-0000-0000-000000000843', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000a43', '00000000-0000-0000-0000-000000000943', 1, 50000, 'registered'),
  ('00000000-0000-0000-0000-000000000844', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000a44', '00000000-0000-0000-0000-000000000944', 1, 20000, 'seated');

DO $$
DECLARE
  v_source jsonb; v_tracker jsonb; v_result jsonb; v_retry jsonb;
  v_source_revision bigint; v_tracker_revision bigint;
  v_hand uuid; v_legacy_tt uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  v_source := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000541',
    'manual', '00000000-0000-0000-0000-000000001141');
  v_tracker := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000542',
    'tracker', '00000000-0000-0000-0000-000000001142');
  PERFORM public.floor_table_v3_assert((v_source->>'ok')::boolean AND (v_tracker->>'ok')::boolean,
    'TEST manual and Tracker tables open');
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000841', (v_source->>'tournament_table_id')::uuid,
    1, 1, '00000000-0000-0000-0000-000000001143');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean, 'source entry seats');
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000842', (v_tracker->>'tournament_table_id')::uuid,
    1, 1, '00000000-0000-0000-0000-000000001144');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean, 'Tracker existing entry seats');
  PERFORM public.floor_table_v3_assert(
    (SELECT table_id IS NULL FROM public.tournament_tables
      WHERE id = (v_tracker->>'tournament_table_id')::uuid)
    AND EXISTS (SELECT 1 FROM public.tournament_seats s
      JOIN public.tournament_entries e ON e.id = s.entry_id
      WHERE s.entry_id = '00000000-0000-0000-0000-000000000842'
        AND s.is_active AND s.table_id IS NULL
        AND s.tournament_table_id = (v_tracker->>'tournament_table_id')::uuid
        AND e.table_id IS NULL),
    'V3 opening and seating keep legacy table IDs empty');

  PERFORM pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000099', true);
  v_result := public.get_tracker_hand_input_tables_v3(
    '00000000-0000-0000-0000-000000000141');
  PERFORM public.floor_table_v3_assert(v_result->>'error' = 'actor_not_allowed',
    'unrelated authenticated actor cannot list Tracker leases');
  v_result := public.start_tracker_hand_v3(
    '00000000-0000-0000-0000-000000000141',
    (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid,
    1, 1, pg_catalog.now(), NULL, 1);
  PERFORM public.floor_table_v3_assert(v_result->>'error' = 'actor_not_allowed',
    'unrelated authenticated actor cannot start a Tracker hand');
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);

  v_result := public.get_tracker_hand_input_tables_v3(
    '00000000-0000-0000-0000-000000000141');
  PERFORM public.floor_table_v3_assert(
    (v_result->>'ok')::boolean
    AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_result->'tables') row_item
      WHERE row_item->>'table_id' = '00000000-0000-0000-0000-000000000542'
        AND row_item->>'tournament_table_id' = v_tracker->>'tournament_table_id'
        AND row_item->>'table_session_id' = v_tracker->>'table_session_id'
        AND (row_item->>'control_epoch')::bigint = 1
        AND (row_item->>'player_count')::integer = 1),
    'Tracker table picker exposes fresh V3 table and seated player');

  v_result := public.start_tracker_hand_v3(
    '00000000-0000-0000-0000-000000000141',
    (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid,
    0, 1, pg_catalog.now(), '00000000-0000-0000-0000-000000000001', 1);
  PERFORM public.floor_table_v3_assert(v_result->>'error' = 'STALE_TRACKER_CONTEXT',
    'stale epoch cannot start a Tracker hand');
  v_result := public.start_tracker_hand_v3(
    '00000000-0000-0000-0000-000000000141',
    (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid,
    1, 1, pg_catalog.now(), '00000000-0000-0000-0000-000000000001', 1);
  PERFORM public.floor_table_v3_assert(v_result->>'status' = 'success',
    'Tracker starts exact V3 hand without legacy table ID: ' || v_result::text);
  v_hand := (v_result->>'hand_id')::uuid;
  PERFORM public.floor_table_v3_assert(
    (SELECT count(*) = 1 FROM public.hand_players WHERE hand_id = v_hand)
    AND (SELECT table_session_id = (v_tracker->>'table_session_id')::uuid
      AND tournament_table_id = (v_tracker->>'tournament_table_id')::uuid
      FROM public.tournament_hands WHERE id = v_hand),
    'V3 hand seeds current roster and stores fenced session identity');
  v_result := public.start_tracker_hand_v3(
    '00000000-0000-0000-0000-000000000141',
    (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid,
    1, 1, pg_catalog.now(), '00000000-0000-0000-0000-000000000001', 1);
  PERFORM public.floor_table_v3_assert(v_result->>'error' = 'table_has_active_hand',
    'double-click cannot create a second live Tracker hand');

  PERFORM public.floor_table_v3_assert(
    (SELECT h.table_session_id = (v_tracker->>'table_session_id')::uuid
     FROM public.tournament_hands h WHERE h.id = v_hand),
    'new Tracker hand gets explicit session before blind snapshot');
  PERFORM public.floor_table_v3_assert(
    floor_private.floor_table_v3_has_active_hand(
      '00000000-0000-0000-0000-000000000141',
      (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid),
    'Floor recognizes the active Tracker hand');

  SELECT revision INTO v_source_revision FROM public.table_sessions
  WHERE id = (v_source->>'table_session_id')::uuid;
  SELECT revision INTO v_tracker_revision FROM public.table_sessions
  WHERE id = (v_tracker->>'table_session_id')::uuid;
  v_result := public.floor_queue_tracker_move_v1(
    '00000000-0000-0000-0000-000000000841', (v_tracker->>'tournament_table_id')::uuid,
    2, v_source_revision, v_tracker_revision, '00000000-0000-0000-0000-000000001145');
  PERFORM public.floor_table_v3_assert((v_result->>'ok')::boolean AND (v_result->>'queued')::boolean,
    'move reserves Tracker seat while hand runs: ' || v_result::text);
  v_retry := public.floor_queue_tracker_move_v1(
    '00000000-0000-0000-0000-000000000841', (v_tracker->>'tournament_table_id')::uuid,
    2, v_source_revision, v_tracker_revision, '00000000-0000-0000-0000-000000001145');
  PERFORM public.floor_table_v3_assert(v_retry = v_result, 'same request and payload is idempotent');
  v_retry := public.floor_queue_tracker_move_v1(
    '00000000-0000-0000-0000-000000000841', (v_tracker->>'tournament_table_id')::uuid,
    3, v_source_revision, v_tracker_revision, '00000000-0000-0000-0000-000000001145');
  PERFORM public.floor_table_v3_assert_json(v_retry, 'IDEMPOTENCY_CONFLICT', 'changed retry is rejected');
  PERFORM public.floor_table_v3_assert(
    EXISTS (SELECT 1 FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000841'
      AND table_session_id = (v_source->>'table_session_id')::uuid AND is_active)
    AND NOT EXISTS (SELECT 1 FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000841'
      AND table_session_id = (v_tracker->>'table_session_id')::uuid AND is_active),
    'queued player remains at source until hand completes');
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, tournament_table_id,
      table_session_id, seat_number, chip_count, entry_id, is_active, status
    ) VALUES (
      '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000943', 1,
      (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid,
      2, 50000, '00000000-0000-0000-0000-000000000843', true, 'active');
    RAISE EXCEPTION 'expected reserved seat to reject competing insert';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  PERFORM pg_catalog.set_config('deferred_test.fail_writer', 'on', true);
  BEGIN
    v_retry := public.record_hand(
      '00000000-0000-0000-0000-000000000141',
      (v_tracker->>'tournament_table_id')::uuid, 1, pg_catalog.now(),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'player_id', '00000000-0000-0000-0000-000000000942',
        'entry_number', 1, 'seat_number', 1, 'starting_stack', 40000,
        'ending_stack', 40000, 'is_eliminated', false)),
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0,
      '00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'expected TEST post-terminal writer failure; result=%', v_retry;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TEST writer failure after terminal hand update' THEN RAISE; END IF;
  END;
  PERFORM public.floor_table_v3_assert(
    (SELECT status = 'in_progress' FROM public.tournament_hands WHERE id = v_hand)
    AND (SELECT status = 'pending' FROM public.floor_pending_tracker_moves
      WHERE id = (v_result->>'pending_move_id')::uuid)
    AND EXISTS (SELECT 1 FROM public.tournament_seats
      WHERE entry_id = '00000000-0000-0000-0000-000000000841'
        AND table_session_id = (v_source->>'table_session_id')::uuid AND is_active),
    'failed record_hand rolls back terminal hand and queued move together');
  PERFORM pg_catalog.set_config('deferred_test.fail_writer', 'off', true);
  v_retry := public.record_hand(
    '00000000-0000-0000-0000-000000000141',
    (v_tracker->>'tournament_table_id')::uuid, 1, pg_catalog.now(),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'player_id', '00000000-0000-0000-0000-000000000942',
      'entry_number', 1, 'seat_number', 1, 'starting_stack', 40000,
      'ending_stack', 40000, 'is_eliminated', false)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0,
    '00000000-0000-0000-0000-000000000001');
  PERFORM public.floor_table_v3_assert((v_retry->>'ok')::boolean,
    'production record_hand completes and applies queued move: ' || v_retry::text);
  PERFORM public.floor_table_v3_assert(
    EXISTS (SELECT 1 FROM public.tournament_seats
      WHERE entry_id = '00000000-0000-0000-0000-000000000841'
        AND table_session_id = (v_tracker->>'table_session_id')::uuid
        AND table_id = (v_tracker->>'tournament_table_id')::uuid
        AND seat_number = 2 AND chip_count = 30000 AND is_active)
    AND NOT EXISTS (SELECT 1 FROM public.tournament_seats
      WHERE entry_id = '00000000-0000-0000-0000-000000000841'
        AND table_session_id = (v_source->>'table_session_id')::uuid AND is_active),
    'hand terminal update applies queued move exactly once');
  PERFORM public.floor_table_v3_assert(
    (SELECT table_id = '00000000-0000-0000-0000-000000000542'::uuid
      AND seat_number = 2 AND current_stack = 30000
     FROM public.tournament_entries WHERE id = '00000000-0000-0000-0000-000000000841')
    AND (SELECT chip_count = 30000 FROM public.tournament_chip_counts
      WHERE tournament_id = '00000000-0000-0000-0000-000000000141'
        AND player_id = '00000000-0000-0000-0000-000000000941' AND entry_number = 1),
    'Tracker legacy projection and chip value match the moved entry');
  PERFORM public.floor_table_v3_assert(
    (SELECT status = 'applied' FROM public.floor_pending_tracker_moves
      WHERE id = (v_result->>'pending_move_id')::uuid),
    'pending request records applied state');
  PERFORM public.floor_table_v3_assert(
    (SELECT revision > v_source_revision FROM public.table_sessions
      WHERE id = (v_source->>'table_session_id')::uuid)
    AND (SELECT revision > v_tracker_revision FROM public.table_sessions
      WHERE id = (v_tracker->>'table_session_id')::uuid),
    'terminal move advances both session revisions');

  v_result := public.get_tracker_hand_input_tables_v3(
    '00000000-0000-0000-0000-000000000141');
  PERFORM public.floor_table_v3_assert(
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_result->'tables') row_item
      WHERE row_item->>'table_session_id' = v_tracker->>'table_session_id'
        AND (row_item->>'player_count')::integer = 2
        AND (row_item->>'has_live_hand')::boolean = false),
    'Tracker picker sees moved entrant after the hand ends');

  v_retry := public.start_tracker_hand_v3(
    '00000000-0000-0000-0000-000000000141',
    (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid,
    1, 2, pg_catalog.now(), '00000000-0000-0000-0000-000000000001', 1);
  PERFORM public.floor_table_v3_assert(
    v_retry->>'status' = 'success',
    'next Tracker hand starts on same lease after queued move: ' || v_retry::text);
  v_hand := (v_retry->>'hand_id')::uuid;
  PERFORM public.floor_table_v3_assert(
    (SELECT count(*) = 2 FROM public.hand_players WHERE hand_id = v_hand)
    AND EXISTS (SELECT 1 FROM public.hand_players
      WHERE hand_id = v_hand AND player_id = '00000000-0000-0000-0000-000000000941'
        AND seat_number = 2 AND starting_stack = 30000),
    'next hand snapshots both original and moved entrants from V3 roster');
  v_retry := public.record_hand(
    '00000000-0000-0000-0000-000000000141',
    '00000000-0000-0000-0000-000000000542', 2, pg_catalog.now(),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'player_id', '00000000-0000-0000-0000-000000000942',
        'entry_number', 1, 'seat_number', 1, 'starting_stack', 40000,
        'ending_stack', 40000, 'is_eliminated', false),
      pg_catalog.jsonb_build_object(
        'player_id', '00000000-0000-0000-0000-000000000941',
        'entry_number', 1, 'seat_number', 2, 'starting_stack', 30000,
        'ending_stack', 30000, 'is_eliminated', false)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0,
    '00000000-0000-0000-0000-000000000001');
  PERFORM public.floor_table_v3_assert((v_retry->>'ok')::boolean,
    'next Tracker hand accepts moved player with physical table identity: ' || v_retry::text);

  -- A historical assignment and seat carry only their legacy table IDs.
  -- The replacement hand writer must preserve that separate old read path.
  INSERT INTO public.tournament_tables (
    tournament_id, table_id, table_number, max_seats, status
  ) VALUES (
    '00000000-0000-0000-0000-000000000141',
    '00000000-0000-0000-0000-000000000543', 43, 9, 'active'
  ) RETURNING id INTO v_legacy_tt;
  INSERT INTO public.tournament_seats (
    tournament_id, player_id, entry_number, table_id, seat_number,
    chip_count, entry_id, is_active, status
  ) VALUES (
    '00000000-0000-0000-0000-000000000141',
    '00000000-0000-0000-0000-000000000944', 1,
    v_legacy_tt, 1, 20000,
    '00000000-0000-0000-0000-000000000844', true, 'active');
  UPDATE public.tournament_entries
  SET table_id = '00000000-0000-0000-0000-000000000543'::uuid,
      seat_number = 1
  WHERE id = '00000000-0000-0000-0000-000000000844';
  INSERT INTO public.tournament_hands (tournament_id, table_id, hand_number, status)
  VALUES ('00000000-0000-0000-0000-000000000141',
    v_legacy_tt, 1, 'in_progress') RETURNING id INTO v_hand;
  INSERT INTO public.hand_players (
    hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack
  ) VALUES (v_hand, '00000000-0000-0000-0000-000000000141',
    '00000000-0000-0000-0000-000000000944', 1, 1, 20000);
  v_retry := public.record_hand(
    '00000000-0000-0000-0000-000000000141',
    v_legacy_tt, 1, pg_catalog.now(),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'player_id', '00000000-0000-0000-0000-000000000944',
      'entry_number', 1, 'seat_number', 1, 'starting_stack', 20000,
      'ending_stack', 20000, 'is_eliminated', false)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0,
    '00000000-0000-0000-0000-000000000001');
  PERFORM public.floor_table_v3_assert((v_retry->>'ok')::boolean,
    'hand writer still accepts historical legacy table and seat: ' || v_retry::text);
END;
$$;

SELECT 'FLOOR_DEFERRED_TRACKER_MOVE_DISPOSABLE_PASS' AS result;
