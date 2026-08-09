BEGIN;

-- A table must be classified explicitly.  Manual Floor is the safe legacy/default
-- operating mode; only a table deliberately switched to tracker requires a zero
-- stack before Floor can bust its player.  The revision is a small CAS token so
-- two Floor tabs cannot silently overwrite each other's choice.
ALTER TABLE public.tournament_tables
  ADD COLUMN IF NOT EXISTS floor_control_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS floor_control_revision BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tournament_tables'::regclass
      AND conname = 'tournament_tables_floor_control_mode_check'
  ) THEN
    ALTER TABLE public.tournament_tables
      ADD CONSTRAINT tournament_tables_floor_control_mode_check
      CHECK (floor_control_mode IN ('manual', 'tracker'));
  END IF;
END;
$$;

-- Server-authoritative mode change.  The client supplies a canonical
-- tournament_tables.id and the revision it rendered; it never supplies a bust
-- policy.  A table with a live hand is intentionally fail-closed.
CREATE OR REPLACE FUNCTION public.floor_set_table_control_mode(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_control_mode TEXT,
  p_expected_control_revision BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_tt RECORD;
  v_authorized BOOLEAN;
  v_previous_mode TEXT;
  v_next_revision BIGINT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_control_mode IS NULL OR p_control_mode NOT IN ('manual', 'tracker') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_floor_control_mode');
  END IF;
  IF p_expected_control_revision IS NULL OR p_expected_control_revision < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_table_control_revision');
  END IF;

  -- Match close_tournament_table's lock order (table → tournament) before
  -- taking the shared table advisory lock. This avoids an inversion while a
  -- close and a mode change arrive from separate operator tabs.
  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
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

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tournament_id::text),
    hashtext(v_tt.id::text)
  );

  -- Re-read after the shared lock so a concurrent mode change cannot make this
  -- decision from a stale row.
  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id
      AND h.status = 'in_progress'
      AND h.table_id IN (v_tt.id, v_tt.table_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  v_previous_mode := v_tt.floor_control_mode;
  UPDATE public.tournament_tables
  SET floor_control_mode = p_control_mode,
      floor_control_revision = floor_control_revision + 1
  WHERE id = v_tt.id
    AND tournament_id = p_tournament_id
    AND status = 'active'
    AND floor_control_revision = p_expected_control_revision
  RETURNING floor_control_revision INTO v_next_revision;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_table_control_mode');
  END IF;

  INSERT INTO public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, payload
  ) VALUES (
    v_tour.club_id, v_actor, 'floor_table_control_mode_changed', 'tournament_table', v_tt.id,
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'previous_mode', v_previous_mode,
      'next_mode', p_control_mode,
      'previous_revision', p_expected_control_revision,
      'next_revision', v_next_revision,
      'payout_applied', false
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'floor_control_mode', p_control_mode,
    'floor_control_revision', v_next_revision,
    'payout_applied', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_set_table_control_mode(UUID, UUID, TEXT, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_set_table_control_mode(UUID, UUID, TEXT, BIGINT) TO authenticated;

-- Atomic, non-payout Floor bust.  The policy is resolved from the locked
-- server-side table, never accepted from a browser or Edge request.
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
  v_tt RECORD;
  v_tt_id UUID;
  v_entry RECORD;
  v_authorized BOOLEAN;
  v_table_match_count INTEGER;
  v_tracker_chip_count INTEGER;
  v_tracker_chip_exists BOOLEAN := false;
  v_players_remaining INTEGER;
  v_manual_nonzero_override BOOLEAN := false;
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

  -- A legacy seat may carry either identity, but it must resolve to one and
  -- only one active tournament-table.  Choosing an arbitrary lowest table
  -- number would let a duplicated mapping select the wrong policy.
  SELECT COUNT(*)::integer INTO v_table_match_count
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND v_seat.table_id IN (tt.id, tt.table_id);
  IF v_table_match_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND v_seat.table_id IN (tt.id, tt.table_id);

  v_tt_id := v_tt.id;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tournament_id::text),
    hashtext(v_tt.id::text)
  );

  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = v_tt_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

  -- A hand is table-scoped.  Check it before chips so the same rule applies
  -- to Manual Floor and Live Tracker, and after the shared lock so start_hand
  -- cannot race this bust decision.
  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id
      AND h.status = 'in_progress'
      AND h.table_id IN (v_tt.id, v_tt.table_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_in_active_hand');
  END IF;
  IF v_tt.floor_control_mode = 'tracker' THEN
    SELECT cc.chip_count INTO v_tracker_chip_count
    FROM public.tournament_chip_counts cc
    WHERE cc.tournament_id = p_tournament_id
      AND cc.player_id = v_seat.player_id
      AND cc.entry_number = v_seat.entry_number
    FOR UPDATE;
    v_tracker_chip_exists := FOUND;

    -- Tracker settlement must provide and update both projections.  A missing
    -- row or mismatch is an integrity problem, not permission to choose
    -- whichever stack is zero.
    IF NOT v_tracker_chip_exists
      OR v_tracker_chip_count IS DISTINCT FROM v_seat.chip_count THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'tracker_chip_state_mismatch',
        'seat_chip_count', v_seat.chip_count,
        'tracker_chip_count', v_tracker_chip_count
      );
    END IF;
    IF v_tracker_chip_count <> 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'player_has_chips');
    END IF;
  END IF;
  v_manual_nonzero_override := v_tt.floor_control_mode = 'manual' AND v_seat.chip_count <> 0;

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

  -- Keep the historical seat chip value.  Clearing tracker chip-count rows for
  -- a Manual Floor bust would manufacture a tracker settlement that did not
  -- occur.  The entry is terminal and is therefore excluded from a new hand.
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
      'floor_control_mode', v_tt.floor_control_mode,
      'floor_control_revision', v_tt.floor_control_revision,
      'chip_count_before', v_seat.chip_count,
      'manual_nonzero_chip_override', v_manual_nonzero_override,
      'payout_applied', false
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'busted',
    'seat_id', p_seat_id,
    'entry_id', v_entry.id,
    'players_remaining', v_players_remaining,
    'floor_control_mode', v_tt.floor_control_mode,
    'manual_nonzero_chip_override', v_manual_nonzero_override,
    'payout_applied', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_bust_player(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_bust_player(UUID, UUID, INTEGER, TEXT) TO authenticated;

-- A Live Tracker table owns stacks through its tracker settlement path; allowing
-- the Floor CAS there would create a split-brain seat/chip-count projection.
CREATE OR REPLACE FUNCTION public.floor_update_tournament_seat_chip(
  p_tournament_id UUID,
  p_seat_id UUID,
  p_expected_chip_count INTEGER,
  p_chip_count INTEGER
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
  v_tt RECORD;
  v_tt_id UUID;
  v_authorized BOOLEAN;
  v_table_match_count INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_expected_chip_count IS NULL OR p_expected_chip_count < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_expected_chip_count');
  END IF;
  IF p_chip_count IS NULL OR p_chip_count < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_chip_count');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id;
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

  SELECT * INTO v_seat
  FROM public.tournament_seats ts
  WHERE ts.id = p_seat_id
    AND ts.tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_found');
  END IF;
  IF NOT v_seat.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_active');
  END IF;
  IF v_seat.entry_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.tournament_entries te
    WHERE te.id = v_seat.entry_id
      AND te.tournament_id = p_tournament_id
      AND te.player_id = v_seat.player_id
      AND te.entry_no = v_seat.entry_number
      AND te.status = 'seated'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
  END IF;
  IF v_seat.chip_count IS DISTINCT FROM p_expected_chip_count THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stale_seat_state',
      'current_chip_count', v_seat.chip_count
    );
  END IF;

  SELECT COUNT(*)::integer INTO v_table_match_count
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND v_seat.table_id IN (tt.id, tt.table_id);
  IF v_table_match_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND v_seat.table_id IN (tt.id, tt.table_id);
  v_tt_id := v_tt.id;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tournament_id::text),
    hashtext(v_tt.id::text)
  );

  SELECT * INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = v_tt_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;
  IF v_tt.floor_control_mode = 'tracker' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tracker_table_chip_authority');
  END IF;
  IF p_chip_count = v_seat.chip_count THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'seat_id', v_seat.id,
      'chip_count', v_seat.chip_count
    );
  END IF;

  UPDATE public.tournament_seats
  SET chip_count = p_chip_count
  WHERE id = p_seat_id
    AND tournament_id = p_tournament_id
    AND is_active = true
    AND chip_count = p_expected_chip_count;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_seat_state');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'seat_id', p_seat_id,
    'chip_count', p_chip_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_update_tournament_seat_chip(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_update_tournament_seat_chip(UUID, UUID, INTEGER, INTEGER) TO authenticated;

-- Serialize start-hand with both the mode setter and bust.  The latest prior
-- version only relied on the hand-number unique key, so two different hand
-- numbers could otherwise become in_progress on one physical table.
CREATE OR REPLACE FUNCTION public.start_hand(
  p_tournament_id uuid,
  p_table_id uuid,
  p_hand_number integer,
  p_hand_time timestamp with time zone DEFAULT now(),
  p_created_by uuid DEFAULT NULL::uuid,
  p_button_seat integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_hand_id UUID;
  v_existing_id UUID;
  v_existing_lock_time TIMESTAMPTZ;
  v_retry_count INTEGER := 0;
  v_seat RECORD;
  v_tt RECORD;
  v_bad_seat INTEGER;
BEGIN
  IF p_button_seat IS NULL OR p_button_seat < 1 OR p_button_seat > 10 THEN
    RETURN jsonb_build_object('error', 'Invalid button_seat: must be between 1 and 10');
  END IF;

  SELECT tt.id, tt.table_id, tt.floor_control_mode INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Table is not an active table in this tournament');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tournament_id::text),
    hashtext(v_tt.id::text)
  );

  -- This is the authoritative classification seam: a Tracker hand cannot be
  -- started on a legacy/default Manual table. Existing Live Tracker tables must
  -- be explicitly classified in the controlled rollout before their next hand.
  SELECT tt.id, tt.table_id, tt.floor_control_mode INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Table is not an active table in this tournament');
  END IF;
  IF v_tt.floor_control_mode <> 'tracker' THEN
    RETURN jsonb_build_object(
      'error', 'Live Tracker requires this table to be marked Tracker first',
      'error_code', 'tracker_table_required'
    );
  END IF;

  SELECT h.id, h.locked_at INTO v_existing_id, v_existing_lock_time
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.status = 'in_progress'
    AND h.table_id IN (v_tt.id, v_tt.table_id)
  ORDER BY h.locked_at DESC NULLS LAST
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    IF v_existing_lock_time < NOW() - INTERVAL '10 minutes' THEN
      UPDATE public.tournament_hands
      SET status = 'voided', is_voided = true,
          locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
      WHERE id = v_existing_id AND status = 'in_progress';

      DELETE FROM public.hand_actions WHERE hand_id = v_existing_id;
      DELETE FROM public.tournament_eliminations WHERE hand_id = v_existing_id;
      UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false
      WHERE hand_id = v_existing_id;
    ELSE
      RETURN jsonb_build_object(
        'error', 'Table already has an active hand',
        'error_code', 'table_has_active_hand',
        'hand_id', v_existing_id
      );
    END IF;
  END IF;

  SELECT ts.seat_number INTO v_bad_seat
  FROM public.tournament_seats ts
  LEFT JOIN public.tournament_chip_counts cc
    ON cc.tournament_id = ts.tournament_id
    AND cc.player_id = ts.player_id
    AND cc.entry_number = ts.entry_number
  WHERE ts.tournament_id = p_tournament_id
    AND ts.table_id = p_table_id
    AND ts.is_active = true
    AND COALESCE(cc.chip_count, ts.chip_count, 0) <= 0
  ORDER BY ts.seat_number
  LIMIT 1;

  IF v_bad_seat IS NOT NULL THEN
    RAISE EXCEPTION 'start_hand: ghế % chưa có chip (seed stack = 0) — không thể bắt đầu hand. Hãy nạp chip cho người chơi trước.', v_bad_seat;
  END IF;

  <<retry_loop>>
  LOOP
    BEGIN
      INSERT INTO public.tournament_hands
        (tournament_id, table_id, hand_number, hand_time, community_cards, pot_size, side_pots, status, created_by, locked_by_user_id, locked_at, button_seat)
      VALUES
        (p_tournament_id, p_table_id, p_hand_number, p_hand_time, '[]'::jsonb, 0, '[]'::jsonb, 'in_progress', p_created_by, p_created_by, NOW(), p_button_seat)
      RETURNING id INTO v_hand_id;

      EXIT retry_loop;
    EXCEPTION WHEN unique_violation THEN
      v_retry_count := v_retry_count + 1;

      IF v_retry_count > 1 THEN
        SELECT id, locked_at INTO v_existing_id, v_existing_lock_time
        FROM public.tournament_hands
        WHERE tournament_id = p_tournament_id AND table_id = p_table_id AND status = 'in_progress';

        RETURN jsonb_build_object('error', 'Table already has an active hand', 'hand_id', v_existing_id);
      END IF;

      SELECT id, locked_at INTO v_existing_id, v_existing_lock_time
      FROM public.tournament_hands
      WHERE tournament_id = p_tournament_id AND table_id = p_table_id AND status = 'in_progress';

      IF v_existing_id IS NULL THEN
        CONTINUE retry_loop;
      END IF;

      IF v_existing_lock_time < NOW() - INTERVAL '10 minutes' THEN
        UPDATE public.tournament_hands
        SET status = 'voided', is_voided = true,
            locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
        WHERE id = v_existing_id AND status = 'in_progress';

        DELETE FROM public.hand_actions WHERE hand_id = v_existing_id;
        DELETE FROM public.tournament_eliminations WHERE hand_id = v_existing_id;
        UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false
        WHERE hand_id = v_existing_id;

        CONTINUE retry_loop;
      ELSE
        RETURN jsonb_build_object('error', 'Table already has an active hand', 'hand_id', v_existing_id);
      END IF;
    END;
  END LOOP;

  FOR v_seat IN
    SELECT ts.player_id, ts.entry_number, ts.seat_number,
           COALESCE(cc.chip_count, ts.chip_count, 0) AS chip_count,
           ts.player_name, ts.avatar_url
    FROM public.tournament_seats ts
    LEFT JOIN public.tournament_chip_counts cc
      ON cc.tournament_id = ts.tournament_id
      AND cc.player_id = ts.player_id
      AND cc.entry_number = ts.entry_number
    WHERE ts.tournament_id = p_tournament_id
      AND ts.table_id = p_table_id
      AND ts.is_active = true
    ORDER BY ts.seat_number
  LOOP
    INSERT INTO public.hand_players
      (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots, hole_cards, player_name, avatar_url)
    VALUES
      (v_hand_id, p_tournament_id, v_seat.player_id, v_seat.entry_number,
       v_seat.seat_number, v_seat.chip_count, NULL, false, '[]'::jsonb, '[]'::jsonb,
       v_seat.player_name, v_seat.avatar_url);
  END LOOP;

  RETURN jsonb_build_object('status', 'success', 'hand_id', v_hand_id, 'button_seat', p_button_seat);
END;
$function$;

COMMIT;
