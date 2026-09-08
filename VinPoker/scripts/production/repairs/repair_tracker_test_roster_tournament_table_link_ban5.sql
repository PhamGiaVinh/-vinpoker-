\set ON_ERROR_STOP on

-- One-time owner-gated completion for the exact Test 1..9 partial roster state.
-- Existing entry/session links must be canonical; only tournament_table_id changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE _tracker_partial_allowlist (
  seat_number integer PRIMARY KEY,
  player_id uuid UNIQUE NOT NULL,
  player_name text UNIQUE NOT NULL
) ON COMMIT DROP;
INSERT INTO _tracker_partial_allowlist VALUES
  (1,'91cf8dab-fac3-4b70-9da9-7f94802f5078','Test 1'),
  (2,'4b15b3b0-cf0c-4a3b-8072-b0d29f3d1ea6','Test 2'),
  (3,'329b37ad-7e71-4239-8c8d-b28c5c858de4','Test 3'),
  (4,'ada51a88-d93c-4648-8f90-e9905d4cedd9','Test 4'),
  (5,'14405531-7688-4acc-b8be-fefc1322bc5d','Test 5'),
  (6,'a209ae6e-4588-4e3b-b5f1-e1aa04454588','Test 6'),
  (7,'0b199ee9-736b-4ed1-ac24-0d60fd3fcf61','Test 7'),
  (8,'dfdea493-0585-4619-974e-20edc13b5ffb','Test 8'),
  (9,'68ff52c6-10de-400d-8a59-35460e052414','Test 9');

CREATE TEMP TABLE _tracker_partial_context (
  tournament_id uuid PRIMARY KEY,
  tournament_table_id uuid UNIQUE NOT NULL,
  game_table_id uuid UNIQUE NOT NULL,
  table_session_id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

DO $preflight$
DECLARE v_context_count integer;
BEGIN
  SELECT count(*) INTO v_context_count FROM (
    SELECT s.tournament_id,s.table_id,s.table_session_id
    FROM public.tournament_seats s JOIN _tracker_partial_allowlist a
      ON a.player_id=s.player_id AND a.seat_number=s.seat_number AND a.player_name=s.player_name
    WHERE s.is_active AND s.tournament_table_id IS NULL
    GROUP BY s.tournament_id,s.table_id,s.table_session_id HAVING count(*)=9
  ) exact_context;
  IF v_context_count<>1 THEN RAISE EXCEPTION 'PARTIAL_REPAIR_STATE_DRIFT'; END IF;

  INSERT INTO _tracker_partial_context
  SELECT t.id,tt.id,gt.id,ts.id
  FROM public.tournament_seats s JOIN _tracker_partial_allowlist a
    ON a.player_id=s.player_id AND a.seat_number=s.seat_number AND a.player_name=s.player_name
  JOIN public.tournaments t ON t.id=s.tournament_id
  JOIN public.tournament_tables tt ON tt.id=s.table_id AND tt.tournament_id=t.id
  JOIN public.game_tables gt ON gt.id=tt.game_table_id AND gt.club_id=t.club_id
  JOIN public.table_sessions ts ON ts.id=tt.table_session_id AND ts.id=s.table_session_id
    AND ts.club_id=t.club_id AND ts.tournament_id=t.id AND ts.game_table_id=gt.id
  WHERE s.is_active AND s.tournament_table_id IS NULL
    AND t.name='TEST — Felt UAT (compact)' AND t.status NOT IN ('completed','cancelled')
    AND tt.status='active' AND gt.table_name='Bàn 5'
    AND ts.control_mode='tracker' AND ts.closed_at IS NULL
  GROUP BY t.id,tt.id,gt.id,ts.id HAVING count(*)=9;
  IF (SELECT count(*) FROM _tracker_partial_context)<>1 THEN RAISE EXCEPTION 'LEGACY_TABLE_IDENTITY_MISMATCH'; END IF;
  IF (SELECT value FROM public.app_settings WHERE key='tracker_voice_global_enabled') IS DISTINCT FROM 'false'::jsonb
     OR (SELECT value FROM public.app_settings WHERE key='tracker_voice_auto_provision_enabled') IS DISTINCT FROM 'false'::jsonb
     OR EXISTS (SELECT 1 FROM public.tracker_voice_configs WHERE enabled) THEN
    RAISE EXCEPTION 'voice_runtime_must_be_fully_off';
  END IF;
END;
$preflight$;

DO $locked_assertions$
DECLARE v _tracker_partial_context%ROWTYPE;
BEGIN
  SELECT * INTO v FROM _tracker_partial_context;
  PERFORM 1 FROM public.tournaments WHERE id=v.tournament_id FOR UPDATE;
  PERFORM 1 FROM public.game_tables WHERE id=v.game_table_id FOR UPDATE;
  PERFORM 1 FROM public.table_sessions WHERE id=v.table_session_id FOR UPDATE;
  PERFORM 1 FROM public.tournament_tables WHERE id=v.tournament_table_id FOR UPDATE;
  PERFORM 1 FROM public.tournament_seats s JOIN _tracker_partial_allowlist a ON a.player_id=s.player_id ORDER BY s.id FOR UPDATE OF s;
  PERFORM 1 FROM public.tournament_entries e JOIN _tracker_partial_allowlist a ON a.player_id=e.player_id ORDER BY e.id FOR UPDATE OF e;
  PERFORM 1 FROM public.tournament_chip_counts c JOIN _tracker_partial_allowlist a ON a.player_id=c.player_id ORDER BY c.player_id FOR UPDATE OF c;
  IF (SELECT count(*) FROM public.tournament_seats s WHERE s.tournament_id=v.tournament_id AND s.table_id=v.tournament_table_id AND s.is_active)<>9
     OR (SELECT count(*) FROM public.tournament_seats s JOIN _tracker_partial_allowlist a ON a.player_id=s.player_id
         WHERE s.tournament_id=v.tournament_id AND s.table_id=v.tournament_table_id AND s.tournament_table_id IS NULL
           AND s.table_session_id=v.table_session_id AND s.entry_id IS NOT NULL AND s.entry_number=1
           AND s.chip_count=2000000 AND s.is_active AND s.status='active'
           AND s.seat_number=a.seat_number AND s.player_name=a.player_name)<>9
     OR (SELECT count(*) FROM public.tournament_seats s JOIN _tracker_partial_allowlist a ON a.player_id=s.player_id
         JOIN public.tournament_entries e ON e.id=s.entry_id
         WHERE e.tournament_id=s.tournament_id AND e.player_id=s.player_id AND e.entry_no=s.entry_number
           AND e.status='seated' AND e.registration_id IS NULL AND e.current_stack=2000000
           AND e.seat_id=s.id AND e.seat_number=s.seat_number AND e.table_id=v.game_table_id)<>9
     OR (SELECT count(DISTINCT s.entry_id) FROM public.tournament_seats s JOIN _tracker_partial_allowlist a ON a.player_id=s.player_id)<>9
     OR EXISTS (SELECT 1 FROM public.tournament_entries e JOIN _tracker_partial_allowlist a ON a.player_id=e.player_id GROUP BY e.player_id,e.entry_no HAVING count(*)<>1)
     OR (SELECT count(*) FROM public.tournament_chip_counts c JOIN _tracker_partial_allowlist a ON a.player_id=c.player_id WHERE c.tournament_id=v.tournament_id AND c.entry_number=1 AND c.chip_count=2000000)<>9
     OR (SELECT sum(s.chip_count) FROM public.tournament_seats s JOIN _tracker_partial_allowlist a ON a.player_id=s.player_id WHERE s.tournament_id=v.tournament_id AND s.is_active)<>18000000
     OR (SELECT sum(c.chip_count) FROM public.tournament_chip_counts c JOIN _tracker_partial_allowlist a ON a.player_id=c.player_id WHERE c.tournament_id=v.tournament_id)<>18000000 THEN
    RAISE EXCEPTION 'EXISTING_TEST_ENTRY_LINK_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_hands h WHERE h.status='in_progress'
    AND (h.tournament_table_id=v.tournament_table_id OR h.table_id=v.tournament_table_id OR h.table_session_id=v.table_session_id)) THEN
    RAISE EXCEPTION 'TARGET_TABLE_ACTIVE_HAND_BLOCKED';
  END IF;
END;
$locked_assertions$;

CREATE TEMP TABLE _tracker_partial_before AS
SELECT s.id,md5((to_jsonb(s)-'tournament_table_id')::text) unchanged_hash
FROM public.tournament_seats s JOIN _tracker_partial_allowlist a ON a.player_id=s.player_id;
CREATE TEMP TABLE _tracker_partial_counts_before AS SELECT
  (SELECT count(*) FROM public.tournament_entries) entries,
  (SELECT count(*) FROM public.tournament_registrations) registrations,
  (SELECT count(*) FROM public.seat_draw_receipts) receipts,
  (SELECT count(*) FROM public.tournament_hands) hands,
  (SELECT count(*) FROM public.hand_players) hand_players,
  (SELECT count(*) FROM public.hand_actions) actions,
  (SELECT count(*) FROM public.tournament_chip_counts) chips;

DO $write$
DECLARE v _tracker_partial_context%ROWTYPE; v_updated integer;
BEGIN
  SELECT * INTO v FROM _tracker_partial_context;
  UPDATE public.tournament_seats s SET tournament_table_id=v.tournament_table_id
  FROM _tracker_partial_allowlist a
  WHERE s.player_id=a.player_id AND s.seat_number=a.seat_number AND s.player_name=a.player_name
    AND s.tournament_id=v.tournament_id AND s.table_id=v.tournament_table_id
    AND s.tournament_table_id IS NULL AND s.table_session_id=v.table_session_id
    AND s.entry_id IS NOT NULL AND s.entry_number=1 AND s.chip_count=2000000
    AND s.is_active AND s.status='active';
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>9 THEN RAISE EXCEPTION 'PARTIAL_REPAIR_ROW_COUNT_MISMATCH'; END IF;
END;
$write$;

DO $postconditions$
DECLARE v _tracker_partial_context%ROWTYPE; b _tracker_partial_counts_before%ROWTYPE;
BEGIN
  SELECT * INTO v FROM _tracker_partial_context; SELECT * INTO b FROM _tracker_partial_counts_before;
  IF (SELECT count(*) FROM public.tournament_seats s JOIN _tracker_partial_allowlist a ON a.player_id=s.player_id
      WHERE s.tournament_table_id=v.tournament_table_id AND s.table_session_id=v.table_session_id AND s.entry_id IS NOT NULL)<>9
     OR EXISTS (SELECT 1 FROM public.tournament_seats s JOIN _tracker_partial_before p ON p.id=s.id WHERE md5((to_jsonb(s)-'tournament_table_id')::text)<>p.unchanged_hash)
     OR (SELECT count(*) FROM public.tournament_entries)<>b.entries
     OR (SELECT count(*) FROM public.tournament_registrations)<>b.registrations
     OR (SELECT count(*) FROM public.seat_draw_receipts)<>b.receipts
     OR (SELECT count(*) FROM public.tournament_hands)<>b.hands
     OR (SELECT count(*) FROM public.hand_players)<>b.hand_players
     OR (SELECT count(*) FROM public.hand_actions)<>b.actions
     OR (SELECT count(*) FROM public.tournament_chip_counts)<>b.chips THEN
    RAISE EXCEPTION 'PARTIAL_REPAIR_POSTCONDITION_FAILED';
  END IF;
END;
$postconditions$;
COMMIT;
SELECT 'TRACKER_TEST_ROSTER_PARTIAL_TABLE_LINK_REPAIRED' AS result;
