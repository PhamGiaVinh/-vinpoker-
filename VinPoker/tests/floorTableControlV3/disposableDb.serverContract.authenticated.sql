\set ON_ERROR_STOP on

-- Disposable-only activation of the exact V3 writer rollout. This test fixture
-- is outside the active migration catalog; production writer grants stay
-- revoked until a separate owner-gated Preview/bootstrap runbook.
\ir previewOnlyWriterGrants.sql

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

-- Tracker roster writes now create the canonical entry and every projection in
-- one transaction. Calls use both accepted table-id forms to prove they resolve
-- to one server-owned tournament/physical/session identity.
INSERT INTO public.tournaments (id, club_id) VALUES
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000010');
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES
  ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000010', 'Bàn 14', 14, 'available');
INSERT INTO public.table_sessions (
  id, club_id, game_table_id, session_type, tournament_id, control_mode, control_epoch, revision
) VALUES (
  '00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000511', 'tournament',
  '00000000-0000-0000-0000-000000000107', 'tracker', 1, 1
);
INSERT INTO public.tournament_tables (
  id, tournament_id, game_table_id, table_session_id, table_number, max_seats, status
) VALUES (
  '00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000611',
  14, 9, 'active'
);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_table_id uuid := '00000000-0000-0000-0000-000000000711';
  v_first jsonb;
  v_second jsonb;
  v_third jsonb;
BEGIN
  v_first := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107', v_table_id, 1,
    'Tracker Walk-in A', 40000, NULL, false, NULL,
    '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert((v_first ->> 'ok')::boolean, 'Tracker walk-in A creates successfully');
  v_second := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107',
    '00000000-0000-0000-0000-000000000511', 2,
    'Tracker Walk-in B', 30000, NULL, false, NULL,
    '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert((v_second ->> 'ok')::boolean, 'Tracker walk-in B normalizes physical table identity');
  v_third := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107', v_table_id, 8,
    'Tracker Walk-in C', 20000, NULL, false, NULL,
    '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert((v_third ->> 'ok')::boolean, 'Tracker walk-in C creates successfully');
  PERFORM set_config('floor_table_v3_test.roster_entry_a', v_first -> 'seat' ->> 'entry_id', false);
  PERFORM set_config('floor_table_v3_test.roster_player_a', v_first -> 'seat' ->> 'player_id', false);
  PERFORM set_config('floor_table_v3_test.roster_entry_b', v_second -> 'seat' ->> 'entry_id', false);
  PERFORM set_config('floor_table_v3_test.roster_player_b', v_second -> 'seat' ->> 'player_id', false);
  PERFORM set_config('floor_table_v3_test.roster_entry_c', v_third -> 'seat' ->> 'entry_id', false);
  PERFORM set_config('floor_table_v3_test.roster_player_c', v_third -> 'seat' ->> 'player_id', false);
END;
$$;
COMMIT;

INSERT INTO public.profiles (user_id, display_name) VALUES
  (current_setting('floor_table_v3_test.roster_player_a')::uuid, 'Global Profile A'),
  (current_setting('floor_table_v3_test.roster_player_b')::uuid, 'Global Profile B');
UPDATE public.tournament_seats
SET player_name = CASE seat_number WHEN 2 THEN '   ' ELSE NULL END
WHERE tournament_id='00000000-0000-0000-0000-000000000107'
  AND seat_number IN (2,8);

SELECT public.floor_table_v3_assert(
  (SELECT count(*) = 3
   FROM public.tournament_seats s
   JOIN public.tournament_entries e ON e.id=s.entry_id
   JOIN public.tournament_chip_counts c
     ON c.tournament_id=s.tournament_id AND c.player_id=s.player_id AND c.entry_number=s.entry_number
   WHERE s.tournament_id='00000000-0000-0000-0000-000000000107'
     AND s.tournament_table_id='00000000-0000-0000-0000-000000000711'
     AND s.table_session_id='00000000-0000-0000-0000-000000000611'
     AND e.player_id=s.player_id AND e.entry_no=s.entry_number
     AND e.registration_id IS NULL AND e.source='manual' AND e.status='seated'
     AND e.table_id='00000000-0000-0000-0000-000000000511'
     AND e.seat_id=s.id AND e.seat_number=s.seat_number
     AND e.current_stack=s.chip_count AND c.chip_count=s.chip_count
     AND s.chip_count IN (20000,30000,40000)),
  'Tracker walk-ins have exact seat-entry-chip identity'
);

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  v_seats jsonb;
BEGIN
  SELECT r.seats INTO v_seats
  FROM public.get_floor_tournament_table_roster_v3('00000000-0000-0000-0000-000000000107') r
  WHERE r.tournament_table_id='00000000-0000-0000-0000-000000000711';
  PERFORM public.floor_table_v3_assert(
    jsonb_array_length(v_seats)=3
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_seats) item
      WHERE item ->> 'entry_id' IS NULL OR item ->> 'player_id' IS NULL
        OR (item ->> 'entry_no')::integer <> 1 OR (item ->> 'chip_count')::integer NOT IN (20000,30000,40000)
    ),
    'Floor V3 roster reads Tracker-created walk-ins without malformed identities'
  );
  PERFORM public.floor_table_v3_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_seats) item WHERE (item ->> 'seat_number')::integer=1 AND item ->> 'display_name'='Tracker Walk-in A')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_seats) item WHERE (item ->> 'seat_number')::integer=2 AND item ->> 'display_name'='Global Profile B')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_seats) item WHERE (item ->> 'seat_number')::integer=8 AND item ->> 'display_name'=current_setting('floor_table_v3_test.roster_player_c')),
    'active roster uses seat name, then profile, then player UUID'
  );
END;
$$;
COMMIT;

-- A canonical roster edit with the same chip amount changes only display state.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_result jsonb;
  v_seats jsonb;
BEGIN
  v_result := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107',
    '00000000-0000-0000-0000-000000000711', 1,
    'Tracker Walk-in A display edited', 40000,
    current_setting('floor_table_v3_test.roster_player_a')::uuid,
    false, NULL, '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert((v_result ->> 'ok')::boolean, 'canonical roster display edit succeeds');
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  SELECT r.seats INTO v_seats
  FROM public.get_floor_tournament_table_roster_v3('00000000-0000-0000-0000-000000000107') r
  WHERE r.tournament_table_id='00000000-0000-0000-0000-000000000711';
  PERFORM public.floor_table_v3_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_seats) item WHERE (item ->> 'seat_number')::integer=1 AND item ->> 'display_name'='Tracker Walk-in A display edited'),
    'canonical display edit is visible to the Floor operator'
  );
END;
$$;
COMMIT;

SELECT public.floor_table_v3_assert(
  (SELECT e.current_stack=40000 AND s.chip_count=40000 AND c.chip_count=40000
   FROM public.tournament_entries e
   JOIN public.tournament_seats s ON s.entry_id=e.id
   JOIN public.tournament_chip_counts c
     ON c.tournament_id=s.tournament_id AND c.player_id=s.player_id AND c.entry_number=s.entry_number
   WHERE e.id=current_setting('floor_table_v3_test.roster_entry_a')::uuid),
  'canonical display edit leaves all chip values unchanged'
);

-- A valid linked edit preserves entry identity and advances all pre-hand stack projections.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107',
    '00000000-0000-0000-0000-000000000711', 1,
    'Tracker Walk-in A edited', 45000,
    current_setting('floor_table_v3_test.roster_player_a')::uuid,
    false, NULL, '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert(
    (v_result ->> 'ok')::boolean
    AND v_result -> 'seat' ->> 'entry_id' = current_setting('floor_table_v3_test.roster_entry_a'),
    'valid linked seat edit preserves canonical entry identity'
  );
END;
$$;
COMMIT;

SELECT public.floor_table_v3_assert(
  (SELECT e.current_stack=45000 AND s.chip_count=45000 AND c.chip_count=45000
   FROM public.tournament_entries e
   JOIN public.tournament_seats s ON s.entry_id=e.id
   JOIN public.tournament_chip_counts c
     ON c.tournament_id=s.tournament_id AND c.player_id=s.player_id AND c.entry_number=s.entry_number
   WHERE e.id=current_setting('floor_table_v3_test.roster_entry_a')::uuid),
  'linked edit keeps entry, seat and tracker chip projections equal'
);

-- A legacy malformed seat is explicit and immutable through the normal editor.
INSERT INTO public.tournament_seats (
  tournament_id, player_id, entry_number, table_id, tournament_table_id,
  table_session_id, seat_number, chip_count, entry_id, is_active, status, player_name
) VALUES (
  '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000990', 1,
  '00000000-0000-0000-0000-000000000711',
  '00000000-0000-0000-0000-000000000711',
  '00000000-0000-0000-0000-000000000611',
  3, 25000, NULL, true, 'active', 'Malformed legacy seat'
);
INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
VALUES ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000990', 1, 25000);

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107',
    '00000000-0000-0000-0000-000000000711', 3,
    'Must not change', 26000, '00000000-0000-0000-0000-000000000990',
    false, NULL, '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert_json(
    v_result, 'tracker_roster_entry_link_required', 'malformed existing seat fails closed'
  );
END;
$$;
COMMIT;
SELECT public.floor_table_v3_assert(
  (SELECT player_name='Malformed legacy seat' AND chip_count=25000 AND entry_id IS NULL
   FROM public.tournament_seats WHERE player_id='00000000-0000-0000-0000-000000000990'),
  'malformed existing seat has zero mutation'
);

-- Caller binding, table scope and live-hand fencing remain unchanged.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000711', 4,
    'Spoof denied', 20000, NULL, false, NULL, '00000000-0000-0000-0000-000000000002'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'actor_not_allowed', 'Tracker roster rejects spoofed actor');
  v_result := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000502', 4,
    'Wrong table denied', 20000, NULL, false, NULL, '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'table_mismatch', 'Tracker roster rejects cross-club table identity');
END;
$$;
COMMIT;

CREATE OR REPLACE FUNCTION public.floor_table_v3_test_reject_roster_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('floor_table_v3_test.inject_roster_failure', true) = 'on' THEN
    RAISE EXCEPTION 'fixture_entry_insert_failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER floor_table_v3_test_reject_roster_entry
BEFORE INSERT ON public.tournament_entries
FOR EACH ROW EXECUTE FUNCTION public.floor_table_v3_test_reject_roster_entry();

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT set_config('floor_table_v3_test.inject_roster_failure', 'on', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.set_tracker_table_roster_seat(
      '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000711', 4,
      'Injected failure', 20000, NULL, false, NULL, '00000000-0000-0000-0000-000000000004'
    );
    RAISE EXCEPTION 'expected injected roster entry failure';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'fixture_entry_insert_failure' THEN
      RAISE;
    END IF;
  END;
END;
$$;
COMMIT;
SELECT public.floor_table_v3_assert(
  NOT EXISTS (
    SELECT 1
    FROM public.tournament_seats
    WHERE tournament_id = '00000000-0000-0000-0000-000000000107'
      AND seat_number = 4
  ),
  'entry insertion failure rolls back the preceding seat insert'
);
DROP TRIGGER floor_table_v3_test_reject_roster_entry ON public.tournament_entries;
DROP FUNCTION public.floor_table_v3_test_reject_roster_entry();

INSERT INTO public.tournament_hands (
  id, tournament_id, table_id, tournament_table_id, table_session_id, status, is_voided
) VALUES (
  '00000000-0000-0000-0000-000000000951', '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000711',
  '00000000-0000-0000-0000-000000000611', 'in_progress', false
);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.set_tracker_table_roster_seat(
    '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000711', 4,
    'Hand guard', 20000, NULL, false, NULL, '00000000-0000-0000-0000-000000000004'
  );
  PERFORM public.floor_table_v3_assert_json(v_result, 'hand_in_progress', 'live hand blocks Tracker roster mutation');
END;
$$;
COMMIT;
SELECT public.floor_table_v3_assert(
  NOT EXISTS (SELECT 1 FROM public.tournament_seats WHERE tournament_id='00000000-0000-0000-0000-000000000107' AND seat_number=4),
  'live-hand rejection leaves no roster residue'
);
DELETE FROM public.tournament_hands WHERE id='00000000-0000-0000-0000-000000000951';

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
