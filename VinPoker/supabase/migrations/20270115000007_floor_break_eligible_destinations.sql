-- Floor V3 break repair: one destination hand no longer blocks all other tables.
-- Source-only. Rollback: restore floor_break_table_v3 from migration 20270113000011.
-- The source hand remains protected; destination hands are not interrupted.
-- Only eligible hand-free destination tables contribute to capacity and seats.

-- The queue is introduced by 00008. Before it exists there cannot be a
-- pending reservation; 00008 replaces this private view with the real queue.
CREATE OR REPLACE VIEW floor_private.floor_break_pending_reservations_v1 AS
SELECT NULL::uuid AS table_session_id, NULL::integer AS seat_number
WHERE false;
REVOKE ALL ON floor_private.floor_break_pending_reservations_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION floor_private.floor_break_eligible_seats_v1(
  p_tournament_id uuid, p_source_table_id uuid
)
RETURNS TABLE (
  tournament_table_id uuid, table_session_id uuid,
  seat_number integer, table_number integer, occupied_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT target.id, target_session.id, candidate.seat_number,
         target.table_number,
         (SELECT pg_catalog.count(*)
          FROM public.tournament_seats occupied_count
          WHERE occupied_count.tournament_table_id = target.id
            AND occupied_count.table_session_id = target_session.id
            AND occupied_count.is_active)
  FROM public.tournament_tables target
  JOIN public.table_sessions target_session ON target_session.id = target.table_session_id
  CROSS JOIN LATERAL pg_catalog.generate_series(1, target.max_seats) candidate(seat_number)
  WHERE target.tournament_id = p_tournament_id
    AND target.status = 'active'
    AND target.id <> p_source_table_id
    AND target.max_seats IN (8, 9)
    AND target_session.closed_at IS NULL
    AND NOT floor_private.floor_table_v3_has_active_hand(
      p_tournament_id, target.id, target_session.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_seats occupied_seat
      WHERE occupied_seat.tournament_table_id = target.id
        AND occupied_seat.table_session_id = target_session.id
        AND occupied_seat.seat_number = candidate.seat_number
        AND occupied_seat.is_active
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.table_session_seat_locks locked_seat
      WHERE locked_seat.table_session_id = target_session.id
        AND locked_seat.seat_number = candidate.seat_number
        AND locked_seat.unlocked_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM floor_private.floor_break_pending_reservations_v1 pending
      WHERE pending.table_session_id = target_session.id
        AND pending.seat_number = candidate.seat_number
    );
$$;
REVOKE ALL ON FUNCTION floor_private.floor_break_eligible_seats_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.floor_break_table_v3(
  p_tournament_table_id uuid,
  p_expected_revision bigint,
  p_request_id uuid,
  p_draw_mode text DEFAULT 'fill_lowest_table'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_game_table_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_source_table public.tournament_tables%ROWTYPE;
  v_source_session public.table_sessions%ROWTYPE;
  v_game_table_ids uuid[];
  v_session_ids uuid[];
  v_need integer := 0;
  v_capacity integer := 0;
  v_moved integer := 0;
  v_released_dealers integer := 0;
  v_source_seat public.tournament_seats%ROWTYPE;
  v_destination_table_id uuid;
  v_destination_session_id uuid;
  v_destination_seat_number integer;
  v_next_revision bigint;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_tournament_table_id IS NULL
     OR p_expected_revision IS NULL
     OR p_request_id IS NULL
     OR p_draw_mode NOT IN ('fill_lowest_table', 'redraw_balanced') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT tt.tournament_id, tt.game_table_id
  INTO v_tournament_id, v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_table_id', p_tournament_table_id,
    'expected_revision', p_expected_revision,
    'draw_mode', p_draw_mode
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_break_table_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'floor_break_table_v3', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Establish one canonical lock order for every active V3 table in the
  -- tournament before capacity calculation or any seat change.
  SELECT
    pg_catalog.array_agg(tt.game_table_id ORDER BY tt.game_table_id),
    pg_catalog.array_agg(tt.table_session_id ORDER BY tt.table_session_id)
  INTO v_game_table_ids, v_session_ids
  FROM public.tournament_tables tt
  JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
  WHERE tt.tournament_id = v_tournament.id
    AND tt.status = 'active'
    AND tt.game_table_id IS NOT NULL
    AND tt.table_session_id IS NOT NULL
    AND session_row.closed_at IS NULL;
  IF v_game_table_ids IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_tables');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = ANY(v_game_table_ids)
    AND gt.club_id = v_tournament.club_id
  ORDER BY gt.id FOR UPDATE;
  -- Sessions are locked in their physical-table order, matching move/bust/
  -- restore.  Session UUID order alone could invert two multi-table actions.
  PERFORM 1
  FROM public.table_sessions session_row
  JOIN public.game_tables gt ON gt.id = session_row.game_table_id
  WHERE session_row.id = ANY(v_session_ids)
  ORDER BY gt.id, session_row.id
  FOR UPDATE;

  SELECT * INTO v_source_table
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tournament.id
    AND tt.status = 'active'
  FOR UPDATE;
  SELECT * INTO v_source_session
  FROM public.table_sessions session_row
  WHERE session_row.id = v_source_table.table_session_id
    AND session_row.closed_at IS NULL
  FOR UPDATE;
  IF v_source_table.id IS NULL
     OR v_source_session.id IS NULL
     OR v_source_session.game_table_id IS DISTINCT FROM v_source_table.game_table_id
     OR v_source_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  IF v_source_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE', 'current_revision', v_source_session.revision);
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_source_table.id, v_source_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_need
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.tournament_table_id = v_source_table.id
    AND seat_row.table_session_id = v_source_session.id
    AND seat_row.is_active;
  SELECT pg_catalog.count(*)::integer INTO v_capacity
  FROM floor_private.floor_break_eligible_seats_v1(v_tournament.id, v_source_table.id);
  IF v_capacity < v_need THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'insufficient_capacity', 'need', v_need, 'have', v_capacity
    );
  END IF;

  FOR v_source_seat IN
    SELECT *
    FROM public.tournament_seats seat_row
    WHERE seat_row.tournament_table_id = v_source_table.id
      AND seat_row.table_session_id = v_source_session.id
      AND seat_row.is_active
    ORDER BY seat_row.seat_number, seat_row.id
    FOR UPDATE
  LOOP
    SELECT eligible.tournament_table_id, eligible.table_session_id, eligible.seat_number
    INTO v_destination_table_id, v_destination_session_id, v_destination_seat_number
    FROM floor_private.floor_break_eligible_seats_v1(v_tournament.id, v_source_table.id) eligible
    ORDER BY
      CASE WHEN p_draw_mode = 'fill_lowest_table' THEN eligible.table_number END ASC NULLS LAST,
      eligible.occupied_count ASC,
      CASE WHEN p_draw_mode = 'redraw_balanced' THEN pg_catalog.random() END,
      eligible.tournament_table_id,
      eligible.seat_number
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'break_capacity_changed';
    END IF;

    UPDATE public.tournament_seats
    SET is_active = false,
        status = 'moved'
    WHERE id = v_source_seat.id
      AND is_active;
    INSERT INTO public.tournament_seats (
      tournament_id,
      player_id,
      entry_number,
      tournament_table_id,
      table_session_id,
      seat_number,
      chip_count,
      is_active,
      entry_id,
      status,
      assigned_by,
      assigned_at
    ) VALUES (
      v_tournament.id,
      v_source_seat.player_id,
      v_source_seat.entry_number,
      v_destination_table_id,
      v_destination_session_id,
      v_destination_seat_number,
      v_source_seat.chip_count,
      true,
      v_source_seat.entry_id,
      'active',
      v_actor,
      pg_catalog.now()
    );
    UPDATE public.table_sessions
    SET revision = revision + 1
    WHERE id = v_destination_session_id
      AND closed_at IS NULL;
    v_moved := v_moved + 1;
  END LOOP;

  UPDATE public.dealer_assignments
  SET released_at = COALESCE(released_at, pg_catalog.now()),
      status = CASE WHEN status IN ('assigned', 'on_break') THEN 'completed' ELSE status END
  WHERE table_session_id = v_source_session.id
    AND released_at IS NULL;
  GET DIAGNOSTICS v_released_dealers = ROW_COUNT;
  UPDATE public.tournament_tables SET status = 'closed'
  WHERE id = v_source_table.id AND status = 'active';
  UPDATE public.table_sessions
  SET closed_at = pg_catalog.now(),
      closed_by = v_actor,
      revision = revision + 1
  WHERE id = v_source_session.id
    AND revision = p_expected_revision
    AND closed_at IS NULL
  RETURNING revision INTO v_next_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE';
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'closed', true,
    'tournament_table_id', v_source_table.id,
    'table_session_id', v_source_session.id,
    'moved_count', v_moved,
    'dealer_assignments_released', v_released_dealers,
    'revision', v_next_revision
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_break_table_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) TO authenticated;
