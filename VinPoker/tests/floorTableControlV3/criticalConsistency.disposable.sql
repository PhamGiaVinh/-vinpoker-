\set ON_ERROR_STOP on
-- Runs last in the disposable Floor V3 chain. All IDs are TEST-only.
\if :{?SKIP_CRITICAL_CONSISTENCY_MIGRATION}
\else
\ir ../../supabase/migrations/20270128000007_floor_v3_critical_consistency.sql
\endif

SELECT public.floor_table_v3_assert(
  has_function_privilege('authenticated', 'public.get_floor_tournament_table_roster_v5(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.floor_plan_break_table_v1(uuid,bigint,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.floor_break_table_v5(uuid,bigint,uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.floor_break_table_v5(uuid,bigint,uuid,text,text)', 'EXECUTE'),
  'critical consistency public RPC grants are authenticated-only');

INSERT INTO public.game_tables
  (id, club_id, table_name, table_number, operational_status)
VALUES
  ('00000000-0000-0000-0000-000000000559', '00000000-0000-0000-0000-000000000010', 'TEST Orphan 59', 59, 'available'),
  ('00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000010', 'TEST Legacy Seat 60', 60, 'available'),
  ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000010', 'TEST Destination 61', 61, 'available'),
  ('00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000010', 'TEST Break Source 62', 62, 'available'),
  ('00000000-0000-0000-0000-000000000563', '00000000-0000-0000-0000-000000000010', 'TEST Terminal Queue 63', 63, 'available');

INSERT INTO public.table_sessions
  (id, club_id, game_table_id, session_type, tournament_id, control_mode, revision, opened_by)
VALUES
  ('00000000-0000-0000-0000-000000000659', '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000559', 'tournament', '00000000-0000-0000-0000-000000000131',
   'manual', 1, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000660', '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000560', 'tournament', '00000000-0000-0000-0000-000000000131',
   'manual', 1, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000661', '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000561', 'tournament', '00000000-0000-0000-0000-000000000131',
   'tracker', 1, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000662', '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000562', 'tournament', '00000000-0000-0000-0000-000000000131',
   'manual', 1, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000663', '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000563', 'tournament', '00000000-0000-0000-0000-000000000131',
   'manual', 1, '00000000-0000-0000-0000-000000000001');

INSERT INTO public.tournament_tables
  (id, tournament_id, table_name, table_number, max_seats, status,
   game_table_id, table_session_id)
VALUES
  ('00000000-0000-0000-0000-000000000760', '00000000-0000-0000-0000-000000000131',
   'TEST Legacy Seat 60', 60, 9, 'active', '00000000-0000-0000-0000-000000000560',
   '00000000-0000-0000-0000-000000000660'),
  ('00000000-0000-0000-0000-000000000761', '00000000-0000-0000-0000-000000000131',
   'TEST Destination 61', 61, 9, 'active', '00000000-0000-0000-0000-000000000561',
   '00000000-0000-0000-0000-000000000661'),
  ('00000000-0000-0000-0000-000000000762', '00000000-0000-0000-0000-000000000131',
   'TEST Break Source 62', 62, 9, 'active', '00000000-0000-0000-0000-000000000562',
   '00000000-0000-0000-0000-000000000662'),
  ('00000000-0000-0000-0000-000000000763', '00000000-0000-0000-0000-000000000131',
   'TEST Terminal Queue 63', 63, 9, 'active', '00000000-0000-0000-0000-000000000563',
   '00000000-0000-0000-0000-000000000663');

INSERT INTO public.tournament_entries
  (id, tournament_id, registration_id, player_id, entry_no, current_stack, status)
VALUES
  ('00000000-0000-0000-0000-000000000862', '00000000-0000-0000-0000-000000000131',
   NULL, '00000000-0000-0000-0000-000000000962',
   62, 25000, 'seated'),
  ('00000000-0000-0000-0000-000000000863', '00000000-0000-0000-0000-000000000131',
   NULL, '00000000-0000-0000-0000-000000000963',
   63, 10000, 'seated');

INSERT INTO public.tournament_seats
  (id, tournament_id, player_id, entry_number, tournament_table_id,
   table_session_id, seat_number, chip_count, is_active, entry_id,
   player_name, status)
VALUES
  ('00000000-0000-0000-0000-000000000860', '00000000-0000-0000-0000-000000000131',
   '00000000-0000-0000-0000-000000000960', 1,
   '00000000-0000-0000-0000-000000000760', '00000000-0000-0000-0000-000000000660',
   2, 15000, true, NULL, 'TEST Legacy Missing Entry', 'active'),
  ('00000000-0000-0000-0000-000000000862', '00000000-0000-0000-0000-000000000131',
   '00000000-0000-0000-0000-000000000962', 62,
   '00000000-0000-0000-0000-000000000762', '00000000-0000-0000-0000-000000000662',
   1, 25000, true, '00000000-0000-0000-0000-000000000862', 'TEST Valid Break Entry', 'active'),
  ('00000000-0000-0000-0000-000000000863', '00000000-0000-0000-0000-000000000131',
   '00000000-0000-0000-0000-000000000963', 63,
   '00000000-0000-0000-0000-000000000763', '00000000-0000-0000-0000-000000000663',
   1, 10000, false, '00000000-0000-0000-0000-000000000863', 'TEST Terminal Queue Entry', 'moved');

INSERT INTO public.table_session_seat_locks
  (tournament_id, tournament_table_id, table_session_id, seat_number, reason, locked_by)
VALUES
  ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000760',
   '00000000-0000-0000-0000-000000000660', 5, 'TEST locked empty reload',
   '00000000-0000-0000-0000-000000000001');

DO $$
DECLARE
  v_inventory record;
  v_roster record;
  v_plan jsonb;
  v_break jsonb;
  v_retry jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);

  SELECT * INTO v_inventory
  FROM public.get_floor_tournament_table_inventory_v1(
    '00000000-0000-0000-0000-000000000131')
  WHERE game_table_id = '00000000-0000-0000-0000-000000000559';
  PERFORM public.floor_table_v3_assert(
    v_inventory.availability_status = 'repair_required'
      AND v_inventory.table_session_id = '00000000-0000-0000-0000-000000000659',
    'orphan active session is visible as repair_required');

  SELECT * INTO v_roster
  FROM public.get_floor_tournament_table_roster_v5(
    '00000000-0000-0000-0000-000000000131')
  WHERE tournament_table_id = '00000000-0000-0000-0000-000000000760';
  PERFORM public.floor_table_v3_assert(
    pg_catalog.jsonb_array_length(v_roster.seats) = 1
      AND v_roster.seats -> 0 ->> 'integrity_status' = 'missing_entry'
      AND v_roster.seats -> 0 -> 'entry_id' = 'null'::jsonb
      AND v_roster.seat_locks @> '[{"seat_number":5}]'::jsonb,
    'legacy occupied seat and locked empty seat remain visible after reload');

  v_plan := public.floor_plan_break_table_v1(
    '00000000-0000-0000-0000-000000000760', 1, 'fill_lowest_table');
  PERFORM public.floor_table_v3_assert(
    (v_plan ->> 'ok')::boolean
      AND NOT (v_plan ->> 'complete')::boolean,
    'missing-entry seat makes break plan fail closed before mutation');

  UPDATE public.tournaments SET status = 'completed'
  WHERE id = '00000000-0000-0000-0000-000000000131';
  v_plan := public.floor_plan_break_table_v1(
    '00000000-0000-0000-0000-000000000762', 1, 'fill_lowest_table');
  PERFORM public.floor_table_v3_assert(v_plan->>'error' = 'tournament_not_open',
    'terminal tournament rejects break preview');
  UPDATE public.tournaments SET status = 'active'
  WHERE id = '00000000-0000-0000-0000-000000000131';

  -- Isolate the ordinary-move case from earlier disposable fixtures. The
  -- dedicated destination below is Tracker-controlled but has no live hand,
  -- so the server may commit the move immediately under the same exact lease.
  UPDATE public.tournament_tables SET status = 'closed'
  WHERE tournament_id = '00000000-0000-0000-0000-000000000131'
    AND id NOT IN (
      '00000000-0000-0000-0000-000000000760',
      '00000000-0000-0000-0000-000000000761',
      '00000000-0000-0000-0000-000000000762',
      '00000000-0000-0000-0000-000000000763'
    );

  v_plan := public.floor_plan_break_table_v1(
    '00000000-0000-0000-0000-000000000762', 1, 'fill_lowest_table');
  PERFORM public.floor_table_v3_assert(
    (v_plan->>'ok')::boolean AND (v_plan->>'complete')::boolean
      AND pg_catalog.jsonb_array_length(v_plan->'moves') = 1,
    'ordinary break preview is complete and immutable');
  v_break := public.floor_break_table_v5(
    '00000000-0000-0000-0000-000000000762', 1,
    '00000000-0000-0000-0000-000000001507', 'fill_lowest_table',
    v_plan->>'plan_hash');
  PERFORM public.floor_table_v3_assert(
    (v_break->>'ok')::boolean AND (v_break->>'closed')::boolean,
    'ordinary break moves the exact entry before closing source');
  v_retry := public.floor_break_table_v5(
    '00000000-0000-0000-0000-000000000762', 1,
    '00000000-0000-0000-0000-000000001507', 'fill_lowest_table',
    v_plan->>'plan_hash');
  PERFORM public.floor_table_v3_assert(v_retry = v_break,
    'response-loss retry returns the saved receipt');
  v_retry := public.floor_break_table_v5(
    '00000000-0000-0000-0000-000000000762', 1,
    '00000000-0000-0000-0000-000000001507', 'fill_lowest_table',
    'different-payload');
  PERFORM public.floor_table_v3_assert(v_retry->>'error' = 'IDEMPOTENCY_CONFLICT',
    'same request id with different payload conflicts');
  PERFORM public.floor_table_v3_assert(
    NOT EXISTS (SELECT 1 FROM public.tournament_seats
      WHERE table_session_id = '00000000-0000-0000-0000-000000000662' AND is_active)
      AND EXISTS (SELECT 1 FROM public.tournament_seats
        WHERE entry_id = '00000000-0000-0000-0000-000000000862' AND is_active)
      AND EXISTS (SELECT 1 FROM public.table_sessions
        WHERE id = '00000000-0000-0000-0000-000000000662' AND closed_at IS NOT NULL),
    'source closes only after its active seat moved');

  INSERT INTO public.floor_pending_tracker_moves(
    id, tournament_id, entry_id, source_seat_id, source_tournament_table_id,
    source_table_session_id, destination_tournament_table_id,
    destination_table_session_id, destination_seat_number,
    source_control_epoch, destination_control_epoch, requested_by, request_id
  ) VALUES (
    '00000000-0000-0000-0000-000000000507',
    '00000000-0000-0000-0000-000000000131',
    '00000000-0000-0000-0000-000000000863',
    '00000000-0000-0000-0000-000000000863',
    '00000000-0000-0000-0000-000000000763',
    '00000000-0000-0000-0000-000000000663',
    '00000000-0000-0000-0000-000000000761',
    '00000000-0000-0000-0000-000000000661', 9, 1, 1,
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000001508'
  );
  UPDATE public.floor_pending_tracker_moves
  SET status = 'cancelled', resolution_reason = 'TEST terminal transition', resolved_at = pg_catalog.now()
  WHERE id = '00000000-0000-0000-0000-000000000507';
  SET CONSTRAINTS trg_floor_close_completed_break_source_v1 IMMEDIATE;
  PERFORM public.floor_table_v3_assert(
    EXISTS (SELECT 1 FROM public.table_sessions
      WHERE id = '00000000-0000-0000-0000-000000000663' AND closed_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM public.tournament_tables
        WHERE id = '00000000-0000-0000-0000-000000000763' AND status = 'closed'),
    'last terminal cancel re-evaluates and closes an empty break source');
END;
$$;

SELECT 'FLOOR_V3_CRITICAL_CONSISTENCY_DISPOSABLE_PASS' AS result;
