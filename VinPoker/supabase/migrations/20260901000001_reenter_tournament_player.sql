-- ============================================================================
-- reenter_tournament_player — re-buy a BUSTED player back into the tournament
-- ============================================================================
-- SOURCE-ONLY (authored here; applied later in a controlled, owner-gated DB
-- session — NOT by `supabase db push`).
--
-- A busted player pays again at the counter → a NEW entry (entry_no incremented),
-- a freshly drawn seat, and a new receipt. Mirrors the offline buy-in draw
-- (20260826000003) but REUSES the existing player_id so the player's entries stay
-- linked and entry_no reflects the true re-entry count. The original busted entry
-- is left untouched (audit).
--
-- Draw-before-write (no orphans): validate → load source entry → lock tournament →
-- auth → resolve name → DRAW table+seat (no writes) → CLAIM seat first
-- (unique_violation → seat_occupied, nothing else written) → registration → entry →
-- link → receipt → history.
--
-- Security: actor = auth.uid() ONLY (no client actor id); SECURITY DEFINER;
-- SET search_path = public; owner/club_cashier gate; PUBLIC/anon EXECUTE revoked.
--
-- Re-enterable state: the source entry must be 'busted' (a 'seated'/'registered'
-- player is still in; 'finished' is final). A player may hold only one active seat.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reenter_tournament_player(
  p_entry_id   UUID,
  p_buy_in     BIGINT,
  p_fee        BIGINT,
  p_draw_mode  TEXT DEFAULT 'random_balanced'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id  UUID := auth.uid();
  v_authorized     BOOLEAN;
  v_src            RECORD;   -- the busted source entry
  v_tour           RECORD;
  v_player_id      UUID;
  v_name           TEXT;
  v_source         TEXT;
  v_entry_no       INTEGER;
  v_reg_id         UUID;
  v_ref_code       TEXT;
  v_starting_stack INTEGER;
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
  -- 0. Actor from auth.uid() ONLY.
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 1. Validate amounts (before any write).
  IF p_buy_in IS NULL OR p_buy_in <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_buy_in');
  END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_fee');
  END IF;
  IF p_draw_mode NOT IN ('random_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  -- 2. Load the source entry; must be a busted player.
  SELECT * INTO v_src FROM public.tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  IF v_src.status <> 'busted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_reenterable', 'status', v_src.status);
  END IF;

  v_player_id := v_src.player_id;
  v_source    := v_src.source;  -- preserve origin channel (online/offline/manual/staff)

  -- 3. Lock the tournament; must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_src.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 4. Authorization (owner or club_cashier).
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = v_src.tournament_id
      AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 5. One active seat per player.
  PERFORM 1 FROM public.tournament_seats
  WHERE tournament_id = v_src.tournament_id AND player_id = v_player_id AND is_active = true;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_already_active');
  END IF;

  -- 6. Resolve display name (profile → prior receipt → prior seat → fallback).
  v_name := COALESCE(
    (SELECT NULLIF(TRIM(p.display_name), '') FROM public.profiles p WHERE p.user_id = v_player_id),
    (SELECT sdr.display_name FROM public.seat_draw_receipts sdr WHERE sdr.entry_id = p_entry_id ORDER BY sdr.issued_at DESC LIMIT 1),
    (SELECT ts.player_name FROM public.tournament_seats ts WHERE ts.entry_id = p_entry_id ORDER BY ts.assigned_at DESC NULLS LAST LIMIT 1),
    'PLAYER'
  );

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  -- 7. Next entry number for this player (authoritative source = tournament_entries).
  SELECT COALESCE(MAX(entry_no), 0) + 1 INTO v_entry_no
  FROM public.tournament_entries
  WHERE tournament_id = v_src.tournament_id AND player_id = v_player_id;

  -- 8. Draw a table with free capacity — NO WRITES YET.
  IF p_draw_mode = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (
      SELECT count(*) AS active_count FROM public.tournament_seats ts
      WHERE ts.table_id = tt.id AND ts.is_active = true
    ) c
    WHERE tt.tournament_id = v_src.tournament_id
      AND tt.status = 'active' AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
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
    WHERE tt.tournament_id = v_src.tournament_id
      AND tt.status = 'active' AND tt.table_id IS NOT NULL
      AND c.active_count < tt.max_seats
    ORDER BY c.active_count ASC, random()
    LIMIT 1;
  END IF;

  IF v_table_tour_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_table_available');
  END IF;

  -- 9. Random empty seat in that table — NO WRITES YET.
  SELECT s.n INTO v_seat_number
  FROM generate_series(1, v_max_seats) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tournament_seats ts
    WHERE ts.table_id = v_table_tour_id AND ts.seat_number = s.n AND ts.is_active = true
  )
  ORDER BY random()
  LIMIT 1;
  IF v_seat_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_table_available');
  END IF;

  -- 10. Claim the seat first. table_id = tournament_tables.id per live FK; on a
  --     concurrent claim the partial unique throws → seat_occupied, nothing else written.
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, status, assigned_by, assigned_at
    ) VALUES (
      v_src.tournament_id, v_player_id, v_entry_no, v_table_tour_id, v_seat_number,
      v_starting_stack, true, v_name, 'active', v_actor_user_id, now()
    ) RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  -- 11. New confirmed cash registration (re-entry payment → revenue + audit).
  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('REENTRY-%s', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    BEGIN
      INSERT INTO public.tournament_registrations (
        tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay,
        reference_code, status, committed_at, confirmed_at, confirmed_by
      ) VALUES (
        v_src.tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee,
        v_ref_code, 'confirmed', now(), now(), v_actor_user_id
      ) RETURNING id INTO v_reg_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- 12. New entry (seated, entry_no incremented, source preserved) + link the seat.
  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    v_src.tournament_id, v_reg_id, v_player_id, v_entry_no, v_source,
    'seated', v_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- 13. Receipt (retry code on collision).
  v_attempt := 0;
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
        v_src.tournament_id, v_reg_id, v_entry_id, v_player_id, v_name,
        v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', v_src.tournament_id, 'player_id', v_player_id,
          'table_number', v_table_number, 'seat_number', v_seat_number,
          'reentry', true, 'entry_no', v_entry_no),
        'initial', 'issued', v_actor_user_id
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- 14. Audit history (draw_type must be one of initial/manual_move/final_table_redraw;
  --     reason is free text). to_seat_number is NOT NULL.
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    v_src.tournament_id, v_entry_id, v_player_id,
    v_table_game_id, v_table_number, v_seat_number,
    're_entry', 'initial', v_actor_user_id,
    jsonb_build_object('draw_mode', p_draw_mode, 'registration_id', v_reg_id,
      'buy_in', p_buy_in, 'fee', p_fee, 'entry_no', v_entry_no, 'from_entry_id', p_entry_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg_id,
    'entry_id', v_entry_id,
    'seat_id', v_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code,
    'reference_code', v_ref_code,
    'table_id', v_table_game_id,
    'table_number', v_table_number,
    'seat_number', v_seat_number,
    'display_name', v_name,
    'entry_no', v_entry_no,
    'starting_stack', v_starting_stack
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reenter_tournament_player(UUID, BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reenter_tournament_player(UUID, BIGINT, BIGINT, TEXT) TO authenticated;
