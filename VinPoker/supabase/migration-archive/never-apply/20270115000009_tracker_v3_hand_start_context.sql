-- V3 Hand Input reads the active table lease and starts a hand against that
-- exact lease. Historical tables still use the unchanged legacy start_hand.
-- No business rows are rewritten. ROLLBACK: keep floorDeferredTrackerMoveV1
-- OFF and restore these RPCs with a reviewed forward migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_tracker_hand_input_tables_v3(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_result jsonb;
BEGIN
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF v_actor IS NULL OR v_club_id IS NULL OR NOT public.is_club_tracker(v_actor, v_club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table_id', gt.id,
      'tournament_table_id', tt.id,
      'table_session_id', session_row.id,
      'control_epoch', session_row.control_epoch,
      'control_mode', COALESCE(session_row.control_mode, tt.floor_control_mode),
      'table_name', gt.table_name,
      'max_seats', tt.max_seats,
      'player_count', (SELECT count(*) FROM public.tournament_seats seat_row
        WHERE seat_row.tournament_id = p_tournament_id AND seat_row.is_active
          AND ((session_row.id IS NOT NULL AND seat_row.table_session_id = session_row.id
                AND seat_row.tournament_table_id = tt.id)
               OR (session_row.id IS NULL AND seat_row.table_id = tt.id))),
      'has_live_hand', EXISTS (SELECT 1 FROM public.tournament_hands hand_row
        WHERE hand_row.tournament_id = p_tournament_id AND hand_row.status = 'in_progress'
          AND COALESCE(hand_row.is_voided, false) = false
          AND ((session_row.id IS NOT NULL AND hand_row.table_session_id = session_row.id
                AND hand_row.tournament_table_id = tt.id)
               OR (session_row.id IS NULL AND hand_row.table_id IN (tt.id, gt.id))))
    ) ORDER BY gt.table_name, tt.id
  ), '[]'::jsonb) INTO v_result
  FROM public.tournament_tables tt
  JOIN public.game_tables gt ON gt.id = COALESCE(tt.game_table_id, tt.table_id)
  LEFT JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
  WHERE tt.tournament_id = p_tournament_id AND tt.status = 'active'
    AND (tt.table_session_id IS NULL OR session_row.closed_at IS NULL);
  RETURN pg_catalog.jsonb_build_object('ok', true, 'tables', v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_tracker_hand_v3(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_table_session_id uuid,
  p_control_epoch bigint,
  p_hand_number integer,
  p_hand_time timestamptz,
  p_created_by uuid,
  p_button_seat integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_table public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
  v_game_table_id uuid;
  v_hand_id uuid;
  v_bad_seat integer;
BEGIN
  IF v_actor IS NULL OR (p_created_by IS NOT NULL AND p_created_by <> v_actor) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'actor_mismatch');
  END IF;
  IF p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_table_session_id IS NULL
     OR p_control_epoch IS NULL OR p_hand_number IS NULL OR p_hand_number < 1
     OR p_button_seat IS NULL OR p_button_seat NOT BETWEEN 1 AND 9 THEN
    RETURN pg_catalog.jsonb_build_object('error', 'invalid_hand_context');
  END IF;

  SELECT t.club_id INTO v_club_id FROM public.tournaments t
  WHERE t.id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR public.is_club_tracker(v_actor, v_club_id) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('error', 'actor_not_allowed');
  END IF;
  SELECT tt.game_table_id INTO v_game_table_id FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id AND tt.tournament_id = p_tournament_id;
  IF v_game_table_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_not_found');
  END IF;
  PERFORM 1 FROM public.game_tables gt WHERE gt.id = v_game_table_id
    AND gt.club_id = v_club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_scope_mismatch');
  END IF;
  SELECT * INTO v_session FROM public.table_sessions session_row
  WHERE session_row.id = p_table_session_id FOR UPDATE;
  SELECT * INTO v_table FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id AND tt.tournament_id = p_tournament_id FOR UPDATE;
  IF v_table.table_session_id IS DISTINCT FROM v_session.id
     OR v_table.game_table_id IS DISTINCT FROM v_game_table_id
     OR v_table.status IS DISTINCT FROM 'active'
     OR v_session.closed_at IS NOT NULL
     OR v_session.club_id IS DISTINCT FROM v_club_id
     OR v_session.tournament_id IS DISTINCT FROM p_tournament_id
     OR v_session.game_table_id IS DISTINCT FROM v_game_table_id
     OR v_session.control_mode IS DISTINCT FROM 'tracker'
     OR v_session.control_epoch IS DISTINCT FROM p_control_epoch THEN
    RETURN pg_catalog.jsonb_build_object('error', 'STALE_TRACKER_CONTEXT');
  END IF;
  IF p_button_seat > v_table.max_seats THEN
    RETURN pg_catalog.jsonb_build_object('error', 'invalid_button_seat');
  END IF;
  -- Coordinate with the legacy writer on the same assignment during cutover.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_tournament_id::text), pg_catalog.hashtext(v_table.id::text));
  IF EXISTS (SELECT 1 FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id AND h.status = 'in_progress'
      AND COALESCE(h.is_voided, false) = false
      AND (h.table_session_id = v_session.id OR h.tournament_table_id = v_table.id
           OR h.table_id IN (v_table.id, v_game_table_id))) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_has_active_hand');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id AND s.tournament_table_id = v_table.id
      AND s.table_session_id = v_session.id AND s.is_active) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_has_no_players');
  END IF;
  SELECT s.seat_number INTO v_bad_seat FROM public.tournament_seats s
  LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id = s.tournament_id
    AND cc.player_id = s.player_id AND cc.entry_number = s.entry_number
  WHERE s.tournament_id = p_tournament_id AND s.tournament_table_id = v_table.id
    AND s.table_session_id = v_session.id AND s.is_active
    AND (s.entry_id IS NULL OR COALESCE(cc.chip_count, s.chip_count, 0) <= 0)
  LIMIT 1;
  IF v_bad_seat IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('error', 'invalid_seat_stack', 'seat_number', v_bad_seat);
  END IF;

  INSERT INTO public.tournament_hands (
    tournament_id, table_id, tournament_table_id, table_session_id,
    hand_number, hand_time, community_cards, pot_size, side_pots,
    status, created_by, locked_by_user_id, locked_at, button_seat
  ) VALUES (
    p_tournament_id, v_game_table_id, v_table.id, v_session.id,
    p_hand_number, COALESCE(p_hand_time, pg_catalog.now()), '[]'::jsonb,
    0, '[]'::jsonb, 'in_progress', v_actor, v_actor, pg_catalog.now(), p_button_seat
  ) RETURNING id INTO v_hand_id;
  INSERT INTO public.hand_players (
    hand_id, tournament_id, player_id, entry_number, seat_number,
    starting_stack, ending_stack, is_eliminated, side_pots, hole_cards,
    player_name, avatar_url
  )
  SELECT v_hand_id, p_tournament_id, s.player_id, s.entry_number, s.seat_number,
    COALESCE(cc.chip_count, s.chip_count, 0), NULL, false, '[]'::jsonb, '[]'::jsonb,
    s.player_name, s.avatar_url
  FROM public.tournament_seats s
  LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id = s.tournament_id
    AND cc.player_id = s.player_id AND cc.entry_number = s.entry_number
  WHERE s.tournament_id = p_tournament_id AND s.tournament_table_id = v_table.id
    AND s.table_session_id = v_session.id AND s.is_active;
  RETURN pg_catalog.jsonb_build_object('status', 'success', 'hand_id', v_hand_id,
    'button_seat', p_button_seat);
EXCEPTION WHEN unique_violation THEN
  RETURN pg_catalog.jsonb_build_object('error', 'table_has_active_hand');
END;
$$;

REVOKE ALL ON FUNCTION public.get_tracker_hand_input_tables_v3(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_hand_input_tables_v3(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)
  TO authenticated;
COMMIT;
