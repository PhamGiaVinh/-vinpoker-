\set ON_ERROR_STOP on

-- Disposable-only activation of the exact V3 writer rollout.  The same
-- additive migration is what a future isolated Preview applies; production
-- remains untouched until its separate owner-gated runbook.
\ir ../../supabase/migrations/20270113000007_floor_table_control_v3_exact_writer_grants.sql

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
  -- Preserve only the opaque fencing context produced by the authenticated
  -- opener.  Tracker deliberately does not receive Floor/Dealer inventory
  -- access; its later assertion proves it can validate this exact context.
  PERFORM set_config(
    'floor_table_v3_test.tournament_table_id',
    v_result ->> 'tournament_table_id',
    false
  );
  PERFORM set_config(
    'floor_table_v3_test.table_session_id',
    v_result ->> 'table_session_id',
    false
  );
  PERFORM set_config(
    'floor_table_v3_test.control_epoch',
    v_result ->> 'control_epoch',
    false
  );
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
  v_result jsonb;
BEGIN
  v_result := public.validate_tracker_table_writer_context_v3(
    '00000000-0000-0000-0000-000000000102',
    current_setting('floor_table_v3_test.tournament_table_id')::uuid,
    current_setting('floor_table_v3_test.table_session_id')::uuid,
    current_setting('floor_table_v3_test.control_epoch')::bigint
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
