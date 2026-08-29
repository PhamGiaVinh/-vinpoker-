-- Tracker Hand #4 -> bust -> re-entry stabilization.
--
-- Source-only. Production apply is owner-gated and must snapshot pg_get_functiondef,
-- owner, ACL, SECURITY DEFINER and search_path for all three functions first.
-- Rollback: restore those exact pre-apply definitions inside one controlled
-- transaction. Do not use db push or migration repair for this migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_hand(
  p_tournament_id UUID,
  p_table_id UUID,
  p_hand_number INTEGER,
  p_hand_time TIMESTAMPTZ,
  p_players JSONB,
  p_actions JSONB,
  p_side_pots JSONB DEFAULT '[]'::JSONB,
  p_community_cards JSONB DEFAULT '[]'::JSONB,
  p_pot_size INTEGER DEFAULT 0,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_club_id UUID;
  v_tt RECORD;
  v_hand RECORD;
  v_table_matches INTEGER;
  v_hand_matches INTEGER;
  v_snapshot_count INTEGER;
  v_payload_count INTEGER;
  v_payload_distinct INTEGER;
  v_invalid_players INTEGER;
  v_starting_total BIGINT;
  v_ending_total BIGINT;
  v_invalid_actions INTEGER;
  v_action_count INTEGER;
  v_action_distinct INTEGER;
  v_player JSONB;
  v_action JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_seat_number INTEGER;
  v_starting_stack INTEGER;
  v_ending_stack INTEGER;
  v_is_eliminated BOOLEAN;
  v_seat RECORD;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_created_by IS NOT NULL AND p_created_by IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_mismatch');
  END IF;

  IF p_tournament_id IS NULL OR p_table_id IS NULL OR p_hand_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hand_identity');
  END IF;

  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_actions) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_side_pots, '[]'::JSONB)) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_community_cards, '[]'::JSONB)) IS DISTINCT FROM 'array'
     OR COALESCE(p_pot_size, 0) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'malformed_hand_payload');
  END IF;

  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  IF NOT public.is_club_tracker(v_actor, v_club_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;

  SELECT count(*) INTO v_table_matches
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND p_table_id IN (tt.id, tt.table_id);
  IF v_table_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  ELSIF v_table_matches <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_table_identity');
  END IF;

  SELECT tt.id, tt.table_id, tt.status
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND p_table_id IN (tt.id, tt.table_id)
  FOR UPDATE;

  SELECT count(*) INTO v_hand_matches
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id IN (v_tt.id, v_tt.table_id)
    AND h.hand_number = p_hand_number
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false;
  IF v_hand_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_hand_not_found');
  ELSIF v_hand_matches <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_active_hand');
  END IF;

  SELECT h.* INTO v_hand
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id IN (v_tt.id, v_tt.table_id)
    AND h.hand_number = p_hand_number
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false
  FOR UPDATE;

  PERFORM 1 FROM public.hand_players hp WHERE hp.hand_id = v_hand.id FOR UPDATE;
  PERFORM 1
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
  FOR UPDATE;
  PERFORM 1
  FROM public.tournament_entries e
  WHERE e.id IN (
    SELECT s.entry_id
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.entry_id IS NOT NULL
  )
  FOR UPDATE;
  PERFORM 1
  FROM public.tournament_chip_counts c
  WHERE c.tournament_id = p_tournament_id
    AND EXISTS (
      SELECT 1
      FROM public.tournament_seats s
      WHERE s.tournament_id = c.tournament_id
        AND s.table_id = v_tt.id
        AND s.player_id = c.player_id
        AND s.entry_number = c.entry_number
    )
  FOR UPDATE;

  BEGIN
    SELECT
      count(*),
      count(DISTINCT (p.player_id, p.entry_number)),
      count(*) FILTER (
        WHERE p.player_id IS NULL
           OR p.entry_number IS NULL
           OR p.entry_number < 1
           OR p.seat_number IS NULL
           OR p.seat_number < 1
           OR p.starting_stack IS NULL
           OR p.starting_stack < 0
           OR p.ending_stack IS NULL
           OR p.ending_stack < 0
           OR p.is_eliminated IS NULL
           OR p.is_eliminated IS DISTINCT FROM (p.ending_stack = 0)
      ),
      COALESCE(sum(p.starting_stack), 0),
      COALESCE(sum(p.ending_stack), 0)
    INTO
      v_payload_count,
      v_payload_distinct,
      v_invalid_players,
      v_starting_total,
      v_ending_total
    FROM jsonb_to_recordset(p_players) AS p(
      player_id UUID,
      entry_number INTEGER,
      seat_number INTEGER,
      starting_stack INTEGER,
      ending_stack INTEGER,
      is_eliminated BOOLEAN,
      side_pots JSONB,
      hole_cards JSONB
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'malformed_player_payload');
  END;

  SELECT count(*) INTO v_snapshot_count
  FROM public.hand_players hp
  WHERE hp.hand_id = v_hand.id;

  IF v_payload_count = 0
     OR v_payload_count <> v_payload_distinct
     OR v_invalid_players <> 0
     OR v_payload_count <> v_snapshot_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_snapshot_mismatch');
  END IF;

  IF v_starting_total <> v_ending_total THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'chip_conservation_failed',
      'starting_total', v_starting_total,
      'ending_total', v_ending_total
    );
  END IF;

  IF EXISTS (
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    ), snapshot AS (
      SELECT hp.player_id, hp.entry_number, hp.seat_number, hp.starting_stack
      FROM public.hand_players hp
      WHERE hp.hand_id = v_hand.id
    )
    SELECT 1
    FROM snapshot hp
    FULL JOIN payload p
      ON p.player_id = hp.player_id
     AND p.entry_number = hp.entry_number
    WHERE hp.player_id IS NULL
       OR p.player_id IS NULL
       OR p.seat_number IS DISTINCT FROM hp.seat_number
       OR p.starting_stack IS DISTINCT FROM hp.starting_stack
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_snapshot_mismatch');
  END IF;

  IF EXISTS (
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    )
    SELECT 1
    FROM payload p
    LEFT JOIN public.tournament_seats s
      ON s.tournament_id = p_tournament_id
     AND s.table_id = v_tt.id
     AND s.player_id = p.player_id
     AND s.entry_number = p.entry_number
     AND s.seat_number = p.seat_number
     AND s.is_active = true
    LEFT JOIN public.tournament_entries e
      ON e.id = s.entry_id
     AND e.tournament_id = p_tournament_id
     AND e.player_id = p.player_id
     AND e.entry_no = p.entry_number
     AND e.status = 'seated'
     AND e.table_id IS NOT DISTINCT FROM v_tt.table_id
     AND e.seat_number IS NOT DISTINCT FROM p.seat_number
    LEFT JOIN public.tournament_chip_counts c
      ON c.tournament_id = p_tournament_id
     AND c.player_id = p.player_id
     AND c.entry_number = p.entry_number
    WHERE s.id IS NULL
       OR e.id IS NULL
       OR s.chip_count IS DISTINCT FROM p.starting_stack
       OR e.current_stack IS DISTINCT FROM p.starting_stack
       OR (c.player_id IS NOT NULL AND c.chip_count IS DISTINCT FROM p.starting_stack)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stack_or_entry_projection_mismatch');
  END IF;

  BEGIN
    SELECT
      count(*),
      count(DISTINCT a.action_order),
      count(*) FILTER (
        WHERE a.player_id IS NULL
           OR a.entry_number IS NULL
           OR a.action_order IS NULL
           OR a.action_order < 1
           OR NULLIF(btrim(a.action_type), '') IS NULL
      )
    INTO v_action_count, v_action_distinct, v_invalid_actions
    FROM jsonb_to_recordset(p_actions) AS a(
      player_id UUID,
      entry_number INTEGER,
      street TEXT,
      action_type TEXT,
      action_amount INTEGER,
      action_order INTEGER
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'malformed_action_payload');
  END;

  IF v_action_count <> v_action_distinct OR v_invalid_actions <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'malformed_action_payload');
  END IF;

  IF EXISTS (
    WITH actions AS (
      SELECT *
      FROM jsonb_to_recordset(p_actions) AS a(
        player_id UUID,
        entry_number INTEGER,
        street TEXT,
        action_type TEXT,
        action_amount INTEGER,
        action_order INTEGER
      )
    ), players AS (
      SELECT p.player_id, p.entry_number
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    )
    SELECT 1
    FROM actions a
    LEFT JOIN players p
      ON p.player_id = a.player_id
     AND p.entry_number = a.entry_number
    WHERE p.player_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'action_player_mismatch');
  END IF;

  IF EXISTS (
    WITH actions AS (
      SELECT *
      FROM jsonb_to_recordset(p_actions) AS a(
        player_id UUID,
        entry_number INTEGER,
        street TEXT,
        action_type TEXT,
        action_amount INTEGER,
        action_order INTEGER
      )
    )
    SELECT 1
    FROM public.hand_actions existing
    JOIN actions incoming ON incoming.action_order = existing.action_order
    WHERE existing.hand_id = v_hand.id
      AND (
        existing.player_id IS DISTINCT FROM incoming.player_id
        OR COALESCE(existing.entry_number, 1) IS DISTINCT FROM incoming.entry_number
        OR COALESCE(existing.street, 'preflop') IS DISTINCT FROM COALESCE(incoming.street, 'preflop')
        OR existing.action_type IS DISTINCT FROM incoming.action_type
        OR COALESCE(existing.action_amount, 0) IS DISTINCT FROM COALESCE(incoming.action_amount, 0)
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'action_conflict');
  END IF;

  UPDATE public.tournament_hands
  SET community_cards = COALESCE(p_community_cards, '[]'::JSONB),
      pot_size = COALESCE(p_pot_size, 0),
      side_pots = COALESCE(p_side_pots, '[]'::JSONB),
      status = 'completed',
      updated_at = now(),
      locked_by_user_id = NULL,
      locked_at = NULL
  WHERE id = v_hand.id;

  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_player_id := (v_player->>'player_id')::UUID;
    v_entry_number := (v_player->>'entry_number')::INTEGER;
    v_seat_number := (v_player->>'seat_number')::INTEGER;
    v_starting_stack := (v_player->>'starting_stack')::INTEGER;
    v_ending_stack := (v_player->>'ending_stack')::INTEGER;
    v_is_eliminated := (v_player->>'is_eliminated')::BOOLEAN;

    SELECT s.id, s.entry_id, s.player_name, s.avatar_url
    INTO v_seat
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.player_id = v_player_id
      AND s.entry_number = v_entry_number
      AND s.seat_number = v_seat_number
      AND s.is_active = true;

    UPDATE public.hand_players hp
    SET ending_stack = v_ending_stack,
        is_eliminated = v_is_eliminated,
        side_pots = COALESCE(v_player->'side_pots', '[]'::JSONB),
        hole_cards = COALESCE(v_player->'hole_cards', '[]'::JSONB),
        player_name = COALESCE(hp.player_name, v_seat.player_name),
        avatar_url = COALESCE(hp.avatar_url, v_seat.avatar_url)
    WHERE hp.hand_id = v_hand.id
      AND hp.player_id = v_player_id
      AND hp.entry_number = v_entry_number;

    UPDATE public.tournament_seats
    SET chip_count = v_ending_stack,
        is_active = NOT v_is_eliminated,
        status = CASE WHEN v_is_eliminated THEN 'busted' ELSE 'active' END
    WHERE id = v_seat.id;

    INSERT INTO public.tournament_chip_counts (
      tournament_id, player_id, entry_number, chip_count
    ) VALUES (
      p_tournament_id, v_player_id, v_entry_number, v_ending_stack
    )
    ON CONFLICT (tournament_id, player_id, entry_number)
    DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = now();

    UPDATE public.tournament_entries
    SET current_stack = v_ending_stack,
        status = CASE WHEN v_is_eliminated THEN 'busted' ELSE 'seated' END,
        busted_at = CASE
          WHEN v_is_eliminated THEN COALESCE(busted_at, now())
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = v_seat.entry_id;

    IF v_is_eliminated AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_eliminations te
      WHERE te.tournament_id = p_tournament_id
        AND te.player_id = v_player_id
        AND te.entry_number = v_entry_number
        AND te.hand_id = v_hand.id
    ) THEN
      INSERT INTO public.tournament_eliminations (
        tournament_id, player_id, entry_number, hand_id, position, prize
      ) VALUES (
        p_tournament_id, v_player_id, v_entry_number, v_hand.id, 0, 0
      );
    END IF;
  END LOOP;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    INSERT INTO public.hand_actions (
      hand_id, player_id, entry_number, street,
      action_type, action_amount, action_order
    ) VALUES (
      v_hand.id,
      (v_action->>'player_id')::UUID,
      (v_action->>'entry_number')::INTEGER,
      COALESCE(v_action->>'street', 'preflop'),
      v_action->>'action_type',
      COALESCE((v_action->>'action_amount')::INTEGER, 0),
      (v_action->>'action_order')::INTEGER
    )
    ON CONFLICT (hand_id, action_order) DO NOTHING;
  END LOOP;

  UPDATE public.tournaments
  SET players_remaining = (
        SELECT count(*)
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      average_stack = (
        SELECT COALESCE(round(avg(s.chip_count)), 0)::INTEGER
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      updated_at = now()
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'success',
    'hand_id', v_hand.id,
    'starting_total', v_starting_total,
    'ending_total', v_ending_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_hand(
  UUID, UUID, INTEGER, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, INTEGER, UUID
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_hand(
  UUID, UUID, INTEGER, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, INTEGER, UUID
) TO authenticated, postgres;

-- No source consumer calls the seven-argument overload. Keep it unavailable to
-- browser roles so PostgREST cannot silently select the legacy settlement path.
DO $block$
BEGIN
  IF to_regprocedure(
    'public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated';
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public._assign_reentry_seat(
  p_tournament_id UUID,
  p_player_id UUID,
  p_source_entry_id UUID,
  p_registration_id UUID,
  p_actor_user_id UUID,
  p_draw_mode TEXT,
  p_starting_stack INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_name TEXT;
  v_source TEXT;
  v_entry_no INTEGER;
  v_entry_id UUID;
  v_seat_id UUID;
  v_seat_number INTEGER;
  v_table_tour_id UUID;
  v_table_game_id UUID;
  v_table_number INTEGER;
  v_max_seats INTEGER;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER := 0;
BEGIN
  SELECT source INTO v_source
  FROM public.tournament_entries
  WHERE id = p_source_entry_id;
  v_source := COALESCE(v_source, 'online');

  v_name := COALESCE(
    (SELECT NULLIF(trim(p.display_name), '') FROM public.profiles p WHERE p.user_id = p_player_id),
    (SELECT sdr.display_name FROM public.seat_draw_receipts sdr WHERE sdr.entry_id = p_source_entry_id ORDER BY sdr.issued_at DESC LIMIT 1),
    (SELECT ts.player_name FROM public.tournament_seats ts WHERE ts.entry_id = p_source_entry_id ORDER BY ts.assigned_at DESC NULLS LAST LIMIT 1),
    'PLAYER'
  );

  SELECT COALESCE(max(entry_no), 0) + 1 INTO v_entry_no
  FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id
    AND player_id = p_player_id;

  IF p_draw_mode = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count
      FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
      AND NOT EXISTS (
        SELECT 1
        FROM public.tournament_hands h
        WHERE h.tournament_id = p_tournament_id
          AND h.status = 'in_progress'
          AND COALESCE(h.is_voided, false) = false
          AND h.table_id IN (tt.id, tt.table_id)
      )
    ORDER BY tt.table_number ASC NULLS LAST, c.active_count ASC
    LIMIT 1;
  ELSE
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count
      FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
      AND NOT EXISTS (
        SELECT 1
        FROM public.tournament_hands h
        WHERE h.tournament_id = p_tournament_id
          AND h.status = 'in_progress'
          AND COALESCE(h.is_voided, false) = false
          AND h.table_id IN (tt.id, tt.table_id)
      )
    ORDER BY c.active_count ASC, random()
    LIMIT 1;
  END IF;
  IF v_table_tour_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_table_available');
  END IF;

  SELECT s.n INTO v_seat_number
  FROM generate_series(1, v_max_seats) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    WHERE ts.table_id = v_table_tour_id
      AND ts.seat_number = s.n
      AND ts.is_active = true
  )
  ORDER BY random()
  LIMIT 1;
  IF v_seat_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_seat_available');
  END IF;

  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, status, assigned_by, assigned_at
    ) VALUES (
      p_tournament_id, p_player_id, v_entry_no, v_table_tour_id, v_seat_number,
      p_starting_stack, true, v_name, 'active', p_actor_user_id, now()
    ) RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, p_registration_id, p_player_id, v_entry_no, v_source,
    'seated', p_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats
  SET entry_id = v_entry_id
  WHERE id = v_seat_id;

  INSERT INTO public.tournament_chip_counts (
    tournament_id, player_id, entry_number, chip_count
  ) VALUES (
    p_tournament_id, p_player_id, v_entry_no, p_starting_stack
  )
  ON CONFLICT (tournament_id, player_id, entry_number)
  DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = now();

  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format(
      'T%s-S%s-%s',
      COALESCE(v_table_number::TEXT, '?'),
      v_seat_number,
      upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        p_tournament_id, p_registration_id, v_entry_id, p_player_id, v_name,
        v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object(
          'v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', p_player_id,
          'table_number', v_table_number, 'seat_number', v_seat_number,
          'reentry', true, 'entry_no', v_entry_no
        ),
        'initial', 'issued', p_actor_user_id
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
    p_tournament_id, v_entry_id, p_player_id,
    v_table_game_id, v_table_number, v_seat_number,
    're_entry', 'initial', p_actor_user_id,
    jsonb_build_object(
      'draw_mode', p_draw_mode,
      'registration_id', p_registration_id,
      'entry_no', v_entry_no,
      'from_entry_id', p_source_entry_id
    )
  );

  UPDATE public.tournaments
  SET players_remaining = (
        SELECT count(*)
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      average_stack = (
        SELECT COALESCE(round(avg(s.chip_count)), 0)::INTEGER
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      updated_at = now()
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'seat_id', v_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code,
    'table_id', v_table_game_id,
    'table_number', v_table_number,
    'seat_number', v_seat_number,
    'display_name', v_name,
    'entry_no', v_entry_no,
    'starting_stack', p_starting_stack
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._assign_reentry_seat(
  UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_finalize_on_last_bust()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_club UUID;
  v_registration_closed_at TIMESTAMPTZ;
  v_enabled BOOLEAN;
  v_survivors INTEGER;
BEGIN
  IF NEW.status <> 'busted' OR COALESCE(OLD.status, '') = 'busted' THEN
    RETURN NEW;
  END IF;

  SELECT t.club_id, t.registration_closed_at
  INTO v_club, v_registration_closed_at
  FROM public.tournaments t
  WHERE t.id = NEW.tournament_id;
  IF v_club IS NULL OR v_registration_closed_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT player_history_enabled INTO v_enabled
  FROM public.club_settings
  WHERE club_id = v_club;
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_survivors
  FROM public.tournament_entries
  WHERE tournament_id = NEW.tournament_id
    AND COALESCE(status, '') <> 'busted';

  IF v_survivors <= 1 THEN
    BEGIN
      PERFORM public.finalize_tournament_results(NEW.tournament_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.player_history_link_errors (club_id, context, detail)
      VALUES (v_club, 'auto_finalize_on_last_bust', left(SQLERRM, 500));
    END;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
