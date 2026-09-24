-- Floor Free Sit V1 (source-only; owner-gated production apply).
--
-- Business invariant:
--   * the player remains in the tournament;
--   * the current stack is preserved exactly;
--   * the active seat is released;
--   * the entry returns to the existing `registered` waiting state so the
--     canonical Floor seat-assignment flow can place it again later;
--   * no payout, registration, revenue, or players_remaining value changes.
--
-- Rollback (owner-gated):
--   REVOKE ALL ON FUNCTION public.floor_free_sit_player_v1(uuid, bigint, bigint, integer, uuid, text)
--     FROM PUBLIC, anon, authenticated, service_role;
--   DROP FUNCTION public.floor_free_sit_player_v1(uuid, bigint, bigint, integer, uuid, text);

BEGIN;

CREATE OR REPLACE FUNCTION public.floor_free_sit_player_v1(
  p_entry_id uuid,
  p_expected_revision bigint,
  p_expected_control_epoch bigint,
  p_expected_chip_count integer,
  p_request_id uuid,
  p_reason text DEFAULT 'floor_free_sit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_seat public.tournament_seats%ROWTYPE;
  v_tournament_table public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
  v_game_table_id uuid;
  v_tracker_chip_count integer;
  v_next_revision bigint;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_entry_id IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_control_epoch IS NULL
     OR p_expected_chip_count IS NULL
     OR p_expected_chip_count < 0
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT entry_row.tournament_id
  INTO v_tournament_id
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'entry_id', p_entry_id,
    'expected_revision', p_expected_revision,
    'expected_control_epoch', p_expected_control_epoch,
    'expected_chip_count', p_expected_chip_count,
    'reason', COALESCE(p_reason, '')
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(
    v_actor, 'floor_free_sit_player_v1', p_request_id
  );
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_free_sit_player_v1', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = v_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Discover the immutable V3 placement, then lock in the same global order as
  -- the other Floor V3 writers: physical table -> session -> assignment -> entry -> seat.
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id;
  IF NOT FOUND OR v_entry.status <> 'seated' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_seated');
  END IF;

  SELECT * INTO v_seat
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.entry_id = v_entry.id
    AND seat_row.is_active
    AND seat_row.tournament_table_id IS NOT NULL
    AND seat_row.table_session_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_seat');
  END IF;

  SELECT table_row.game_table_id
  INTO v_game_table_id
  FROM public.tournament_tables table_row
  WHERE table_row.id = v_seat.tournament_table_id
    AND table_row.tournament_id = v_tournament.id;
  PERFORM 1
  FROM public.game_tables game_table_row
  WHERE game_table_row.id = v_game_table_id
    AND game_table_row.club_id = v_tournament.club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;

  SELECT * INTO v_session
  FROM public.table_sessions session_row
  WHERE session_row.id = v_seat.table_session_id
    AND session_row.closed_at IS NULL
  FOR UPDATE;
  SELECT * INTO v_tournament_table
  FROM public.tournament_tables table_row
  WHERE table_row.id = v_seat.tournament_table_id
    AND table_row.table_session_id = v_session.id
    AND table_row.status = 'active'
  FOR UPDATE;
  IF v_session.id IS NULL
     OR v_tournament_table.id IS NULL
     OR v_session.tournament_id IS DISTINCT FROM v_tournament.id
     OR v_session.game_table_id IS DISTINCT FROM v_game_table_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;

  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id
  FOR UPDATE;
  IF NOT FOUND OR v_entry.status <> 'seated' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_seated');
  END IF;
  -- The existing waiting/seat-assignment contract accepts confirmed
  -- registrations only.  Fail closed instead of releasing a manual orphan
  -- that the current queue could not place again.
  IF v_entry.registration_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_free_sittable');
  END IF;
  SELECT * INTO v_seat
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.entry_id = v_entry.id
    AND seat_row.is_active
    AND seat_row.tournament_table_id = v_tournament_table.id
    AND seat_row.table_session_id = v_session.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_seat');
  END IF;

  IF v_seat.chip_count IS DISTINCT FROM p_expected_chip_count THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'STALE_STATE',
      'current_chip_count', v_seat.chip_count
    );
  END IF;
  IF v_session.revision <> p_expected_revision
     OR v_session.control_epoch <> p_expected_control_epoch THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'STALE_STATE',
      'current_revision', v_session.revision,
      'current_control_epoch', v_session.control_epoch
    );
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(
    v_tournament.id, v_tournament_table.id, v_session.id
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'player_in_active_hand');
  END IF;

  IF v_session.control_mode = 'tracker' THEN
    SELECT chip_row.chip_count
    INTO v_tracker_chip_count
    FROM public.tournament_chip_counts chip_row
    WHERE chip_row.tournament_id = v_tournament.id
      AND chip_row.player_id = v_entry.player_id
      AND chip_row.entry_number = v_entry.entry_no
    FOR UPDATE;
    IF NOT FOUND OR v_tracker_chip_count IS DISTINCT FROM v_seat.chip_count THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tracker_chip_state_mismatch');
    END IF;
  END IF;

  UPDATE public.table_sessions
  SET revision = revision + 1
  WHERE id = v_session.id
    AND revision = p_expected_revision
  RETURNING revision INTO v_next_revision;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
  END IF;

  UPDATE public.tournament_seats
  SET is_active = false,
      status = 'free_sit'
  WHERE id = v_seat.id
    AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE';
  END IF;

  UPDATE public.tournament_entries
  SET status = 'registered',
      current_stack = v_seat.chip_count,
      table_id = NULL,
      seat_id = NULL,
      seat_number = NULL,
      updated_at = pg_catalog.now()
  WHERE id = v_entry.id
    AND status = 'seated';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entry_state_changed';
  END IF;

  -- The former seat receipt must not continue to represent a valid placement.
  UPDATE public.seat_draw_receipts
  SET status = 'superseded',
      cancelled_at = COALESCE(cancelled_at, pg_catalog.now())
  WHERE entry_id = v_entry.id
    AND status IN ('issued', 'printed');

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'entry_id', v_entry.id,
    'seat_id', v_seat.id,
    'table_session_id', v_session.id,
    'stack_preserved', v_seat.chip_count,
    'waiting_status', 'registered',
    'revision', v_next_revision,
    'players_remaining_unchanged', true,
    'payout_applied', false
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_free_sit_player_v1', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.floor_free_sit_player_v1(uuid, bigint, bigint, integer, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.floor_free_sit_player_v1(uuid, bigint, bigint, integer, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_free_sit_player_v1(uuid, bigint, bigint, integer, uuid, text)
  TO authenticated;

COMMIT;
