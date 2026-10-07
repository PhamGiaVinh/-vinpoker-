-- OWNER-GATED, one-time TEST fixture repair. Do not put this in migrations.
-- Exact Felt UAT tournament and two owner-identified legacy seats only.
-- Preflight: fresh recovery point, no concurrent hand/move, verify all IDs and
-- the latest completed hand evidence. No registration/payment/prize mutation.
-- If any assertion fails, the entire transaction rolls back. After COMMIT,
-- do not blindly reverse it: later hands may have consumed these entry IDs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_tournament constant uuid := '5a51bec5-4da0-4dd9-861a-cc4e7678478c';
  v_club constant uuid := '22222222-2222-2222-2222-222222222222';
  v_game_table constant uuid := '02dfcebd-1277-483e-ba77-a7afba22633c';
  v_row record;
  v_seat public.tournament_seats%ROWTYPE;
  v_tracker_chips integer;
  v_last_stack integer;
  v_entry_id uuid;
  v_total_before bigint;
  v_total_after bigint;
BEGIN
  PERFORM 1 FROM public.tournaments
  WHERE id = v_tournament AND club_id = v_club
    AND status = 'live' AND registration_closed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FELT_FIXTURE_CHANGED: tournament'; END IF;

  -- A hard stop on any active hand or pending move: this is an identity repair,
  -- not a concurrent Tracker mutation.
  IF EXISTS (
    SELECT 1 FROM public.tournament_hands h
    WHERE h.tournament_id = v_tournament AND h.status = 'in_progress'
      AND COALESCE(h.is_voided, false) = false
  ) OR EXISTS (
    SELECT 1 FROM public.floor_pending_tracker_moves m
    WHERE m.tournament_id = v_tournament AND m.status = 'pending'
  ) THEN RAISE EXCEPTION 'FELT_FIXTURE_BUSY'; END IF;

  SELECT COALESCE(SUM(chip_count), 0) INTO v_total_before
  FROM public.tournament_seats WHERE tournament_id = v_tournament AND is_active;

  FOR v_row IN
    SELECT * FROM (VALUES
      ('5f6f3bde-f407-4a7f-8a74-33d34447f743'::uuid,
       'f28c84d2-fdaa-4c5b-b8b7-033000ea55b3'::uuid, 3, 15000, 5000),
      ('e219c241-704d-4eb0-9a8b-d69a3b2df97a'::uuid,
       '834a7c4e-4e5d-4f92-9ff2-407fd36e10ae'::uuid, 2, 10000, 20000)
    ) AS expected(seat_id, player_id, seat_number, old_chips, hand_chips)
    ORDER BY seat_id
  LOOP
    SELECT * INTO v_seat FROM public.tournament_seats
    WHERE id = v_row.seat_id AND tournament_id = v_tournament
      AND player_id = v_row.player_id AND entry_number = 1
      AND seat_number = v_row.seat_number AND chip_count = v_row.old_chips
      AND entry_id IS NULL AND is_active
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FELT_FIXTURE_CHANGED: seat %', v_row.seat_id; END IF;

    PERFORM 1 FROM public.tournament_tables tt
    JOIN public.table_sessions s ON s.id = tt.table_session_id
    WHERE tt.id = v_seat.tournament_table_id
      AND tt.game_table_id = v_game_table
      AND tt.tournament_id = v_tournament
      AND tt.status = 'active'
      AND s.id = v_seat.table_session_id
      AND s.closed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'FELT_FIXTURE_CHANGED: table %', v_row.seat_id; END IF;

    IF EXISTS (
      SELECT 1 FROM public.tournament_entries e
      WHERE e.tournament_id = v_tournament AND e.player_id = v_row.player_id
        AND e.entry_no = 1
    ) THEN RAISE EXCEPTION 'FELT_FIXTURE_CHANGED: entry already exists %', v_row.seat_id; END IF;

    SELECT c.chip_count INTO v_tracker_chips
    FROM public.tournament_chip_counts c
    WHERE c.tournament_id = v_tournament
      AND c.player_id = v_row.player_id AND c.entry_number = 1
    FOR UPDATE;
    SELECT hp.ending_stack INTO v_last_stack
    FROM public.hand_players hp
    JOIN public.tournament_hands h ON h.id = hp.hand_id
    WHERE h.tournament_id = v_tournament AND h.status = 'completed'
      AND hp.player_id = v_row.player_id AND hp.entry_number = 1
    ORDER BY h.hand_number DESC, h.created_at DESC LIMIT 1;
    IF v_tracker_chips IS DISTINCT FROM v_row.hand_chips
       OR v_last_stack IS DISTINCT FROM v_row.hand_chips THEN
      RAISE EXCEPTION 'FELT_FIXTURE_CHANGED: chip history %', v_row.seat_id;
    END IF;

    INSERT INTO public.tournament_entries (
      tournament_id, player_id, entry_no, source, status,
      current_stack, table_id, seat_id, seat_number, checked_in_at, seated_at
    ) VALUES (
      v_tournament, v_row.player_id, 1, 'manual', 'seated',
      v_row.hand_chips, v_game_table, v_row.seat_id, v_row.seat_number,
      now(), now()
    ) RETURNING id INTO v_entry_id;

    UPDATE public.tournament_seats
    SET entry_id = v_entry_id, chip_count = v_row.hand_chips
    WHERE id = v_row.seat_id AND entry_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'FELT_FIXTURE_CHANGED: seat update %', v_row.seat_id; END IF;

    INSERT INTO public.audit_logs (
      club_id, actor_id, action, entity_type, entity_id, payload
    ) VALUES (
      v_club, auth.uid(), 'felt_uat_legacy_entry_link', 'tournament_seat',
      v_row.seat_id,
      jsonb_build_object(
        'tournament_id', v_tournament, 'player_id', v_row.player_id,
        'entry_number', 1, 'entry_id', v_entry_id,
        'old_seat_chips', v_row.old_chips, 'canonical_hand_chips', v_row.hand_chips,
        'reason', 'owner_confirmed_test_fixture'
      )
    );
  END LOOP;

  SELECT COALESCE(SUM(chip_count), 0) INTO v_total_after
  FROM public.tournament_seats WHERE tournament_id = v_tournament AND is_active;
  IF v_total_after <> v_total_before THEN
    RAISE EXCEPTION 'FELT_FIXTURE_CHIP_CONSERVATION_FAILED: % -> %',
      v_total_before, v_total_after;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats seat
    LEFT JOIN public.tournament_entries entry_row ON entry_row.id = seat.entry_id
    WHERE seat.id IN (
      '5f6f3bde-f407-4a7f-8a74-33d34447f743'::uuid,
      'e219c241-704d-4eb0-9a8b-d69a3b2df97a'::uuid
    )
      AND (entry_row.id IS NULL OR entry_row.tournament_id <> seat.tournament_id
        OR entry_row.player_id <> seat.player_id
        OR entry_row.entry_no <> seat.entry_number
        OR entry_row.current_stack <> seat.chip_count)
  ) THEN RAISE EXCEPTION 'FELT_FIXTURE_POSTCHECK_FAILED'; END IF;
END;
$$;
COMMIT;

-- Read-only postcheck after an approved apply:
-- SELECT s.id, s.entry_id, s.chip_count, e.current_stack, c.chip_count
-- FROM public.tournament_seats s
-- JOIN public.tournament_entries e ON e.id = s.entry_id
-- JOIN public.tournament_chip_counts c
--   ON c.tournament_id = s.tournament_id AND c.player_id = s.player_id
--   AND c.entry_number = s.entry_number
-- WHERE s.id IN ('5f6f3bde-f407-4a7f-8a74-33d34447f743',
--                'e219c241-704d-4eb0-9a8b-d69a3b2df97a');
