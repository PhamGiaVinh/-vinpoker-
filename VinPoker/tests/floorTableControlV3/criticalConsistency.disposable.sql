\set ON_ERROR_STOP on
-- Runs last in the disposable Floor V3 chain. All IDs are TEST-only.
\ir ../../supabase/migrations/20270127000000_floor_v3_critical_consistency.sql

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
  ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000010', 'TEST Destination 61', 61, 'available');

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
   'tracker', 1, '00000000-0000-0000-0000-000000000001');

INSERT INTO public.tournament_tables
  (id, tournament_id, table_name, table_number, max_seats, status,
   game_table_id, table_session_id)
VALUES
  ('00000000-0000-0000-0000-000000000760', '00000000-0000-0000-0000-000000000131',
   'TEST Legacy Seat 60', 60, 9, 'active', '00000000-0000-0000-0000-000000000560',
   '00000000-0000-0000-0000-000000000660'),
  ('00000000-0000-0000-0000-000000000761', '00000000-0000-0000-0000-000000000131',
   'TEST Destination 61', 61, 9, 'active', '00000000-0000-0000-0000-000000000561',
   '00000000-0000-0000-0000-000000000661');

INSERT INTO public.tournament_seats
  (id, tournament_id, player_id, entry_number, tournament_table_id,
   table_session_id, seat_number, chip_count, is_active, entry_id,
   player_name, status)
VALUES
  ('00000000-0000-0000-0000-000000000860', '00000000-0000-0000-0000-000000000131',
   '00000000-0000-0000-0000-000000000960', 1,
   '00000000-0000-0000-0000-000000000760', '00000000-0000-0000-0000-000000000660',
   2, 15000, true, NULL, 'TEST Legacy Missing Entry', 'active');

DO $$
DECLARE
  v_inventory record;
  v_roster record;
  v_plan jsonb;
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
      AND v_roster.seats -> 0 -> 'entry_id' = 'null'::jsonb,
    'legacy occupied seat remains visible and explicitly invalid');

  v_plan := public.floor_plan_break_table_v1(
    '00000000-0000-0000-0000-000000000760', 1, 'fill_lowest_table');
  PERFORM public.floor_table_v3_assert(
    (v_plan ->> 'ok')::boolean
      AND NOT (v_plan ->> 'complete')::boolean,
    'missing-entry seat makes break plan fail closed before mutation');
END;
$$;

SELECT 'FLOOR_V3_CRITICAL_CONSISTENCY_DISPOSABLE_PASS' AS result;
