\set ON_ERROR_STOP on
-- Runs after disposableDb.serverContract.sql and rosterActionsRepair.disposable.sql.
-- Exact TEST IDs only; the CI PostgreSQL service is discarded after this job.
\ir ../../supabase/migrations/20270115000007_floor_deferred_tracker_move_v1.sql

SELECT public.floor_table_v3_assert(
  has_function_privilege('authenticated', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.floor_pending_tracker_moves', 'INSERT'),
  'deferred move queue is caller-bound and has no direct table write');

INSERT INTO public.tournaments (id, club_id, status) VALUES
  ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000010', 'active');
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000010', 'TEST Source', 41, 'available'),
  ('00000000-0000-0000-0000-000000000542', '00000000-0000-0000-0000-000000000010', 'TEST Tracker', 42, 'available');
INSERT INTO public.tournament_entries
  (id, tournament_id, registration_id, player_id, entry_no, current_stack, status)
VALUES
  ('00000000-0000-0000-0000-000000000841', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000a41', '00000000-0000-0000-0000-000000000941', 1, 30000, 'registered'),
  ('00000000-0000-0000-0000-000000000842', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000a42', '00000000-0000-0000-0000-000000000942', 1, 40000, 'registered'),
  ('00000000-0000-0000-0000-000000000843', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000a43', '00000000-0000-0000-0000-000000000943', 1, 50000, 'registered');

DO $$
DECLARE
  v_source jsonb; v_tracker jsonb; v_result jsonb; v_retry jsonb;
  v_source_revision bigint; v_tracker_revision bigint;
  v_hand uuid;
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

  INSERT INTO public.tournament_hands (tournament_id, table_id, status)
  VALUES ('00000000-0000-0000-0000-000000000141',
    (v_tracker->>'tournament_table_id')::uuid, 'in_progress') RETURNING id INTO v_hand;
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

  UPDATE public.tournament_hands SET status = 'completed' WHERE id = v_hand;
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

  INSERT INTO public.tournament_hands (tournament_id, table_id, status)
  VALUES ('00000000-0000-0000-0000-000000000141',
    '00000000-0000-0000-0000-000000000542', 'in_progress') RETURNING id INTO v_hand;
  PERFORM public.floor_table_v3_assert(
    (SELECT h.table_session_id = (v_tracker->>'table_session_id')::uuid
     FROM public.tournament_hands h WHERE h.id = v_hand)
    AND floor_private.floor_table_v3_has_active_hand(
      '00000000-0000-0000-0000-000000000141',
      (v_tracker->>'tournament_table_id')::uuid, (v_tracker->>'table_session_id')::uuid),
    'physical-ID Tracker hand resolves to the same active session');
END;
$$;

SELECT 'FLOOR_DEFERRED_TRACKER_MOVE_DISPOSABLE_PASS' AS result;
