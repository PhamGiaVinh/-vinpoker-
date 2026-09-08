\set ON_ERROR_STOP on

-- One-time owner-gated repair for the exact synthetic Test 1..9 Bàn 5 roster.
-- This is not a migration and not a general NULL entry_id backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE _tracker_test_roster_allowlist (
  seat_number integer PRIMARY KEY,
  player_id uuid UNIQUE NOT NULL,
  player_name text UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO _tracker_test_roster_allowlist (seat_number, player_id, player_name) VALUES
  (1, '91cf8dab-fac3-4b70-9da9-7f94802f5078', 'Test 1'),
  (2, '4b15b3b0-cf0c-4a3b-8072-b0d29f3d1ea6', 'Test 2'),
  (3, '329b37ad-7e71-4239-8c8d-b28c5c858de4', 'Test 3'),
  (4, 'ada51a88-d93c-4648-8f90-e9905d4cedd9', 'Test 4'),
  (5, '14405531-7688-4acc-b8be-fefc1322bc5d', 'Test 5'),
  (6, 'a209ae6e-4588-4e3b-b5f1-e1aa04454588', 'Test 6'),
  (7, '0b199ee9-736b-4ed1-ac24-0d60fd3fcf61', 'Test 7'),
  (8, 'dfdea493-0585-4619-974e-20edc13b5ffb', 'Test 8'),
  (9, '68ff52c6-10de-400d-8a59-35460e052414', 'Test 9');

CREATE TEMP TABLE _tracker_test_roster_repair_context (
  tournament_id uuid PRIMARY KEY,
  tournament_table_id uuid UNIQUE NOT NULL,
  game_table_id uuid UNIQUE NOT NULL,
  table_session_id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

DO $repair_preflight$
DECLARE
  v_group_count integer;
  v_tournament_id uuid;
  v_tournament_table_id uuid;
  v_game_table_id uuid;
  v_table_session_id uuid;
BEGIN
  SELECT count(*)
  INTO v_group_count
  FROM (
    SELECT s.tournament_id, COALESCE(s.tournament_table_id, s.table_id)
    FROM public.tournament_seats s
    JOIN _tracker_test_roster_allowlist a
      ON a.player_id = s.player_id
     AND a.seat_number = s.seat_number
     AND a.player_name = s.player_name
    WHERE s.is_active
    GROUP BY s.tournament_id, COALESCE(s.tournament_table_id, s.table_id)
    HAVING count(*) = 9
  ) grouped_fixture;
  IF v_group_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FIXTURE_REPAIR_PREFLIGHT_FAILED: expected one exact 9-seat context';
  END IF;

  SELECT s.tournament_id, COALESCE(s.tournament_table_id, s.table_id)
  INTO v_tournament_id, v_tournament_table_id
  FROM public.tournament_seats s
  JOIN _tracker_test_roster_allowlist a
    ON a.player_id = s.player_id
   AND a.seat_number = s.seat_number
   AND a.player_name = s.player_name
  WHERE s.is_active
  GROUP BY s.tournament_id, COALESCE(s.tournament_table_id, s.table_id)
  HAVING count(*) = 9;

  SELECT COALESCE(tt.game_table_id, tt.table_id), tt.table_session_id
  INTO v_game_table_id, v_table_session_id
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  JOIN public.game_tables gt ON gt.id = COALESCE(tt.game_table_id, tt.table_id)
  JOIN public.table_sessions ts ON ts.id = tt.table_session_id
  WHERE tt.id = v_tournament_table_id
    AND tt.tournament_id = v_tournament_id
    AND tt.status = 'active'
    AND t.name = 'TEST — Felt UAT (compact)'
    AND t.status NOT IN ('completed', 'cancelled')
    AND gt.table_name = 'Bàn 5'
    AND gt.club_id = t.club_id
    AND ts.club_id = t.club_id
    AND ts.game_table_id = gt.id
    AND ts.tournament_id = t.id
    AND ts.control_mode = 'tracker'
    AND ts.closed_at IS NULL;
  IF v_game_table_id IS NULL OR v_table_session_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_ON_REAL_TOURNAMENT_BLOCKED';
  END IF;

  INSERT INTO _tracker_test_roster_repair_context
    (tournament_id, tournament_table_id, game_table_id, table_session_id)
  VALUES
    (v_tournament_id, v_tournament_table_id, v_game_table_id, v_table_session_id);
END;
$repair_preflight$;

CREATE TEMP TABLE _tracker_test_roster_before AS
SELECT
  (SELECT count(*) FROM public.tournament_entries) AS entries,
  (SELECT count(*) FROM public.tournament_registrations) AS registrations,
  (SELECT count(*) FROM public.seat_draw_receipts) AS receipts,
  (SELECT count(*) FROM public.tournament_hands) AS hands,
  (SELECT count(*) FROM public.hand_actions) AS actions,
  (SELECT count(*) FROM public.hand_players) AS hand_players;

DO $repair_assertions$
DECLARE
  v_context _tracker_test_roster_repair_context%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM _tracker_test_roster_repair_context;

  PERFORM 1 FROM public.tournaments WHERE id = v_context.tournament_id FOR UPDATE;
  PERFORM 1 FROM public.game_tables WHERE id = v_context.game_table_id FOR UPDATE;
  PERFORM 1 FROM public.table_sessions WHERE id = v_context.table_session_id FOR UPDATE;
  PERFORM 1 FROM public.tournament_tables WHERE id = v_context.tournament_table_id FOR UPDATE;
  PERFORM 1
  FROM public.tournament_seats s
  JOIN _tracker_test_roster_allowlist a ON a.player_id = s.player_id
  ORDER BY s.id
  FOR UPDATE OF s;
  PERFORM 1
  FROM public.tournament_chip_counts c
  JOIN _tracker_test_roster_allowlist a ON a.player_id = c.player_id
  ORDER BY c.player_id
  FOR UPDATE OF c;

  IF (SELECT count(*) FROM public.tournament_seats s JOIN _tracker_test_roster_allowlist a ON a.player_id=s.player_id
      WHERE s.tournament_id=v_context.tournament_id AND COALESCE(s.tournament_table_id,s.table_id)=v_context.tournament_table_id
        AND s.table_id=v_context.tournament_table_id AND s.tournament_table_id IS NULL
        AND s.table_session_id IS NULL AND s.seat_number=a.seat_number AND s.player_name=a.player_name
        AND s.entry_id IS NULL AND s.entry_number=1 AND s.is_active AND s.status='active' AND s.chip_count=2000000) <> 9
     OR (SELECT count(*) FROM public.tournament_seats s
         WHERE s.tournament_id=v_context.tournament_id AND COALESCE(s.tournament_table_id,s.table_id)=v_context.tournament_table_id
           AND s.is_active) <> 9
     OR (SELECT count(DISTINCT s.player_id) FROM public.tournament_seats s JOIN _tracker_test_roster_allowlist a ON a.player_id=s.player_id
         WHERE s.tournament_id=v_context.tournament_id AND COALESCE(s.tournament_table_id,s.table_id)=v_context.tournament_table_id AND s.is_active) <> 9
     OR (SELECT sum(s.chip_count) FROM public.tournament_seats s JOIN _tracker_test_roster_allowlist a ON a.player_id=s.player_id
         WHERE s.tournament_id=v_context.tournament_id AND s.is_active) <> 18000000
     OR (SELECT count(*) FROM public.tournament_chip_counts c JOIN _tracker_test_roster_allowlist a ON a.player_id=c.player_id
         WHERE c.tournament_id=v_context.tournament_id AND c.entry_number=1 AND c.chip_count=2000000) <> 9
     OR (SELECT sum(c.chip_count) FROM public.tournament_chip_counts c JOIN _tracker_test_roster_allowlist a ON a.player_id=c.player_id
         WHERE c.tournament_id=v_context.tournament_id) <> 18000000
     OR EXISTS (SELECT 1 FROM public.tournament_entries e JOIN _tracker_test_roster_allowlist a ON a.player_id=e.player_id)
     OR EXISTS (SELECT 1 FROM public.tournament_registrations r JOIN _tracker_test_roster_allowlist a ON a.player_id=r.player_id)
     OR EXISTS (SELECT 1 FROM public.seat_draw_receipts r JOIN _tracker_test_roster_allowlist a ON a.player_id=r.player_id)
     OR EXISTS (SELECT 1 FROM public.tournament_hands h
                WHERE h.tournament_id=v_context.tournament_id
                  AND (h.tournament_table_id=v_context.tournament_table_id
                       OR h.table_id=v_context.tournament_table_id
                       OR h.table_session_id=v_context.table_session_id)
                  AND h.status='in_progress') THEN
    RAISE EXCEPTION 'TEST_FIXTURE_REPAIR_PREFLIGHT_FAILED';
  END IF;
END;
$repair_assertions$;

CREATE TEMP TABLE _tracker_test_roster_created (
  seat_id uuid PRIMARY KEY,
  entry_id uuid UNIQUE NOT NULL,
  player_id uuid UNIQUE NOT NULL,
  seat_number integer UNIQUE NOT NULL
) ON COMMIT DROP;

DO $repair_write$
DECLARE
  v_context _tracker_test_roster_repair_context%ROWTYPE;
  v_seat record;
  v_entry_id uuid;
  v_updated integer;
BEGIN
  SELECT * INTO v_context FROM _tracker_test_roster_repair_context;

  FOR v_seat IN
    SELECT s.id, s.player_id, s.seat_number
    FROM public.tournament_seats s
    JOIN _tracker_test_roster_allowlist a
      ON a.player_id=s.player_id AND a.seat_number=s.seat_number AND a.player_name=s.player_name
    WHERE s.tournament_id=v_context.tournament_id
      AND COALESCE(s.tournament_table_id,s.table_id)=v_context.tournament_table_id
      AND s.table_id=v_context.tournament_table_id
      AND s.tournament_table_id IS NULL
      AND s.table_session_id IS NULL
      AND s.entry_id IS NULL AND s.entry_number=1 AND s.is_active
      AND s.chip_count=2000000
    ORDER BY s.seat_number
  LOOP
    INSERT INTO public.tournament_entries (
      tournament_id, registration_id, player_id, entry_no, source, status,
      current_stack, table_id, seat_id, seat_number, seated_at
    ) VALUES (
      v_context.tournament_id, NULL, v_seat.player_id, 1, 'manual', 'seated',
      2000000, v_context.game_table_id, v_seat.id, v_seat.seat_number, now()
    ) RETURNING id INTO v_entry_id;

    UPDATE public.tournament_seats s
    SET entry_id = v_entry_id,
        tournament_table_id = v_context.tournament_table_id,
        table_session_id = v_context.table_session_id
    WHERE s.id = v_seat.id
      AND s.player_id = v_seat.player_id
      AND s.entry_id IS NULL
      AND s.tournament_table_id IS NULL
      AND s.table_session_id IS NULL
      AND s.entry_number = 1
      AND s.chip_count = 2000000
      AND s.is_active;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'TEST_FIXTURE_REPAIR_PREFLIGHT_FAILED: seat link changed during repair';
    END IF;

    INSERT INTO _tracker_test_roster_created (seat_id, entry_id, player_id, seat_number)
    VALUES (v_seat.id, v_entry_id, v_seat.player_id, v_seat.seat_number);
  END LOOP;

  IF (SELECT count(*) FROM _tracker_test_roster_created) <> 9 THEN
    RAISE EXCEPTION 'TEST_FIXTURE_REPAIR_PREFLIGHT_FAILED: expected nine created entries';
  END IF;
END;
$repair_write$;

DO $repair_postconditions$
DECLARE
  v_context _tracker_test_roster_repair_context%ROWTYPE;
  v_before _tracker_test_roster_before%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM _tracker_test_roster_repair_context;
  SELECT * INTO v_before FROM _tracker_test_roster_before;

  IF (SELECT count(*) FROM public.tournament_entries e JOIN _tracker_test_roster_created c ON c.entry_id=e.id
      JOIN public.tournament_seats s ON s.id=c.seat_id
      WHERE e.tournament_id=v_context.tournament_id AND e.registration_id IS NULL
        AND e.player_id=c.player_id AND e.entry_no=1 AND e.source='manual' AND e.status='seated'
        AND e.current_stack=2000000 AND e.table_id=v_context.game_table_id
        AND e.seat_id=s.id AND e.seat_number=s.seat_number
        AND s.entry_id=e.id AND s.player_id=e.player_id AND s.entry_number=e.entry_no
        AND s.tournament_table_id=v_context.tournament_table_id
        AND s.table_session_id=v_context.table_session_id
        AND s.chip_count=2000000 AND s.is_active) <> 9
     OR (SELECT count(DISTINCT entry_id) FROM _tracker_test_roster_created) <> 9
     OR (SELECT sum(s.chip_count) FROM public.tournament_seats s JOIN _tracker_test_roster_allowlist a ON a.player_id=s.player_id
         WHERE s.tournament_id=v_context.tournament_id AND s.is_active) <> 18000000
     OR (SELECT sum(c.chip_count) FROM public.tournament_chip_counts c JOIN _tracker_test_roster_allowlist a ON a.player_id=c.player_id
         WHERE c.tournament_id=v_context.tournament_id) <> 18000000
     OR (SELECT count(*) FROM public.tournament_entries) <> v_before.entries + 9
     OR (SELECT count(*) FROM public.tournament_registrations) <> v_before.registrations
     OR (SELECT count(*) FROM public.seat_draw_receipts) <> v_before.receipts
     OR (SELECT count(*) FROM public.tournament_hands) <> v_before.hands
     OR (SELECT count(*) FROM public.hand_actions) <> v_before.actions
     OR (SELECT count(*) FROM public.hand_players) <> v_before.hand_players THEN
    RAISE EXCEPTION 'TEST_FIXTURE_REPAIR_PREFLIGHT_FAILED: postcondition mismatch';
  END IF;
END;
$repair_postconditions$;

COMMIT;
SELECT 'TEST_FIXTURE_ENTRY_LINK_REPAIRED' AS result;
