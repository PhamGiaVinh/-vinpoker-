-- ============================================================================
-- Floor Table Control V3 — final live identity bridge (SOURCE-ONLY / RED)
-- ============================================================================
-- Depends on: 20270113000002_floor_table_control_v3_foundation.sql
--
-- This one-time bridge first quarantines the exact stale cross-club STAGE_TEST
-- fixture proven below, then links only current operational tournament-table
-- rows through the explicit V3 identities added by the foundation.  Legacy
-- table_id values, chips, seats, hands, money and payout state are never
-- rewritten.  The successor contract remains responsible for V3 RPCs and
-- keeps all authenticated mutation writers revoked.
--
-- ROLLBACK (owner-gated): use the pre-apply physical backup for this exact
-- production migration.  Do not delete fixture children, game tables, history
-- or receipts to undo this bridge.
-- ============================================================================

BEGIN;

-- The bridge is a production maintenance transaction, not a browser path.
-- Lock the affected relationships before reading their exact identity state.
LOCK TABLE public.tournaments IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tournament_tables IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tournament_entries IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tournament_seats IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tournament_hands IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.dealer_assignments IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.game_tables IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.table_sessions IN SHARE ROW EXCLUSIVE MODE;

-- A1. The two rows below are a known, stale cross-club fixture.  A raw
-- game_tables primary-key match is required for each row; a same-club match is
-- deliberately not required because the cross-club mismatch is the quarantine
-- receipt.  Any deviation aborts before writing anything.
DO $$
DECLARE
  v_fixture_tournament constant uuid := '11111111-1111-1111-1111-111111111111';
  v_fixture_club constant uuid := '11111111-1111-1111-1111-111111111111';
  v_physical_fixture_club constant uuid := '33333333-3333-3333-3333-333333333333';
  v_table_one constant uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_table_two constant uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_game_one constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_game_two constant uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_cutoff constant timestamptz := '2026-06-13 03:57:08.065228+07';
  v_count integer;
  v_last_activity timestamptz;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.tournaments t
  WHERE t.id = v_fixture_tournament
    AND t.club_id = v_fixture_club
    AND t.name = 'STAGE_TEST Tournament'
    AND t.deleted_at IS NULL
    AND t.status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = v_fixture_tournament
    AND tt.status = 'active';
  IF v_count <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tournament_tables tt
  JOIN public.game_tables gt ON gt.id = tt.table_id
  WHERE tt.id = v_table_one
    AND tt.tournament_id = v_fixture_tournament
    AND tt.table_id = v_game_one
    AND tt.status = 'active'
    AND gt.club_id = v_physical_fixture_club;
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tournament_tables tt
  JOIN public.game_tables gt ON gt.id = tt.table_id
  WHERE tt.id = v_table_two
    AND tt.tournament_id = v_fixture_tournament
    AND tt.table_id = v_game_two
    AND tt.status = 'active'
    AND gt.club_id = v_physical_fixture_club;
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands hand_row
    WHERE hand_row.tournament_id = v_fixture_tournament
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tournament_entries entry_row
  WHERE entry_row.tournament_id = v_fixture_tournament;
  IF v_count <> 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_fixture_tournament;
  IF v_count <> 9 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;

  SELECT greatest(
    t.updated_at,
    coalesce((SELECT max(e.updated_at) FROM public.tournament_entries e WHERE e.tournament_id = t.id), '-infinity'::timestamptz),
    coalesce((SELECT max(s.created_at) FROM public.tournament_seats s WHERE s.tournament_id = t.id), '-infinity'::timestamptz)
  ) INTO v_last_activity
  FROM public.tournaments t
  WHERE t.id = v_fixture_tournament;
  IF v_last_activity IS NULL OR v_last_activity > v_cutoff THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_stage_test_receipt_changed';
  END IF;
END;
$$;

-- Soft-quarantine only the stale fixture.  Its children and the separately
-- owned TEST-T1/TEST-T2 physical tables remain immutable historical evidence.
UPDATE public.tournaments
SET deleted_at = now(),
    status = 'cancelled'
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE public.tournament_tables
SET status = 'closed'
WHERE id IN (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd'
);

-- A2. Every remaining operational assignment must have exactly one same-club
-- physical table.  The fixture above is now deleted/cancelled and excluded.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.tournaments t ON t.id = tt.tournament_id
    LEFT JOIN public.game_tables gt
      ON gt.id = tt.table_id
     AND gt.club_id = t.club_id
    WHERE t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND tt.status = 'active'
      AND gt.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_real_identity_preflight_failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.tournaments t ON t.id = tt.tournament_id
    WHERE t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND tt.status = 'active'
    GROUP BY tt.table_id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_duplicate_physical_table';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.tournaments t ON t.id = tt.tournament_id
    LEFT JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
    WHERE t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND tt.status = 'active'
      AND (
        (tt.game_table_id IS NULL) <> (tt.table_session_id IS NULL)
        OR (tt.game_table_id IS NOT NULL AND (
          tt.game_table_id IS DISTINCT FROM tt.table_id
          OR session_row.id IS NULL
          OR session_row.closed_at IS NOT NULL
          OR session_row.game_table_id IS DISTINCT FROM tt.game_table_id
          OR session_row.tournament_id IS DISTINCT FROM tt.tournament_id
          OR session_row.club_id IS DISTINCT FROM t.club_id
        ))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_existing_link_preflight_failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.tournaments t ON t.id = tt.tournament_id
    JOIN public.table_sessions session_row
      ON session_row.game_table_id = tt.table_id
     AND session_row.closed_at IS NULL
    WHERE t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND tt.status = 'active'
      AND tt.table_session_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_active_session_conflict';
  END IF;
END;
$$;

INSERT INTO public.table_sessions (
  club_id,
  game_table_id,
  session_type,
  tournament_id,
  control_mode,
  control_epoch,
  revision
)
SELECT
  t.club_id,
  gt.id,
  'tournament',
  tt.tournament_id,
  coalesce(tt.floor_control_mode, 'manual'),
  1,
  coalesce(tt.floor_control_revision, 0)
FROM public.tournament_tables tt
JOIN public.tournaments t ON t.id = tt.tournament_id
JOIN public.game_tables gt ON gt.id = tt.table_id AND gt.club_id = t.club_id
WHERE t.deleted_at IS NULL
  AND t.status NOT IN ('completed', 'cancelled')
  AND tt.status = 'active'
  AND tt.table_session_id IS NULL
ORDER BY gt.id, tt.id;

UPDATE public.tournament_tables tt
SET game_table_id = session_row.game_table_id,
    table_session_id = session_row.id
FROM public.tournaments t
JOIN public.table_sessions session_row
  ON session_row.tournament_id = t.id
 AND session_row.closed_at IS NULL
WHERE tt.tournament_id = t.id
  AND session_row.game_table_id = tt.table_id
  AND t.deleted_at IS NULL
  AND t.status NOT IN ('completed', 'cancelled')
  AND tt.status = 'active'
  AND (tt.game_table_id IS NULL OR tt.table_session_id IS NULL);

-- Current seats have an entry-backed active state and may use either legacy
-- identity during the transition.  A current seat without exactly one active
-- assignment, or without its matching seated entry, aborts before updates.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats seat_row
    JOIN public.tournaments t ON t.id = seat_row.tournament_id
    LEFT JOIN public.tournament_entries entry_row
      ON entry_row.id = seat_row.entry_id
     AND entry_row.tournament_id = seat_row.tournament_id
     AND entry_row.player_id = seat_row.player_id
     AND entry_row.entry_no = seat_row.entry_number
     AND entry_row.status = 'seated'
    WHERE seat_row.is_active = true
      AND seat_row.status = 'active'
      AND t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND entry_row.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_seat_entry_preflight_failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats seat_row
    JOIN public.tournaments t ON t.id = seat_row.tournament_id
    WHERE seat_row.is_active = true
      AND seat_row.status = 'active'
      AND t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND 1 <> (
        SELECT count(*)
        FROM public.tournament_tables tt
        WHERE tt.tournament_id = seat_row.tournament_id
          AND tt.status = 'active'
          AND seat_row.table_id IN (tt.id, tt.table_id)
          AND tt.game_table_id IS NOT NULL
          AND tt.table_session_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_seat_identity_preflight_failed';
  END IF;
END;
$$;

WITH seat_mapping AS (
  SELECT seat_row.id AS seat_id, tt.id AS tournament_table_id, tt.table_session_id
  FROM public.tournament_seats seat_row
  JOIN public.tournaments t ON t.id = seat_row.tournament_id
  JOIN public.tournament_tables tt
    ON tt.tournament_id = seat_row.tournament_id
   AND tt.status = 'active'
   AND seat_row.table_id IN (tt.id, tt.table_id)
  WHERE seat_row.is_active = true
    AND seat_row.status = 'active'
    AND t.deleted_at IS NULL
    AND t.status NOT IN ('completed', 'cancelled')
)
UPDATE public.tournament_seats seat_row
SET tournament_table_id = mapping.tournament_table_id,
    table_session_id = mapping.table_session_id
FROM seat_mapping mapping
WHERE seat_row.id = mapping.seat_id
  AND (
    seat_row.tournament_table_id IS DISTINCT FROM mapping.tournament_table_id
    OR seat_row.table_session_id IS DISTINCT FROM mapping.table_session_id
  );

-- In-progress hands are linked the same way.  Their status, locks, actions
-- and contents are intentionally not touched by the bridge.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands hand_row
    JOIN public.tournaments t ON t.id = hand_row.tournament_id
    WHERE hand_row.status = 'in_progress'
      AND coalesce(hand_row.is_voided, false) = false
      AND t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND 1 <> (
        SELECT count(*)
        FROM public.tournament_tables tt
        WHERE tt.tournament_id = hand_row.tournament_id
          AND tt.status = 'active'
          AND hand_row.table_id IN (tt.id, tt.table_id)
          AND tt.game_table_id IS NOT NULL
          AND tt.table_session_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_hand_identity_preflight_failed';
  END IF;
END;
$$;

WITH hand_mapping AS (
  SELECT hand_row.id AS hand_id, tt.id AS tournament_table_id, tt.table_session_id
  FROM public.tournament_hands hand_row
  JOIN public.tournaments t ON t.id = hand_row.tournament_id
  JOIN public.tournament_tables tt
    ON tt.tournament_id = hand_row.tournament_id
   AND tt.status = 'active'
   AND hand_row.table_id IN (tt.id, tt.table_id)
  WHERE hand_row.status = 'in_progress'
    AND coalesce(hand_row.is_voided, false) = false
    AND t.deleted_at IS NULL
    AND t.status NOT IN ('completed', 'cancelled')
)
UPDATE public.tournament_hands hand_row
SET tournament_table_id = mapping.tournament_table_id,
    table_session_id = mapping.table_session_id
FROM hand_mapping mapping
WHERE hand_row.id = mapping.hand_id
  AND (
    hand_row.tournament_table_id IS DISTINCT FROM mapping.tournament_table_id
    OR hand_row.table_session_id IS DISTINCT FROM mapping.table_session_id
  );

-- Dealer assignment remains associated with the exact physical table.  Only an
-- active assignment on a bridged, active tournament session receives the new
-- explicit session link; staff history and assignment status remain unchanged.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.dealer_assignments assignment_row
    JOIN public.table_sessions session_row
      ON session_row.game_table_id = assignment_row.table_id
     AND session_row.closed_at IS NULL
    JOIN public.tournament_tables tt ON tt.table_session_id = session_row.id
    JOIN public.tournaments t ON t.id = tt.tournament_id
    WHERE assignment_row.released_at IS NULL
      AND assignment_row.status IN ('assigned', 'on_break')
      AND t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND tt.status = 'active'
      AND assignment_row.club_id IS DISTINCT FROM session_row.club_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_dealer_scope_preflight_failed';
  END IF;
END;
$$;

WITH dealer_mapping AS (
  SELECT assignment_row.id AS dealer_assignment_id, session_row.id AS table_session_id
  FROM public.dealer_assignments assignment_row
  JOIN public.table_sessions session_row
    ON session_row.game_table_id = assignment_row.table_id
   AND session_row.closed_at IS NULL
  JOIN public.tournament_tables tt ON tt.table_session_id = session_row.id
  JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE assignment_row.released_at IS NULL
    AND assignment_row.status IN ('assigned', 'on_break')
    AND assignment_row.club_id = session_row.club_id
    AND t.deleted_at IS NULL
    AND t.status NOT IN ('completed', 'cancelled')
    AND tt.status = 'active'
)
UPDATE public.dealer_assignments assignment_row
SET table_session_id = mapping.table_session_id
FROM dealer_mapping mapping
WHERE assignment_row.id = mapping.dealer_assignment_id
  AND assignment_row.table_session_id IS DISTINCT FROM mapping.table_session_id;

-- The final contract may safely replace the legacy permanent physical-table
-- uniqueness only after this postcondition holds for operational rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.tournaments t ON t.id = tt.tournament_id
    LEFT JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
    WHERE t.deleted_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND tt.status = 'active'
      AND (
        tt.game_table_id IS NULL
        OR tt.table_session_id IS NULL
        OR session_row.closed_at IS NOT NULL
        OR session_row.game_table_id IS DISTINCT FROM tt.game_table_id
        OR session_row.game_table_id IS DISTINCT FROM tt.table_id
        OR session_row.tournament_id IS DISTINCT FROM tt.tournament_id
        OR session_row.club_id IS DISTINCT FROM t.club_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_table_v3_final_live_bridge_postcondition_failed';
  END IF;
END;
$$;

COMMIT;
