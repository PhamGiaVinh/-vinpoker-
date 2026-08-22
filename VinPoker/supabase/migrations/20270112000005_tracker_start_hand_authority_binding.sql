-- P0 Tracker lock-authority hotfix.
--
-- Keep the legacy Hand Input signatures stable, but bind every identity-bearing
-- parameter to the authenticated database actor. This is intentionally limited
-- to start/heartbeat/board/showdown/undo lock ownership and does not alter pot,
-- settlement, chip, or void business rules.
BEGIN;

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
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor_user_id UUID := auth.uid();
  v_hand_id UUID;
  v_existing_id UUID;
  v_existing_lock_time TIMESTAMPTZ;
  v_retry_count INTEGER := 0;
  v_seat RECORD;
  v_tt RECORD;
  v_bad_seat INTEGER;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated');
  END IF;
  IF p_created_by IS NOT NULL AND p_created_by <> v_actor_user_id THEN
    RETURN jsonb_build_object('error', 'actor_mismatch');
  END IF;
  IF p_button_seat IS NULL OR p_button_seat < 1 OR p_button_seat > 10 THEN
    RETURN jsonb_build_object('error', 'Invalid button_seat: must be between 1 and 10');
  END IF;

  SELECT tt.id, tt.table_id, tt.floor_control_mode, t.club_id
  INTO v_tt
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE tt.id = p_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Table is not an active table in this tournament');
  END IF;
  IF NOT public.is_club_tracker(v_actor_user_id, v_tt.club_id) THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tournament_id::text),
    hashtext(v_tt.id::text)
  );

  -- Re-read the canonical table after the advisory lock so mode changes cannot
  -- race the start decision.
  SELECT tt.id, tt.table_id, tt.floor_control_mode, t.club_id
  INTO v_tt
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE tt.id = p_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Table is not an active table in this tournament');
  END IF;
  IF NOT public.is_club_tracker(v_actor_user_id, v_tt.club_id) THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
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
    RAISE EXCEPTION 'start_hand: seat % has zero chip seed stack', v_bad_seat;
  END IF;

  <<retry_loop>>
  LOOP
    BEGIN
      INSERT INTO public.tournament_hands
        (tournament_id, table_id, hand_number, hand_time, community_cards, pot_size, side_pots, status, created_by, locked_by_user_id, locked_at, button_seat)
      VALUES
        (p_tournament_id, p_table_id, p_hand_number, p_hand_time, '[]'::jsonb, 0, '[]'::jsonb, 'in_progress', v_actor_user_id, v_actor_user_id, NOW(), p_button_seat)
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

CREATE OR REPLACE FUNCTION public.update_community_cards(
  p_hand_id UUID,
  p_community_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
  v_validation TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated');
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'actor_mismatch');
  END IF;

  SELECT h.status, h.locked_by_user_id, h.locked_at, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;
  IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;
  IF v_hand.status <> 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress', 'status', v_hand.status);
  END IF;
  IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_required');
  END IF;
  IF v_hand.locked_by_user_id IS NULL OR v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_ambiguous');
  END IF;
  IF v_hand.locked_at <= now() - public.tracker_lock_ttl() THEN
    RETURN jsonb_build_object('error', 'tracker_lock_expired');
  END IF;
  IF v_hand.locked_by_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'tracker_lock_owned_by_another', 'locked_by', v_hand.locked_by_user_id);
  END IF;

  v_validation := public.validate_cards(p_community_cards);
  IF v_validation != 'ok' THEN
    RETURN jsonb_build_object('error', v_validation);
  END IF;
  IF jsonb_array_length(p_community_cards) NOT IN (0, 3, 4, 5) THEN
    RETURN jsonb_build_object('error', 'Invalid number of community cards', 'count', jsonb_array_length(p_community_cards));
  END IF;

  UPDATE public.tournament_hands
  SET community_cards = p_community_cards,
      updated_at = NOW(),
      locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success');
END;
$function$;

CREATE OR REPLACE FUNCTION public.show_hole_cards(
  p_hand_id UUID,
  p_player_hole_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
  v_validation TEXT;
  v_item JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_cards JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated');
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'actor_mismatch');
  END IF;

  SELECT h.status, h.locked_by_user_id, h.locked_at, h.community_cards, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;
  IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;
  IF v_hand.status <> 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;
  IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_required');
  END IF;
  IF v_hand.locked_by_user_id IS NULL OR v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_ambiguous');
  END IF;
  IF v_hand.locked_at <= now() - public.tracker_lock_ttl() THEN
    RETURN jsonb_build_object('error', 'tracker_lock_expired');
  END IF;
  IF v_hand.locked_by_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'tracker_lock_owned_by_another', 'locked_by', v_hand.locked_by_user_id);
  END IF;

  PERFORM 1 FROM public.hand_players WHERE hand_id = p_hand_id FOR UPDATE;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_player_hole_cards) LOOP
    v_player_id := (v_item ->> 'player_id')::UUID;
    v_entry_number := COALESCE((v_item ->> 'entry_number')::INTEGER, 1);
    v_cards := v_item -> 'hole_cards';

    v_validation := public.validate_cards(v_cards);
    IF v_validation != 'ok' THEN
      RETURN jsonb_build_object('error', v_validation);
    END IF;
    IF jsonb_array_length(v_cards) != 2 THEN
      RETURN jsonb_build_object('error', 'Must provide exactly 2 hole cards per player');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.hand_players
      WHERE hand_id = p_hand_id AND player_id = v_player_id AND entry_number = v_entry_number
    ) THEN
      RETURN jsonb_build_object('error', 'Player not found in this hand');
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_cards) AS new_card(c1)
      WHERE c1 IN (
        SELECT jsonb_array_elements_text(v_hand.community_cards)
        UNION
        SELECT jsonb_array_elements_text(hp.hole_cards)
        FROM public.hand_players hp
        WHERE hp.hand_id = p_hand_id
          AND hp.player_id != v_player_id
          AND hp.hole_cards IS NOT NULL
          AND hp.hole_cards != '[]'::jsonb
      )
    ) THEN
      RETURN jsonb_build_object('error', 'Card already used by another player or in community cards');
    END IF;

    UPDATE public.hand_players
    SET hole_cards = v_cards
    WHERE hand_id = p_hand_id AND player_id = v_player_id AND entry_number = v_entry_number;
  END LOOP;

  UPDATE public.tournament_hands
  SET updated_at = NOW(), locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success');
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_last_action(
  p_hand_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_street TEXT;
  v_action_type TEXT;
  v_action_amount INTEGER;
  v_action_order INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated');
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'actor_mismatch');
  END IF;

  SELECT h.status, h.locked_by_user_id, h.locked_at, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;
  IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;
  IF v_hand.status <> 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;
  IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_required');
  END IF;
  IF v_hand.locked_by_user_id IS NULL OR v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_ambiguous');
  END IF;
  IF v_hand.locked_at <= now() - public.tracker_lock_ttl() THEN
    RETURN jsonb_build_object('error', 'tracker_lock_expired');
  END IF;
  IF v_hand.locked_by_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'tracker_lock_owned_by_another', 'locked_by', v_hand.locked_by_user_id);
  END IF;

  PERFORM 1 FROM public.hand_actions WHERE hand_id = p_hand_id FOR UPDATE;
  DELETE FROM public.hand_actions
  WHERE id = (
    SELECT id FROM public.hand_actions
    WHERE hand_id = p_hand_id
    ORDER BY action_order DESC, created_at DESC
    LIMIT 1
  )
  RETURNING player_id, entry_number, street, action_type, action_amount, action_order
  INTO v_player_id, v_entry_number, v_street, v_action_type, v_action_amount, v_action_order;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'No action to undo');
  END IF;

  UPDATE public.tournament_hands
  SET updated_at = NOW(), locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'deleted', jsonb_build_object(
      'player_id', v_player_id,
      'entry_number', v_entry_number,
      'street', v_street,
      'action_type', v_action_type,
      'action_amount', v_action_amount,
      'action_order', v_action_order
    )
  );
END;
$function$;

-- 12004 applies after the legacy production state and hardens heartbeat. Repeat
-- the same safe legacy definition here so this migration is independently safe
-- when applied before 12004, while preserving the Voice-aware implementation.
DO $authority_hotfix$
DECLARE
  v_heartbeat TEXT;
BEGIN
  IF to_regclass('public.tracker_voice_events') IS NULL THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.heartbeat_lock(
        p_hand_id UUID,
        p_user_id UUID DEFAULT NULL
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_actor UUID := auth.uid();
        v_hand RECORD;
      BEGIN
        IF v_actor IS NULL THEN
          RETURN jsonb_build_object('error', 'unauthorized');
        END IF;
        IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
          RETURN jsonb_build_object('error', 'actor_mismatch');
        END IF;

        SELECT h.id, h.status, h.is_voided, h.locked_by_user_id, h.locked_at, t.club_id
        INTO v_hand
        FROM public.tournament_hands h
        JOIN public.tournaments t ON t.id = h.tournament_id
        WHERE h.id = p_hand_id
        FOR UPDATE OF h;
        IF NOT FOUND THEN
          RETURN jsonb_build_object('error', 'Hand not found');
        END IF;
        IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
          RETURN jsonb_build_object('error', 'Hand is not in progress');
        END IF;
        IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
          RETURN jsonb_build_object('error', 'actor_not_allowed');
        END IF;
        IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NOT NULL THEN
          RETURN jsonb_build_object('error', 'tracker_lock_ambiguous');
        END IF;
        IF v_hand.locked_by_user_id IS NOT NULL
           AND v_hand.locked_by_user_id <> v_actor
           AND v_hand.locked_at IS NOT NULL
           AND v_hand.locked_at > now() - public.tracker_lock_ttl() THEN
          RETURN jsonb_build_object(
            'error', 'tracker_lock_owned_by_another',
            'locked_by', v_hand.locked_by_user_id
          );
        END IF;

        UPDATE public.tournament_hands
        SET locked_by_user_id = v_actor,
            locked_at = now()
        WHERE id = p_hand_id;

        RETURN jsonb_build_object('status', 'success', 'locked_by', v_actor, 'locked_at', now());
      END;
      $body$;
    $definition$;
  ELSE
    v_heartbeat := pg_get_functiondef('public.heartbeat_lock(uuid,uuid)'::regprocedure);
    IF position('auth.uid()' IN v_heartbeat) = 0
       OR position('actor_mismatch' IN v_heartbeat) = 0 THEN
      RAISE EXCEPTION 'tracker authority hotfix requires the Voice-era auth-bound heartbeat_lock definition';
    END IF;
  END IF;
END;
$authority_hotfix$;

REVOKE ALL ON FUNCTION public.start_hand(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, INTEGER)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_hand(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, INTEGER)
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_community_cards(UUID, JSONB, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_community_cards(UUID, JSONB, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.show_hole_cards(UUID, JSONB, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.show_hole_cards(UUID, JSONB, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.delete_last_action(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_last_action(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.heartbeat_lock(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_lock(UUID, UUID)
  TO authenticated;

COMMIT;
