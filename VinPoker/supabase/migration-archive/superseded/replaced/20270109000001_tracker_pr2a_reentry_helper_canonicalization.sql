-- TRACKER PR2A FOLLOW-UP: canonicalize the re-entry seat helper and close the
-- final legacy-writer safety gate.
--
-- Source lineage was missing from current-main migrations while the helper was
-- present in the live database. Read-only provenance checks matched the live
-- helper to the historical definition after removing formatting/comments.
-- No production row values or secrets were copied. Live helper metadata was:
-- owner=postgres, SECURITY DEFINER, search_path=public, postgres-only EXECUTE.
--
-- This migration is intentionally after 20270108000004. It must not edit the
-- merged 20270108000003/00004 migrations. The 00004 wrapper already acquires
-- the shared tournament lock before calling this helper.

CREATE OR REPLACE FUNCTION public._assign_reentry_seat(
  p_tournament_id   uuid,
  p_player_id       uuid,
  p_source_entry_id uuid,
  p_registration_id uuid,
  p_actor_user_id   uuid,
  p_draw_mode       text,
  p_starting_stack  integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name           TEXT;
  v_source         TEXT;
  v_entry_no       INTEGER;
  v_entry_id       UUID;
  v_seat_id        UUID;
  v_seat_number    INTEGER;
  v_table_tour_id  UUID;   -- tournament_tables.id (FK target for tournament_seats)
  v_table_game_id  UUID;   -- game_tables.id        (FK target for entries/receipts/history)
  v_table_number   INTEGER;
  v_max_seats      INTEGER;
  v_receipt_id     UUID;
  v_receipt_code   TEXT;
  v_attempt        INTEGER := 0;
BEGIN
  -- Source channel preserved from the busted entry.
  SELECT source INTO v_source FROM public.tournament_entries WHERE id = p_source_entry_id;
  v_source := COALESCE(v_source, 'online');

  -- Display name (profile -> prior receipt -> prior seat -> fallback).
  v_name := COALESCE(
    (SELECT NULLIF(TRIM(p.display_name), '') FROM public.profiles p WHERE p.user_id = p_player_id),
    (SELECT sdr.display_name FROM public.seat_draw_receipts sdr WHERE sdr.entry_id = p_source_entry_id ORDER BY sdr.issued_at DESC LIMIT 1),
    (SELECT ts.player_name FROM public.tournament_seats ts WHERE ts.entry_id = p_source_entry_id ORDER BY ts.assigned_at DESC NULLS LAST LIMIT 1),
    'PLAYER'
  );

  -- Next entry number for this player.
  SELECT COALESCE(MAX(entry_no), 0) + 1 INTO v_entry_no
  FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  -- Draw a table with free capacity, excluding every non-voided in-progress
  -- hand. Check both canonical tournament-table and physical table identity.
  IF p_draw_mode = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active' AND tt.table_id IS NOT NULL
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
      SELECT count(*) AS active_count FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active' AND tt.table_id IS NOT NULL
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

  -- Random empty seat in that table. No writes occur before this succeeds.
  SELECT s.n INTO v_seat_number
  FROM generate_series(1, v_max_seats) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tournament_seats ts
    WHERE ts.table_id = v_table_tour_id AND ts.seat_number = s.n AND ts.is_active = true
  )
  ORDER BY random()
  LIMIT 1;
  IF v_seat_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_seat_available');
  END IF;

  -- Claim the seat first. A concurrent claim returns seat_occupied.
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

  -- New seated entry (entry_no incremented, source preserved) + link the seat.
  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, p_registration_id, p_player_id, v_entry_no, v_source,
    'seated', p_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- Receipt with retry on a generated-code collision.
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s',
      COALESCE(v_table_number::text, '?'), v_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        p_tournament_id, p_registration_id, v_entry_id, p_player_id, v_name,
        v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', p_player_id,
          'table_number', v_table_number, 'seat_number', v_seat_number,
          'reentry', true, 'entry_no', v_entry_no),
        'initial', 'issued', p_actor_user_id
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- Audit history (reason='re_entry').
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    p_tournament_id, v_entry_id, p_player_id,
    v_table_game_id, v_table_number, v_seat_number,
    're_entry', 'initial', p_actor_user_id,
    jsonb_build_object('draw_mode', p_draw_mode, 'registration_id', p_registration_id,
      'entry_no', v_entry_no, 'from_entry_id', p_source_entry_id)
  );

  RETURN jsonb_build_object(
    'ok', true, 'entry_id', v_entry_id, 'seat_id', v_seat_id, 'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code, 'table_id', v_table_game_id, 'table_number', v_table_number,
    'seat_number', v_seat_number, 'display_name', v_name, 'entry_no', v_entry_no,
    'starting_stack', p_starting_stack
  );
END;
$$;

-- The helper is internal-only. It is called by SECURITY DEFINER wrappers, not
-- exposed through PostgREST or directly to browser roles.
REVOKE ALL ON FUNCTION public._assign_reentry_seat(uuid, uuid, uuid, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_pr2a_lock_club_id UUID;
  v_pr2a_lock_authorized BOOLEAN;
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

  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = v_entry.tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor OR cc.user_id IS NOT NULL)) OR public.is_club_floor(v_actor, v_pr2a_lock_club_id)) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(v_entry.tournament_id);
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

  -- A restore is a roster mutation. Fail closed before the first seat,
  -- entry, receipt, history or players_remaining write when the destination
  -- table has a non-voided in-progress hand. Check both table identities.
  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    WHERE h.tournament_id = v_entry.tournament_id
      AND h.table_id IN (v_to_tt.id, v_to_tt.table_id)
      AND h.status = 'in_progress'
      AND COALESCE(h.is_voided, false) = false
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
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

-- Preserve the existing restore writer's public surface from the merged
-- migrations; the helper above remains internal-only.
REVOKE ALL ON FUNCTION public.restore_busted_player_to_seat(uuid, uuid, integer, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.restore_busted_player_to_seat(uuid, uuid, integer, uuid, text)
  TO authenticated;
