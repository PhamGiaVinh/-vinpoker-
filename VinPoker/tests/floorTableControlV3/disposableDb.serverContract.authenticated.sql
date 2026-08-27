\set ON_ERROR_STOP on

-- Disposable-only activation of the exact V3 writer grants.  Production remains
-- OFF because 20270113000004 revokes these from authenticated; no browser role
-- can grant itself access.
GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;

-- These calls are deliberately made as the PostgreSQL `authenticated` role,
-- not as the disposable database owner with a spoofed auth.uid().  The setup
-- rows below are created by the fixture owner; every V3 RPC assertion below
-- changes to the browser role before invoking the SECURITY DEFINER seam.

INSERT INTO public.tournaments (id, club_id) VALUES
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010');
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000508', '00000000-0000-0000-0000-000000000010', 'Bàn 11', 11, 'available'),
  ('00000000-0000-0000-0000-000000000509', '00000000-0000-0000-0000-000000000010', 'Bàn 12', 12, 'available');
INSERT INTO public.profiles (user_id, display_name) VALUES
  ('00000000-0000-0000-0000-000000000907', 'Authenticated entry');
INSERT INTO public.tournament_entries (
  id, tournament_id, registration_id, player_id, entry_no, current_stack, status
) VALUES (
  '00000000-0000-0000-0000-000000000807',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000a07',
  '00000000-0000-0000-0000-000000000907',
  7,
  30000,
  'registered'
);

-- Owner opens a Tracker session through the exact authenticated function
-- grant.  The hardening migration keeps production grants OFF; this disposable
-- suite re-grants them below solely to exercise the future owner-gated UAT path.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000508',
    'tracker',
    '00000000-0000-0000-0000-000000002001'
  );
  IF (v_result ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'authenticated owner open failed: %', v_result;
  END IF;
END;
$$;
COMMIT;

-- A genuine Floor member reads the inventory and seats a registration-backed
-- entry.  This proves the public function executes under `authenticated`,
-- while the underlying tables remain non-readable to browser roles.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  v_table_id uuid;
  v_revision bigint;
  v_result jsonb;
BEGIN
  SELECT tournament_table_id, revision
  INTO v_table_id, v_revision
  FROM public.get_club_table_inventory('00000000-0000-0000-0000-000000000010')
  WHERE game_table_id = '00000000-0000-0000-0000-000000000508';
  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'authenticated Floor cannot see its own table inventory';
  END IF;
  v_result := public.floor_assign_entry_to_seat(
    '00000000-0000-0000-0000-000000000807',
    v_table_id,
    1,
    v_revision,
    '00000000-0000-0000-0000-000000002002'
  );
  IF (v_result ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'authenticated Floor seat failed: %', v_result;
  END IF;
END;
$$;
COMMIT;

-- A genuine Tracker member can validate only the active session and current
-- fencing epoch.  The same function is the writer precondition for PR3.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_table_id uuid;
  v_session_id uuid;
  v_epoch bigint;
  v_result jsonb;
BEGIN
  SELECT tournament_table_id, table_session_id, control_epoch
  INTO v_table_id, v_session_id, v_epoch
  FROM public.get_club_table_inventory('00000000-0000-0000-0000-000000000010')
  WHERE game_table_id = '00000000-0000-0000-0000-000000000508';
  v_result := public.validate_tracker_table_writer_context_v3(
    '00000000-0000-0000-0000-000000000102', v_table_id, v_session_id, v_epoch
  );
  IF (v_result ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'authenticated Tracker context failed: %', v_result;
  END IF;
END;
$$;
COMMIT;

-- Dealer Control opens and closes Cash through the shared lease contract.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  v_open jsonb;
  v_close jsonb;
  v_session_id uuid;
BEGIN
  v_open := public.operator_open_club_tables_v2(
    ARRAY['00000000-0000-0000-0000-000000000509']::uuid[],
    'cash',
    '00000000-0000-0000-0000-000000002003'
  );
  IF (v_open ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'authenticated Dealer Control open failed: %', v_open;
  END IF;
  v_session_id := (v_open -> 'sessions' -> 0 ->> 'table_session_id')::uuid;
  v_close := public.operator_close_club_table_v2(
    v_session_id,
    1,
    '00000000-0000-0000-0000-000000002004'
  );
  IF (v_close ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'authenticated Dealer Control close failed: %', v_close;
  END IF;
END;
$$;
COMMIT;

-- An authenticated Floor member of Club A cannot target physical inventory
-- owned by Club B even with a real tournament ID from Club A.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.floor_open_tournament_table_v3(
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000502',
    'manual',
    '00000000-0000-0000-0000-000000002005'
  );
  IF v_result ->> 'error' IS DISTINCT FROM 'game_table_scope_mismatch' THEN
    RAISE EXCEPTION 'authenticated cross-club access was not denied: %', v_result;
  END IF;
END;
$$;
COMMIT;

SELECT 'FLOOR_TABLE_CONTROL_V3_AUTHENTICATED_CALLER_PASS' AS result;
