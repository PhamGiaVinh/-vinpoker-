-- ============================================================================
-- FIX (fix-forward) — create_offline_buyin_and_seat: draw BEFORE any write
-- ============================================================================
-- SOURCE-ONLY. Supersedes the body shipped in 20260826000002. That version
-- INSERTed the confirmed tournament_registrations row BEFORE the table/seat draw
-- and used RETURN (not RAISE) on no_table_available / no_seat_available — leaving
-- an ORPHAN confirmed registration (counted as revenue) with no seat on those
-- paths. This CREATE OR REPLACE reorders so:
--   validate → lock tournament → auth → DRAW table+seat (return, no writes) →
--   CLAIM seat (unique_violation → seat_occupied, no writes elsewhere) →
--   registration → entry → link → receipt → history.
-- Every failure path now leaves NO orphan. Security identical: actor = auth.uid()
-- only (no client actor id), SECURITY DEFINER, search_path public, owner/cashier gate.
-- Apply 20260826000001 (source CHECK) + THIS file; 20260826000002 may be skipped
-- in the controlled live apply (a future db push runs 000002 then 000003 → ends correct).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_offline_buyin_and_seat(
  p_tournament_id UUID,
  p_player_name   TEXT,
  p_buy_in        BIGINT,
  p_fee           BIGINT,
  p_draw_mode     TEXT DEFAULT 'random_balanced'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id  UUID := auth.uid();
  v_authorized     BOOLEAN;
  v_tour           RECORD;
  v_name           TEXT := NULLIF(TRIM(p_player_name), '');
  v_player_id      UUID := gen_random_uuid();
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

  -- 1. Validate inputs (before any write).
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_player_name');
  END IF;
  IF p_buy_in IS NULL OR p_buy_in <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_buy_in');
  END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_fee');
  END IF;
  IF p_draw_mode NOT IN ('random_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  -- 2. Lock tournament; must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 3. Authorization (owner or club_cashier).
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = p_tournament_id
      AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  -- 4. Draw a table with free capacity — NO WRITES YET.
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
    ORDER BY c.active_count ASC, random()
    LIMIT 1;
  END IF;

  IF v_table_tour_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_table_available');
  END IF;

  -- 5. Random empty seat in that table — NO WRITES YET.
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

  -- 6. CLAIM the seat first (entry_id linked in step 8). On a concurrent claim the
  --    seat unique index throws → caught → seat_occupied, with NOTHING else written
  --    (no orphan registration/entry). table_id = tournament_tables.id per live FK.
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, status, assigned_by, assigned_at
    ) VALUES (
      p_tournament_id, v_player_id, 1, v_table_tour_id, v_seat_number,
      v_starting_stack, true, v_name, 'active', v_actor_user_id, now()
    ) RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  -- 7. Confirmed cash registration (audit + revenue). Unique ref_code retried.
  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('CASH-%s', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    BEGIN
      INSERT INTO public.tournament_registrations (
        tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay,
        reference_code, status, committed_at, confirmed_at, confirmed_by
      ) VALUES (
        p_tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee,
        v_ref_code, 'confirmed', now(), now(), v_actor_user_id
      ) RETURNING id INTO v_reg_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- 8. Entry (offline, seated) + link the seat onto it.
  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, v_reg_id, v_player_id, 1, 'offline',
    'seated', v_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- 9. Receipt (retry code on collision).
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
        p_tournament_id, v_reg_id, v_entry_id, v_player_id, v_name,
        v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', v_player_id,
          'table_number', v_table_number, 'seat_number', v_seat_number, 'source', 'offline'),
        'initial', 'issued', v_actor_user_id
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- 10. Audit history.
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    p_tournament_id, v_entry_id, v_player_id,
    v_table_game_id, v_table_number, v_seat_number,
    'offline_buyin', 'initial', v_actor_user_id,
    jsonb_build_object('draw_mode', p_draw_mode, 'registration_id', v_reg_id,
      'buy_in', p_buy_in, 'fee', p_fee, 'source', 'offline')
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
    'starting_stack', v_starting_stack
  );
END;
$$;

-- Least-privilege: PUBLIC (and thus anon) get EXECUTE by default on CREATE FUNCTION.
-- Revoke so only authenticated callers reach the auth.uid()/owner-cashier gate
-- (matches the confirm_registration_and_assign_seat P0 guard hardening).
REVOKE EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(UUID, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(UUID, TEXT, BIGINT, BIGINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(UUID, TEXT, BIGINT, BIGINT, TEXT) TO authenticated;
