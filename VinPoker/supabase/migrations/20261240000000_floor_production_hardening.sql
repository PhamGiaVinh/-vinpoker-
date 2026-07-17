-- ============================================================================
-- Floor production hardening (forward-only, owner-gated controlled apply)
-- ============================================================================
-- Correctness invariants:
--   * every active seat must match exactly one seated tournament_entries row;
--   * missing/orphan/mismatched identity fails closed before any write;
--   * chips and player identity are copied from locked server rows, never client input;
--   * close tournament is idempotent and refuses active players;
--   * restore refuses completed/closed/paid tournaments and never rewrites payout;
--   * Floor membership is authorized with is_club_floor(auth.uid(), club_id).
--
-- This file is SOURCE-ONLY until the owner uses CONTROLLED_DB_APPLY.md with the
-- exact migration gate. Do not use db push and do not edit schema_migrations.
--
-- ROLLBACK: re-apply the immediately previous function definitions from:
--   20260913000000_floor_assign_player_to_seat.sql
--   20260818000000_move_player_seat_guard_v2.sql
--   20261237000000_restore_busted_player_to_seat.sql
--   20261213000000_close_tournament.sql
--   20260914000000_close_tournament_table.sql
--   20260918000000_redraw_tournament.sql
--   20261207000000_fix_open_tournament_table_release_before_reuse.sql
-- No data/table rollback is required; this migration only replaces function bodies.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.floor_assign_player_to_seat(
  p_tournament_id UUID,
  p_player_name TEXT,
  p_tournament_table_id UUID,
  p_seat_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_authorized BOOLEAN;
  v_tour RECORD;
  v_tt RECORD;
  v_name TEXT := NULLIF(TRIM(p_player_name), '');
  v_player_id UUID := gen_random_uuid();
  v_starting_stack INTEGER;
  v_seat_id UUID;
  v_entry_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_player_name');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  IF p_seat_number IS NULL OR p_seat_number < 1 OR p_seat_number > v_tt.max_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_seat_number', 'max_seats', v_tt.max_seats);
  END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, status, assigned_by, assigned_at
    ) VALUES (
      p_tournament_id, v_player_id, 1, v_tt.id, p_seat_number,
      v_starting_stack, true, v_name, 'active', v_actor, now()
    ) RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, NULL, v_player_id, 1, 'manual',
    'seated', v_starting_stack, v_tt.table_id, v_seat_id, p_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats
  SET entry_id = v_entry_id
  WHERE id = v_seat_id;

  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format(
      'T%s-S%s-%s',
      COALESCE(v_tt.table_number::text, '?'),
      p_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        p_tournament_id, NULL, v_entry_id, v_player_id, v_name,
        v_tt.table_id, v_tt.table_number, v_seat_id, p_seat_number, v_receipt_code,
        jsonb_build_object(
          'v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', v_player_id,
          'table_number', v_tt.table_number, 'seat_number', p_seat_number,
          'source', 'floor'
        ),
        'initial', 'issued', v_actor
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    p_tournament_id, v_entry_id, v_player_id,
    v_tt.table_id, v_tt.table_number, p_seat_number,
    'floor_seat_add', 'initial', v_actor,
    jsonb_build_object('source', 'floor', 'money', false, 'tournament_table_id', v_tt.id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'seat_id', v_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code,
    'table_id', v_tt.table_id,
    'table_number', v_tt.table_number,
    'seat_number', p_seat_number,
    'display_name', v_name,
    'starting_stack', v_starting_stack
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_assign_player_to_seat(UUID, TEXT, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_assign_player_to_seat(UUID, TEXT, UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_player_seat(
  p_entry_id UUID,
  p_to_tournament_table_id UUID,
  p_to_seat_number INTEGER,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'manual_move'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_entry RECORD;
  v_from_seat RECORD;
  v_from_tt RECORD;
  v_to_tt RECORD;
  v_new_seat_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_authorized BOOLEAN;
  v_attempt INTEGER := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  -- Actor identity is derived from auth.uid(); this legacy argument is only an
  -- optional spoof check for older callers and is not used as the actor.
  IF p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT * INTO v_entry
  FROM public.tournament_entries
  WHERE id = p_entry_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  IF v_entry.status <> 'seated' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_seated', 'status', v_entry.status);
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      JOIN public.clubs c ON c.id = t.club_id
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE t.id = v_entry.tournament_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = v_entry.tournament_id
        AND public.is_club_floor(v_actor, t.club_id)
    )
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Exact entry linkage only. Legacy player-id fallback could move the wrong entry.
  SELECT * INTO v_from_seat
  FROM public.tournament_seats
  WHERE entry_id = p_entry_id
    AND tournament_id = v_entry.tournament_id
    AND player_id = v_entry.player_id
    AND entry_number = v_entry.entry_no
    AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.tournament_seats
      WHERE tournament_id = v_entry.tournament_id
        AND player_id = v_entry.player_id
        AND is_active = true
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'no_active_seat');
  END IF;

  SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_from_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = v_entry.tournament_id
    AND v_from_seat.table_id IN (tt.id, tt.table_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

  SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
  INTO v_to_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_to_tournament_table_id
    AND tt.tournament_id = v_entry.tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  IF p_to_seat_number IS NULL OR p_to_seat_number < 1 OR p_to_seat_number > v_to_tt.max_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_seat_number', 'max_seats', v_to_tt.max_seats);
  END IF;

  IF v_from_seat.table_id = p_to_tournament_table_id
     AND v_from_seat.seat_number = p_to_seat_number THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_there', true,
      'entry_id', p_entry_id,
      'player_name', v_from_seat.player_name,
      'to_table_number', v_to_tt.table_number,
      'to_seat_number', p_to_seat_number
    );
  END IF;

  BEGIN
    UPDATE public.tournament_seats
    SET status = 'moved', is_active = false
    WHERE id = v_from_seat.id;

    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, entry_id, status,
      assigned_by, assigned_at
    ) VALUES (
      v_entry.tournament_id, v_entry.player_id, v_entry.entry_no,
      v_to_tt.id, p_to_seat_number,
      v_from_seat.chip_count, true, v_from_seat.player_name, p_entry_id,
      'active', v_actor, now()
    ) RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  UPDATE public.tournament_entries
  SET table_id = v_to_tt.table_id,
      seat_number = p_to_seat_number,
      seat_id = v_new_seat_id,
      current_stack = v_from_seat.chip_count,
      updated_at = now()
  WHERE id = p_entry_id;

  UPDATE public.seat_draw_receipts
  SET status = 'superseded', cancelled_at = now()
  WHERE entry_id = p_entry_id
    AND status IN ('issued', 'printed');

  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format(
      'T%s-S%s-%s',
      COALESCE(v_to_tt.table_number::text, '?'),
      p_to_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        v_entry.tournament_id, v_entry.registration_id, p_entry_id,
        v_entry.player_id, v_from_seat.player_name,
        v_to_tt.table_id, v_to_tt.table_number, v_new_seat_id,
        p_to_seat_number, v_receipt_code,
        jsonb_build_object(
          'v', 1, 'receipt_code', v_receipt_code, 'entry_id', p_entry_id,
          'tournament_id', v_entry.tournament_id, 'player_id', v_entry.player_id,
          'table_number', v_to_tt.table_number, 'seat_number', p_to_seat_number,
          'move_reason', p_reason
        ),
        'manual_move', 'issued', v_actor
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    from_table_id, from_table_number, from_seat_number,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    v_entry.tournament_id, p_entry_id, v_entry.player_id,
    v_from_tt.table_id, v_from_tt.table_number, v_from_seat.seat_number,
    v_to_tt.table_id, v_to_tt.table_number, p_to_seat_number,
    p_reason, 'manual_move', v_actor,
    jsonb_build_object(
      'from_tournament_table_id', v_from_tt.id,
      'to_tournament_table_id', v_to_tt.id,
      'chip_count_at_move', v_from_seat.chip_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', p_entry_id,
    'player_name', v_from_seat.player_name,
    'from_tournament_table_id', v_from_tt.id,
    'from_game_table_id', v_from_tt.table_id,
    'from_table_number', v_from_tt.table_number,
    'from_seat_number', v_from_seat.seat_number,
    'to_tournament_table_id', v_to_tt.id,
    'to_game_table_id', v_to_tt.table_id,
    'to_table_number', v_to_tt.table_number,
    'to_seat_number', p_to_seat_number,
    'chip_count', v_from_seat.chip_count,
    'current_stack', v_from_seat.chip_count,
    'seat_id', v_new_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_player_seat(UUID, UUID, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_player_seat(UUID, UUID, INTEGER, UUID, TEXT) TO authenticated;

-- Atomic non-payout bust path used while floorAtomicPayout remains OFF.
-- Rollback: restore the previous Edge-only seat update only after providing an
-- equivalent transaction-safe RPC; do not drop this function while deployed Edge calls it.
CREATE OR REPLACE FUNCTION public.floor_bust_player(
  p_tournament_id UUID,
  p_seat_id UUID,
  p_expected_chip_count INTEGER,
  p_reason TEXT DEFAULT 'floor_bust'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_seat RECORD;
  v_entry RECORD;
  v_authorized BOOLEAN;
  v_players_remaining INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_expected_chip_count IS NULL OR p_expected_chip_count < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_expected_chip_count');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_close_report
    WHERE tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_already_closed');
  END IF;

  SELECT * INTO v_seat
  FROM public.tournament_seats
  WHERE id = p_seat_id
    AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_found');
  END IF;
  IF NOT v_seat.is_active THEN
    IF v_seat.status = 'busted' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_busted', 'seat_id', p_seat_id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_active', 'status', v_seat.status);
  END IF;
  IF v_seat.entry_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'orphan_active_seat');
  END IF;
  IF v_seat.chip_count IS DISTINCT FROM p_expected_chip_count THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stale_seat_state',
      'current_chip_count', v_seat.chip_count
    );
  END IF;
  IF v_seat.chip_count <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_has_chips');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    JOIN public.hand_players hp ON hp.hand_id = h.id
    WHERE h.tournament_id = p_tournament_id
      AND h.status = 'in_progress'
      AND hp.player_id = v_seat.player_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_in_active_hand');
  END IF;

  SELECT * INTO v_entry
  FROM public.tournament_entries
  WHERE id = v_seat.entry_id
    AND tournament_id = p_tournament_id
    AND player_id = v_seat.player_id
    AND entry_no = v_seat.entry_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
  END IF;
  IF v_entry.status <> 'seated' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_seated', 'status', v_entry.status);
  END IF;

  UPDATE public.tournament_seats
  SET status = 'busted', is_active = false
  WHERE id = p_seat_id
    AND is_active = true
    AND chip_count = p_expected_chip_count;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_seat_state');
  END IF;

  -- The legacy trigger is best-effort. This explicit update is in the same
  -- transaction, so the seat and entry can never commit in different states.
  UPDATE public.tournament_entries
  SET status = 'busted',
      current_stack = 0,
      busted_at = COALESCE(busted_at, now()),
      updated_at = now()
  WHERE id = v_entry.id
    AND status IN ('seated', 'busted');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry_state_changed';
  END IF;

  SELECT COUNT(*)::integer INTO v_players_remaining
  FROM public.tournament_seats
  WHERE tournament_id = p_tournament_id
    AND is_active = true;

  UPDATE public.tournaments
  SET players_remaining = v_players_remaining,
      current_players = v_players_remaining,
      updated_at = now()
  WHERE id = p_tournament_id;

  INSERT INTO public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, payload
  ) VALUES (
    v_tour.club_id, v_actor, 'floor_player_busted', 'tournament', p_tournament_id,
    jsonb_build_object(
      'seat_id', p_seat_id,
      'entry_id', v_entry.id,
      'player_id', v_seat.player_id,
      'entry_number', v_seat.entry_number,
      'reason', COALESCE(NULLIF(p_reason, ''), 'floor_bust'),
      'players_remaining', v_players_remaining,
      'payout_applied', false
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'busted',
    'seat_id', p_seat_id,
    'entry_id', v_entry.id,
    'players_remaining', v_players_remaining,
    'payout_applied', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_bust_player(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_bust_player(UUID, UUID, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_busted_player_to_seat(
  p_entry_id UUID,
  p_to_tournament_table_id UUID,
  p_to_seat_number INTEGER,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'floor_restore'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_entry RECORD;
  v_tour RECORD;
  v_bseat RECORD;
  v_from_tt RECORD;
  v_to_tt RECORD;
  v_chip INTEGER;
  v_name TEXT;
  v_new_seat_id UUID;
  v_authorized BOOLEAN;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_mismatch');
  END IF;

  SELECT * INTO v_entry
  FROM public.tournament_entries
  WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = v_entry.tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT * INTO v_entry
  FROM public.tournament_entries
  WHERE id = p_entry_id
    AND tournament_id = v_tour.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_changed');
  END IF;
  IF v_entry.status <> 'busted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_busted', 'status', v_entry.status);
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Never silently rewrite a closed result or an already-paid prize.
  IF v_tour.status = 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_completed');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_close_report
    WHERE tournament_id = v_tour.id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_already_closed');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_prize_payments
    WHERE tournament_id = v_tour.id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prize_already_paid');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats
    WHERE tournament_id = v_entry.tournament_id
      AND player_id = v_entry.player_id
      AND is_active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_active');
  END IF;

  SELECT * INTO v_bseat
  FROM public.tournament_seats
  WHERE entry_id = p_entry_id
    AND tournament_id = v_entry.tournament_id
    AND player_id = v_entry.player_id
    AND entry_number = v_entry.entry_no
    AND is_active = false
    AND status = 'busted'
  ORDER BY assigned_at DESC NULLS LAST, created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'busted_seat_not_found');
  END IF;

  SELECT tt.id, tt.table_id, tt.table_number
  INTO v_from_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = v_entry.tournament_id
    AND v_bseat.table_id IN (tt.id, tt.table_id)
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

  v_chip := v_bseat.chip_count;
  v_name := COALESCE(
    NULLIF(v_bseat.player_name, ''),
    (SELECT display_name FROM public.profiles WHERE user_id = v_entry.player_id),
    v_entry.player_id::text
  );

  SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
  INTO v_to_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_to_tournament_table_id
    AND tt.tournament_id = v_entry.tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  IF p_to_seat_number IS NULL OR p_to_seat_number < 1 OR p_to_seat_number > v_to_tt.max_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_seat_number', 'max_seats', v_to_tt.max_seats);
  END IF;

  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
    ) VALUES (
      v_entry.tournament_id, v_entry.player_id, v_entry.entry_no,
      v_to_tt.id, p_to_seat_number,
      v_chip, true, v_name, p_entry_id, 'active', v_actor, now()
    ) RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  UPDATE public.tournament_seats
  SET status = 'moved'
  WHERE id = v_bseat.id;

  UPDATE public.tournament_entries
  SET status = 'seated',
      busted_at = NULL,
      bust_order = NULL,
      finished_place = NULL,
      table_id = v_to_tt.table_id,
      seat_number = p_to_seat_number,
      seat_id = v_new_seat_id,
      current_stack = v_chip,
      updated_at = now()
  WHERE id = p_entry_id;

  UPDATE public.tournaments
  SET players_remaining = (
    SELECT COUNT(*)
    FROM public.tournament_seats
    WHERE tournament_id = v_entry.tournament_id
      AND is_active = true
  ), updated_at = now()
  WHERE id = v_entry.tournament_id;

  UPDATE public.seat_draw_receipts
  SET status = 'superseded', cancelled_at = now()
  WHERE entry_id = p_entry_id
    AND status IN ('issued', 'printed');

  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format(
      'T%s-S%s-%s',
      COALESCE(v_to_tt.table_number::text, '?'),
      p_to_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        v_entry.tournament_id, v_entry.registration_id, p_entry_id,
        v_entry.player_id, v_name, v_to_tt.table_id, v_to_tt.table_number,
        v_new_seat_id, p_to_seat_number, v_receipt_code,
        jsonb_build_object(
          'v', 1, 'receipt_code', v_receipt_code, 'entry_id', p_entry_id,
          'tournament_id', v_entry.tournament_id, 'player_id', v_entry.player_id,
          'table_number', v_to_tt.table_number, 'seat_number', p_to_seat_number,
          'restore_reason', p_reason
        ),
        'manual_move', 'issued', v_actor
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    from_table_id, from_table_number, from_seat_number,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    v_entry.tournament_id, p_entry_id, v_entry.player_id,
    v_from_tt.table_id, v_from_tt.table_number, v_bseat.seat_number,
    v_to_tt.table_id, v_to_tt.table_number, p_to_seat_number,
    COALESCE(NULLIF(p_reason, ''), 'floor_restore'), 'manual_move', v_actor,
    jsonb_build_object(
      'restored_from_busted', true,
      'chip_count', v_chip,
      'from_tournament_table_id', v_from_tt.id,
      'to_tournament_table_id', v_to_tt.id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', p_entry_id,
    'player_name', v_name,
    'to_table_number', v_to_tt.table_number,
    'to_seat_number', p_to_seat_number,
    'chip_count', v_chip,
    'seat_id', v_new_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_busted_player_to_seat(UUID, UUID, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_busted_player_to_seat(UUID, UUID, INTEGER, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_tournament(
  p_tournament_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_authorized BOOLEAN;
  v_existing public.tournament_close_report;
  v_report public.tournament_close_report;
  v_entry_count INTEGER;
  v_active_count INTEGER;
  v_buy_in BIGINT;
  v_cash_in BIGINT;
  v_prize BIGINT;
  v_club_rev BIGINT;
  v_balance BIGINT;
  v_delta BIGINT;
  v_reconciled BOOLEAN;
  v_detail JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.clubs c
    LEFT JOIN public.club_cashiers cc
      ON cc.club_id = c.id AND cc.user_id = v_actor
    WHERE c.id = v_tour.club_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Idempotency comes before live-seat validation: a retry never creates a new report.
  SELECT * INTO v_existing
  FROM public.tournament_close_report
  WHERE tournament_id = p_tournament_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'already_closed',
      'report_id', v_existing.id,
      'closed_at', v_existing.closed_at,
      'club_revenue', v_existing.club_revenue,
      'reconciled', v_existing.reconciled
    );
  END IF;

  IF v_tour.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_cancelled');
  END IF;

  PERFORM 1
  FROM public.tournament_seats ts
  WHERE ts.tournament_id = p_tournament_id
    AND ts.is_active = true
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
      AND ts.entry_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'orphan_active_seat');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    LEFT JOIN public.tournament_entries e ON e.id = ts.entry_id
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
      AND (
        e.id IS NULL
        OR e.tournament_id IS DISTINCT FROM ts.tournament_id
        OR e.player_id IS DISTINCT FROM ts.player_id
        OR e.entry_no IS DISTINCT FROM ts.entry_number
        OR e.status IS DISTINCT FROM 'seated'
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
  END IF;

  SELECT COUNT(*)::integer INTO v_active_count
  FROM public.tournament_seats
  WHERE tournament_id = p_tournament_id
    AND is_active = true;
  IF v_active_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'active_players_remaining',
      'active_players', v_active_count
    );
  END IF;

  SELECT COUNT(*)::integer,
         COALESCE(SUM(buy_in), 0)::bigint,
         COALESCE(SUM(total_pay), 0)::bigint
  INTO v_entry_count, v_buy_in, v_cash_in
  FROM public.tournament_registrations
  WHERE tournament_id = p_tournament_id
    AND status = 'confirmed';

  SELECT COALESCE(SUM(prize), 0)::bigint INTO v_prize
  FROM public.tournament_eliminations
  WHERE tournament_id = p_tournament_id;

  v_club_rev := v_cash_in - v_buy_in;
  v_balance := v_cash_in - v_prize;
  v_delta := v_buy_in - v_prize;
  v_reconciled := (v_delta = 0);
  v_detail := jsonb_build_object(
    'rake_amount', v_tour.rake_amount,
    'service_fee_amount', v_tour.service_fee_amount,
    'prize_pool_config', v_tour.prize_pool,
    'status_before', v_tour.status
  );

  INSERT INTO public.tournament_close_report (
    tournament_id, club_id, closed_by, entry_count, buy_in_total, cash_in_total,
    club_revenue, prize_total, cashier_balance, reconcile_delta, reconciled,
    detail, reason
  ) VALUES (
    p_tournament_id, v_tour.club_id, v_actor, v_entry_count, v_buy_in, v_cash_in,
    v_club_rev, v_prize, v_balance, v_delta, v_reconciled, v_detail, p_reason
  )
  ON CONFLICT (tournament_id) DO NOTHING
  RETURNING * INTO v_report;

  IF v_report.id IS NULL THEN
    SELECT * INTO v_report
    FROM public.tournament_close_report
    WHERE tournament_id = p_tournament_id;
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'already_closed',
      'report_id', v_report.id,
      'club_revenue', v_report.club_revenue,
      'reconciled', v_report.reconciled
    );
  END IF;

  IF v_tour.status <> 'completed' THEN
    UPDATE public.tournaments
    SET status = 'completed', updated_at = now()
    WHERE id = p_tournament_id;

    INSERT INTO public.tournament_state_transitions (
      tournament_id, previous_state, new_state, changed_by, reason
    ) VALUES (
      p_tournament_id, v_tour.status, 'completed', v_actor,
      COALESCE(p_reason, 'close_report')
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'closed',
    'report_id', v_report.id,
    'entry_count', v_entry_count,
    'buy_in_total', v_buy_in,
    'cash_in_total', v_cash_in,
    'club_revenue', v_club_rev,
    'prize_total', v_prize,
    'cashier_balance', v_balance,
    'reconcile_delta', v_delta,
    'reconciled', v_reconciled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_tournament(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tournament(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_tournament_table(
  p_tournament_table_id UUID,
  p_draw_mode TEXT DEFAULT 'redraw_balanced',
  p_reason TEXT DEFAULT 'table_break'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_authorized BOOLEAN;
  v_tour RECORD;
  v_close RECORD;
  v_need INTEGER;
  v_have INTEGER;
  v_m RECORD;
  v_h RECORD;
  v_new_seat_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER;
  v_moves JSONB := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_draw_mode NOT IN ('redraw_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  SELECT tt.id, tt.tournament_id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_close
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = v_close.tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  SELECT tt.id, tt.tournament_id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_close
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tour.id
  FOR UPDATE;
  IF v_close.status = 'closed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'closed', true, 'already_closed', true,
      'table_number', v_close.table_number, 'moved', '[]'::jsonb
    );
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  PERFORM 1
  FROM public.tournament_seats ts
  WHERE ts.tournament_id = v_tour.id
    AND ts.is_active = true
    AND ts.table_id IN (v_close.id, v_close.table_id)
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = v_tour.id
      AND ts.is_active = true
      AND ts.table_id IN (v_close.id, v_close.table_id)
      AND ts.entry_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'orphan_active_seat');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    LEFT JOIN public.tournament_entries e ON e.id = ts.entry_id
    WHERE ts.tournament_id = v_tour.id
      AND ts.is_active = true
      AND ts.table_id IN (v_close.id, v_close.table_id)
      AND (
        e.id IS NULL
        OR e.tournament_id IS DISTINCT FROM ts.tournament_id
        OR e.player_id IS DISTINCT FROM ts.player_id
        OR e.entry_no IS DISTINCT FROM ts.entry_number
        OR e.status IS DISTINCT FROM 'seated'
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
  END IF;

  PERFORM 1
  FROM public.tournament_entries e
  WHERE e.id IN (
    SELECT ts.entry_id
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = v_tour.id
      AND ts.is_active = true
      AND ts.table_id IN (v_close.id, v_close.table_id)
  )
  FOR UPDATE;

  DROP TABLE IF EXISTS pg_temp._floor_close_movers;
  DROP TABLE IF EXISTS pg_temp._floor_close_holes;

  CREATE TEMP TABLE _floor_close_movers ON COMMIT DROP AS
  SELECT ts.id AS from_seat_id,
         ts.seat_number AS from_seat_number,
         ts.player_name,
         ts.chip_count,
         e.id AS entry_id,
         e.player_id,
         e.entry_no,
         e.registration_id
  FROM public.tournament_seats ts
  JOIN public.tournament_entries e ON e.id = ts.entry_id
  WHERE ts.tournament_id = v_tour.id
    AND ts.is_active = true
    AND ts.table_id IN (v_close.id, v_close.table_id);

  SELECT COUNT(*)::integer INTO v_need FROM _floor_close_movers;
  IF v_need = 0 THEN
    UPDATE public.tournament_tables
    SET status = 'closed'
    WHERE id = v_close.id;
    IF v_close.table_id IS NOT NULL THEN
      PERFORM public.release_dealer_from_table(v_close.table_id);
      UPDATE public.game_tables
      SET status = 'inactive'
      WHERE id = v_close.table_id;
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'closed', true,
      'table_number', v_close.table_number, 'moved', '[]'::jsonb
    );
  END IF;

  CREATE TEMP TABLE _floor_close_holes ON COMMIT DROP AS
  SELECT tt.id AS tt_id,
         tt.table_id AS game_id,
         tt.table_number,
         s.n AS seat_number,
         (
           SELECT COUNT(*)
           FROM public.tournament_seats x
           WHERE x.is_active = true
             AND x.table_id IN (tt.id, tt.table_id)
         )::integer AS occ
  FROM public.tournament_tables tt
  CROSS JOIN LATERAL generate_series(1, tt.max_seats) AS s(n)
  WHERE tt.tournament_id = v_tour.id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
    AND tt.id <> v_close.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_seats x
      WHERE x.is_active = true
        AND x.seat_number = s.n
        AND x.table_id IN (tt.id, tt.table_id)
    );

  SELECT COUNT(*)::integer INTO v_have FROM _floor_close_holes;
  IF v_have < v_need THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'insufficient_capacity',
      'need', v_need, 'have', v_have
    );
  END IF;

  FOR v_m IN SELECT * FROM _floor_close_movers ORDER BY random() LOOP
    LOOP
      IF p_draw_mode = 'fill_lowest_table' THEN
        SELECT * INTO v_h
        FROM _floor_close_holes
        ORDER BY table_number ASC, seat_number ASC
        LIMIT 1;
      ELSE
        SELECT * INTO v_h
        FROM _floor_close_holes
        ORDER BY occ ASC, random()
        LIMIT 1;
      END IF;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'redraw_no_seat';
      END IF;

      BEGIN
        UPDATE public.tournament_seats
        SET status = 'moved', is_active = false
        WHERE id = v_m.from_seat_id;

        INSERT INTO public.tournament_seats (
          tournament_id, player_id, entry_number, table_id, seat_number,
          chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
        ) VALUES (
          v_tour.id, v_m.player_id, v_m.entry_no, v_h.tt_id, v_h.seat_number,
          v_m.chip_count, true, v_m.player_name, v_m.entry_id, 'active', v_actor, now()
        ) RETURNING id INTO v_new_seat_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        DELETE FROM _floor_close_holes
        WHERE tt_id = v_h.tt_id
          AND seat_number = v_h.seat_number;
      END;
    END LOOP;

    UPDATE public.tournament_entries
    SET table_id = v_h.game_id,
        seat_number = v_h.seat_number,
        seat_id = v_new_seat_id,
        current_stack = v_m.chip_count,
        updated_at = now()
    WHERE id = v_m.entry_id;

    UPDATE public.seat_draw_receipts
    SET status = 'superseded', cancelled_at = now()
    WHERE entry_id = v_m.entry_id
      AND status IN ('issued', 'printed');

    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      v_receipt_code := format(
        'T%s-S%s-%s',
        COALESCE(v_h.table_number::text, '?'),
        v_h.seat_number,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
      );
      BEGIN
        INSERT INTO public.seat_draw_receipts (
          tournament_id, registration_id, entry_id, player_id, display_name,
          table_id, table_number, seat_id, seat_number, receipt_code,
          qr_payload, draw_type, status, issued_by
        ) VALUES (
          v_tour.id, v_m.registration_id, v_m.entry_id, v_m.player_id,
          v_m.player_name, v_h.game_id, v_h.table_number, v_new_seat_id,
          v_h.seat_number, v_receipt_code,
          jsonb_build_object(
            'v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_m.entry_id,
            'tournament_id', v_tour.id, 'player_id', v_m.player_id,
            'table_number', v_h.table_number, 'seat_number', v_h.seat_number,
            'reason', 'table_break'
          ),
          'manual_move', 'issued', v_actor
        ) RETURNING id INTO v_receipt_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempt >= 5 THEN RAISE; END IF;
      END;
    END LOOP;

    INSERT INTO public.seat_assignment_history (
      tournament_id, entry_id, player_id,
      from_table_id, from_table_number, from_seat_number,
      to_table_id, to_table_number, to_seat_number,
      reason, draw_type, actor_user_id, metadata
    ) VALUES (
      v_tour.id, v_m.entry_id, v_m.player_id,
      v_close.table_id, v_close.table_number, v_m.from_seat_number,
      v_h.game_id, v_h.table_number, v_h.seat_number,
      'table_break_redraw', 'manual_move', v_actor,
      jsonb_build_object(
        'from_tournament_table_id', v_close.id,
        'to_tournament_table_id', v_h.tt_id,
        'chip_count_at_move', v_m.chip_count,
        'draw_mode', p_draw_mode,
        'close_reason', p_reason
      )
    );

    DELETE FROM _floor_close_holes
    WHERE tt_id = v_h.tt_id
      AND seat_number = v_h.seat_number;
    UPDATE _floor_close_holes
    SET occ = occ + 1
    WHERE tt_id = v_h.tt_id;

    v_moves := v_moves || jsonb_build_object(
      'player_name', v_m.player_name,
      'from_seat', v_m.from_seat_number,
      'to_table_number', v_h.table_number,
      'to_seat_number', v_h.seat_number,
      'receipt_code', v_receipt_code
    );
  END LOOP;

  -- Defensive invariant: never close/deactivate a table that still has an active seat.
  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats
    WHERE tournament_id = v_tour.id
      AND is_active = true
      AND table_id IN (v_close.id, v_close.table_id)
  ) THEN
    RAISE EXCEPTION 'source_table_not_empty';
  END IF;

  UPDATE public.tournament_tables
  SET status = 'closed'
  WHERE id = v_close.id;
  IF v_close.table_id IS NOT NULL THEN
    PERFORM public.release_dealer_from_table(v_close.table_id);
    UPDATE public.game_tables
    SET status = 'inactive'
    WHERE id = v_close.table_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'closed', true,
    'table_number', v_close.table_number,
    'moved_count', v_need,
    'moved', v_moves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.redraw_tournament(
  p_tournament_id UUID,
  p_mode TEXT,
  p_eligible_entry_ids UUID[] DEFAULT NULL,
  p_target_table_count INTEGER DEFAULT NULL,
  p_draw_mode TEXT DEFAULT 'redraw_balanced',
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_authorized BOOLEAN;
  v_tour RECORD;
  v_reason TEXT;
  v_room_seats INTEGER;
  v_tc INTEGER;
  v_need INTEGER;
  v_have INTEGER;
  v_p RECORD;
  v_h RECORD;
  v_new_seat_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER;
  v_moves JSONB := '[]'::jsonb;
  v_closed JSONB := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_mode NOT IN ('final_table', 'table_count_threshold', 'itm', 'manual_custom') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;
  IF p_draw_mode NOT IN ('redraw_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;
  IF p_mode = 'manual_custom'
     AND (p_eligible_entry_ids IS NULL OR cardinality(p_eligible_entry_ids) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual_requires_entry_ids');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Lock and validate the complete active-seat graph before planning, including dry-run.
  PERFORM 1
  FROM public.tournament_seats ts
  WHERE ts.tournament_id = p_tournament_id
    AND ts.is_active = true
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
      AND ts.entry_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'orphan_active_seat');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    LEFT JOIN public.tournament_entries e ON e.id = ts.entry_id
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
      AND (
        e.id IS NULL
        OR e.tournament_id IS DISTINCT FROM ts.tournament_id
        OR e.player_id IS DISTINCT FROM ts.player_id
        OR e.entry_no IS DISTINCT FROM ts.entry_number
        OR e.status IS DISTINCT FROM 'seated'
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
      AND (
        SELECT COUNT(*)
        FROM public.tournament_tables tt
        WHERE tt.tournament_id = p_tournament_id
          AND ts.table_id IN (tt.id, tt.table_id)
      ) <> 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

  PERFORM 1
  FROM public.tournament_entries e
  WHERE e.id IN (
    SELECT ts.entry_id
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
  )
  FOR UPDATE;

  v_reason := CASE p_mode
    WHEN 'final_table' THEN 'final_table_redraw'
    WHEN 'table_count_threshold' THEN 'threshold_redraw'
    WHEN 'itm' THEN 'itm_redraw'
    WHEN 'manual_custom' THEN 'manual_redraw'
  END;

  DROP TABLE IF EXISTS pg_temp._floor_redraw_elig;
  DROP TABLE IF EXISTS pg_temp._floor_redraw_targets;
  DROP TABLE IF EXISTS pg_temp._floor_redraw_holes;
  DROP TABLE IF EXISTS pg_temp._floor_redraw_plan;

  CREATE TEMP TABLE _floor_redraw_elig ON COMMIT DROP AS
  SELECT ts.id AS from_seat_id,
         ts.table_id AS from_seat_tid,
         ts.seat_number AS from_seat_number,
         ts.player_name,
         ts.chip_count,
         e.id AS entry_id,
         e.player_id,
         e.entry_no,
         e.registration_id,
         tt.table_id AS from_game_id,
         tt.table_number AS from_table_number
  FROM public.tournament_seats ts
  JOIN public.tournament_entries e ON e.id = ts.entry_id
  JOIN public.tournament_tables tt
    ON tt.tournament_id = ts.tournament_id
   AND ts.table_id IN (tt.id, tt.table_id)
  WHERE ts.tournament_id = p_tournament_id
    AND ts.is_active = true
    AND (p_mode <> 'manual_custom' OR e.id = ANY(p_eligible_entry_ids));

  SELECT COUNT(*)::integer INTO v_need FROM _floor_redraw_elig;
  IF p_mode = 'manual_custom'
     AND v_need <> (
       SELECT COUNT(DISTINCT entry_id)::integer
       FROM unnest(p_eligible_entry_ids) AS requested(entry_id)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual_entry_not_seated');
  END IF;
  IF v_need = 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'mode', p_mode, 'dry_run', p_dry_run,
      'moves', '[]'::jsonb, 'closed', '[]'::jsonb,
      'note', 'no_eligible_players'
    );
  END IF;

  v_room_seats := COALESCE(
    (
      SELECT mode() WITHIN GROUP (ORDER BY max_seats)
      FROM public.tournament_tables
      WHERE tournament_id = p_tournament_id
        AND status = 'active'
        AND max_seats IS NOT NULL
    ),
    9
  );
  v_tc := COALESCE(
    p_target_table_count,
    CASE p_mode
      WHEN 'final_table' THEN 1
      WHEN 'table_count_threshold' THEN 3
      WHEN 'itm' THEN GREATEST(1, CEIL(v_need::numeric / v_room_seats)::integer)
      WHEN 'manual_custom' THEN (
        SELECT COUNT(*)
        FROM public.tournament_tables
        WHERE tournament_id = p_tournament_id
          AND status = 'active'
          AND table_id IS NOT NULL
      )
    END
  );
  IF v_tc < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_table_count');
  END IF;

  CREATE TEMP TABLE _floor_redraw_targets ON COMMIT DROP AS
  SELECT tt.id AS tt_id,
         tt.table_id AS game_id,
         tt.table_number,
         tt.max_seats
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
  ORDER BY tt.table_number ASC NULLS LAST
  LIMIT v_tc;

  IF (SELECT COUNT(*) FROM _floor_redraw_targets) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_target_tables');
  END IF;

  CREATE TEMP TABLE _floor_redraw_holes ON COMMIT DROP AS
  SELECT target.tt_id,
         target.game_id,
         target.table_number,
         seat_no.n AS seat_number,
         (
           SELECT COUNT(*)
           FROM public.tournament_seats occupied
           WHERE occupied.is_active = true
             AND occupied.table_id IN (target.tt_id, target.game_id)
             AND occupied.entry_id NOT IN (SELECT entry_id FROM _floor_redraw_elig)
         )::integer AS occ
  FROM _floor_redraw_targets target
  CROSS JOIN LATERAL generate_series(1, target.max_seats) AS seat_no(n)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.tournament_seats occupied
    WHERE occupied.is_active = true
      AND occupied.seat_number = seat_no.n
      AND occupied.table_id IN (target.tt_id, target.game_id)
      AND occupied.entry_id NOT IN (SELECT entry_id FROM _floor_redraw_elig)
  );

  SELECT COUNT(*)::integer INTO v_have FROM _floor_redraw_holes;
  IF v_have < v_need THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'insufficient_capacity',
      'need', v_need, 'have', v_have, 'target_table_count', v_tc
    );
  END IF;

  CREATE TEMP TABLE _floor_redraw_plan (
    entry_id UUID,
    player_id UUID,
    entry_no INTEGER,
    registration_id UUID,
    player_name TEXT,
    chip_count INTEGER,
    from_seat_id UUID,
    from_game_id UUID,
    from_table_number INTEGER,
    from_seat_number INTEGER,
    to_tt_id UUID,
    to_game_id UUID,
    to_table_number INTEGER,
    to_seat_number INTEGER
  ) ON COMMIT DROP;

  FOR v_p IN SELECT * FROM _floor_redraw_elig ORDER BY random() LOOP
    IF p_draw_mode = 'fill_lowest_table' THEN
      SELECT * INTO v_h
      FROM _floor_redraw_holes
      ORDER BY table_number ASC, seat_number ASC
      LIMIT 1;
    ELSE
      SELECT * INTO v_h
      FROM _floor_redraw_holes
      ORDER BY occ ASC, random()
      LIMIT 1;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'plan_no_seat'; END IF;

    INSERT INTO _floor_redraw_plan VALUES (
      v_p.entry_id, v_p.player_id, v_p.entry_no, v_p.registration_id,
      v_p.player_name, v_p.chip_count,
      v_p.from_seat_id, v_p.from_game_id, v_p.from_table_number, v_p.from_seat_number,
      v_h.tt_id, v_h.game_id, v_h.table_number, v_h.seat_number
    );

    DELETE FROM _floor_redraw_holes
    WHERE tt_id = v_h.tt_id
      AND seat_number = v_h.seat_number;
    UPDATE _floor_redraw_holes
    SET occ = occ + 1
    WHERE tt_id = v_h.tt_id;
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'player_name', player_name,
        'from_table_number', from_table_number,
        'from_seat', from_seat_number,
        'to_table_number', to_table_number,
        'to_seat_number', to_seat_number
      ) ORDER BY to_table_number, to_seat_number
    ),
    '[]'::jsonb
  ) INTO v_moves
  FROM _floor_redraw_plan;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('table_number', tt.table_number) ORDER BY tt.table_number),
    '[]'::jsonb
  ) INTO v_closed
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
    AND tt.id NOT IN (SELECT tt_id FROM _floor_redraw_targets)
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_seats occupied
      WHERE occupied.is_active = true
        AND occupied.table_id IN (tt.id, tt.table_id)
        AND occupied.entry_id NOT IN (SELECT entry_id FROM _floor_redraw_elig)
    );

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'mode', p_mode, 'dry_run', true,
      'target_table_count', v_tc, 'eligible', v_need, 'free_seats', v_have,
      'moves', v_moves, 'tables_to_close', v_closed
    );
  END IF;

  UPDATE public.tournament_seats
  SET status = 'moved', is_active = false
  WHERE id IN (SELECT from_seat_id FROM _floor_redraw_elig);

  FOR v_p IN SELECT * FROM _floor_redraw_plan LOOP
    BEGIN
      INSERT INTO public.tournament_seats (
        tournament_id, player_id, entry_number, table_id, seat_number,
        chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
      ) VALUES (
        p_tournament_id, v_p.player_id, v_p.entry_no, v_p.to_tt_id,
        v_p.to_seat_number, v_p.chip_count, true, v_p.player_name,
        v_p.entry_id, 'active', v_actor, now()
      ) RETURNING id INTO v_new_seat_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'redraw_seat_conflict';
    END;

    UPDATE public.tournament_entries
    SET table_id = v_p.to_game_id,
        seat_number = v_p.to_seat_number,
        seat_id = v_new_seat_id,
        current_stack = v_p.chip_count,
        updated_at = now()
    WHERE id = v_p.entry_id;

    UPDATE public.seat_draw_receipts
    SET status = 'superseded', cancelled_at = now()
    WHERE entry_id = v_p.entry_id
      AND status IN ('issued', 'printed');

    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      v_receipt_code := format(
        'T%s-S%s-%s',
        COALESCE(v_p.to_table_number::text, '?'),
        v_p.to_seat_number,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
      );
      BEGIN
        INSERT INTO public.seat_draw_receipts (
          tournament_id, registration_id, entry_id, player_id, display_name,
          table_id, table_number, seat_id, seat_number, receipt_code,
          qr_payload, draw_type, status, issued_by
        ) VALUES (
          p_tournament_id, v_p.registration_id, v_p.entry_id, v_p.player_id,
          v_p.player_name, v_p.to_game_id, v_p.to_table_number,
          v_new_seat_id, v_p.to_seat_number, v_receipt_code,
          jsonb_build_object(
            'v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_p.entry_id,
            'tournament_id', p_tournament_id, 'player_id', v_p.player_id,
            'table_number', v_p.to_table_number, 'seat_number', v_p.to_seat_number,
            'reason', v_reason
          ),
          'manual_move', 'issued', v_actor
        ) RETURNING id INTO v_receipt_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempt >= 5 THEN RAISE; END IF;
      END;
    END LOOP;

    INSERT INTO public.seat_assignment_history (
      tournament_id, entry_id, player_id,
      from_table_id, from_table_number, from_seat_number,
      to_table_id, to_table_number, to_seat_number,
      reason, draw_type, actor_user_id, metadata
    ) VALUES (
      p_tournament_id, v_p.entry_id, v_p.player_id,
      v_p.from_game_id, v_p.from_table_number, v_p.from_seat_number,
      v_p.to_game_id, v_p.to_table_number, v_p.to_seat_number,
      v_reason, 'manual_move', v_actor,
      jsonb_build_object(
        'mode', p_mode,
        'draw_mode', p_draw_mode,
        'to_tournament_table_id', v_p.to_tt_id,
        'chip_count_at_move', v_p.chip_count
      )
    );
  END LOOP;

  FOR v_h IN
    SELECT tt.id, tt.table_id
    FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND tt.id NOT IN (SELECT tt_id FROM _floor_redraw_targets)
      AND NOT EXISTS (
        SELECT 1
        FROM public.tournament_seats occupied
        WHERE occupied.is_active = true
          AND occupied.table_id IN (tt.id, tt.table_id)
      )
    FOR UPDATE
  LOOP
    PERFORM public.release_dealer_from_table(v_h.table_id);
    UPDATE public.tournament_tables SET status = 'closed' WHERE id = v_h.id;
    UPDATE public.game_tables SET status = 'inactive' WHERE id = v_h.table_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'mode', p_mode, 'dry_run', false,
    'target_table_count', v_tc, 'moved_count', v_need,
    'moves', v_moves, 'tables_closed', v_closed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redraw_tournament(UUID, TEXT, UUID[], INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redraw_tournament(UUID, TEXT, UUID[], INTEGER, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.open_tournament_table(
  p_tournament_id UUID,
  p_table_number INTEGER DEFAULT NULL,
  p_max_seats INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_authorized BOOLEAN;
  v_tour RECORD;
  v_existing RECORD;
  v_number INTEGER;
  v_seats INTEGER;
  v_game_id UUID;
  v_tt_id UUID;
  v_reopened BOOLEAN := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF p_max_seats IS NOT NULL AND (p_max_seats < 2 OR p_max_seats > 10) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_max_seats');
  END IF;
  IF p_table_number IS NOT NULL AND p_table_number < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_table_number');
  END IF;
  v_seats := COALESCE(
    p_max_seats,
    (
      SELECT mode() WITHIN GROUP (ORDER BY max_seats)
      FROM public.tournament_tables
      WHERE tournament_id = p_tournament_id
        AND max_seats IS NOT NULL
    ),
    9
  );

  IF p_table_number IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.tournament_tables
    WHERE tournament_id = p_tournament_id
      AND table_number = p_table_number
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.status = 'active' THEN
        RETURN jsonb_build_object(
          'ok', false, 'error', 'table_number_taken',
          'table_number', p_table_number
        );
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.tournament_seats ts
        WHERE ts.tournament_id = p_tournament_id
          AND ts.is_active = true
          AND ts.table_id IN (v_existing.id, v_existing.table_id)
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'table_has_active_seats');
      END IF;

      v_game_id := v_existing.table_id;
      IF v_game_id IS NULL THEN
        SELECT id INTO v_game_id
        FROM public.game_tables
        WHERE club_id = v_tour.club_id
          AND table_name = 'Bàn ' || p_table_number::text
          AND shift_id IS NULL
        LIMIT 1
        FOR UPDATE;

        IF v_game_id IS NULL THEN
          INSERT INTO public.game_tables (
            club_id, table_name, table_type, status, current_blind_level
          ) VALUES (
            v_tour.club_id, 'Bàn ' || p_table_number::text,
            'tournament', 'active', COALESCE(v_tour.current_level, 1)
          ) RETURNING id INTO v_game_id;
        END IF;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.tournament_tables linked
        WHERE linked.table_id = v_game_id
          AND linked.status = 'active'
          AND linked.id <> v_existing.id
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'game_table_in_use');
      END IF;

      PERFORM public.release_dealer_from_table(v_game_id);
      UPDATE public.game_tables
      SET status = 'active',
          current_blind_level = COALESCE(v_tour.current_level, current_blind_level)
      WHERE id = v_game_id;

      UPDATE public.tournament_tables
      SET status = 'active', table_id = v_game_id
      WHERE id = v_existing.id;

      v_tt_id := v_existing.id;
      v_number := p_table_number;
      v_seats := v_existing.max_seats;
      v_reopened := true;
    END IF;
  END IF;

  IF v_tt_id IS NULL THEN
    IF p_table_number IS NOT NULL THEN
      v_number := p_table_number;
    ELSE
      SELECT MIN(candidate) INTO v_number
      FROM generate_series(1, 1000) AS candidate
      WHERE ('Bàn ' || candidate::text) NOT IN (
        SELECT table_name
        FROM public.tournament_tables
        WHERE tournament_id = p_tournament_id
      );
    END IF;

    IF v_number IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_table_slot');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.tournament_tables
      WHERE tournament_id = p_tournament_id
        AND table_name = 'Bàn ' || v_number::text
    ) THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'table_number_taken',
        'table_number', v_number
      );
    END IF;

    SELECT id INTO v_game_id
    FROM public.game_tables
    WHERE club_id = v_tour.club_id
      AND table_name = 'Bàn ' || v_number::text
      AND shift_id IS NULL
    LIMIT 1
    FOR UPDATE;

    IF v_game_id IS NULL THEN
      INSERT INTO public.game_tables (
        club_id, table_name, table_type, status, current_blind_level
      ) VALUES (
        v_tour.club_id, 'Bàn ' || v_number::text,
        'tournament', 'active', COALESCE(v_tour.current_level, 1)
      ) RETURNING id INTO v_game_id;
    ELSE
      IF EXISTS (
        SELECT 1
        FROM public.tournament_tables linked
        WHERE linked.table_id = v_game_id
          AND linked.status = 'active'
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'game_table_in_use');
      END IF;
      PERFORM public.release_dealer_from_table(v_game_id);
      UPDATE public.game_tables
      SET status = 'active',
          current_blind_level = COALESCE(v_tour.current_level, current_blind_level)
      WHERE id = v_game_id;
    END IF;

    INSERT INTO public.tournament_tables (
      tournament_id, table_id, table_number, max_seats, status, table_name
    ) VALUES (
      p_tournament_id, v_game_id, v_number, v_seats, 'active',
      'Bàn ' || v_number::text
    ) RETURNING id INTO v_tt_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_table_id', v_tt_id,
    'table_id', v_game_id,
    'table_number', v_number,
    'max_seats', v_seats,
    'status', 'active',
    'reopened', v_reopened
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_tournament_table(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_tournament_table(UUID, INTEGER, INTEGER) TO authenticated;

COMMIT;
