-- PATCH 4 / STAGE C — shared re-entry seat helper + reenter refactor + confirm_reentry_and_assign_seat.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched. Apply AFTER STAGE B
-- (20261122000000 — needs tournament_registrations.source_entry_id).
--
-- WHY: online re-entry is pay-first — a PENDING re-entry reg (STAGE B) must, on payment, become confirmed +
-- get a seat. This adds confirm_reentry_and_assign_seat (mirrors confirm_registration_and_assign_seat's guards
-- for the pay-first shape) and, to avoid TWO forks of the proven seat-draw, extracts the seat draw/claim/
-- entry/receipt/history into ONE shared helper `_assign_reentry_seat` that BOTH the existing cashier
-- reenter_tournament_player AND the new confirm call. No copy-paste of seat logic → no drift.
--
-- confirm_registration_and_assign_seat (the INITIAL path, 20260811000000) is NOT touched.
-- Idempotent: CREATE OR REPLACE FUNCTION; explicit REVOKE/GRANT.
-- Rollback: see docs/sepay/ runbook — DROP confirm_reentry_and_assign_seat + _assign_reentry_seat and
--   CREATE OR REPLACE reenter_tournament_player back to its 20260901000001 body.

-- ============================================================================
-- 1. Shared seat-draw helper. INTERNAL ONLY (REVOKEd from everyone): the two SECURITY DEFINER callers
--    (owned by the migration role) can invoke it; a direct authenticated/anon call is denied. It does NOT
--    gate auth or re-validate state — the CALLERS do that before invoking it. It draws+claims a seat, creates
--    the new seated entry (entry_no = MAX+1, source preserved from the busted entry), links the seat, issues a
--    receipt, and writes audit history. Returns the same shape the confirm fns return on success, or
--    {ok:false,error:'no_table_available'|'no_seat_available'|'seat_occupied'} with NOTHING else written.
-- ============================================================================
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
  -- source channel preserved from the busted entry
  SELECT source INTO v_source FROM public.tournament_entries WHERE id = p_source_entry_id;
  v_source := COALESCE(v_source, 'online');

  -- display name (profile → prior receipt → prior seat → fallback)
  v_name := COALESCE(
    (SELECT NULLIF(TRIM(p.display_name), '') FROM public.profiles p WHERE p.user_id = p_player_id),
    (SELECT sdr.display_name FROM public.seat_draw_receipts sdr WHERE sdr.entry_id = p_source_entry_id ORDER BY sdr.issued_at DESC LIMIT 1),
    (SELECT ts.player_name FROM public.tournament_seats ts WHERE ts.entry_id = p_source_entry_id ORDER BY ts.assigned_at DESC NULLS LAST LIMIT 1),
    'PLAYER'
  );

  -- next entry number for this player
  SELECT COALESCE(MAX(entry_no), 0) + 1 INTO v_entry_no
  FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  -- draw a table with free capacity — NO WRITES YET
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

  -- random empty seat in that table — NO WRITES YET
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

  -- claim the seat first (concurrent claim → partial unique throws → seat_occupied, nothing else written)
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

  -- new seated entry (entry_no incremented, source preserved) + link the seat
  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, p_registration_id, p_player_id, v_entry_no, v_source,
    'seated', p_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- receipt (retry code on collision)
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

  -- audit history (reason='re_entry')
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

-- INTERNAL ONLY: deny direct callers; the SECURITY DEFINER callers (owned by the migration role) invoke it.
REVOKE ALL ON FUNCTION public._assign_reentry_seat(uuid, uuid, uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 2. Refactor reenter_tournament_player to CALL the shared helper (no forked seat logic). Its gates,
--    auth, and cash-reg creation are UNCHANGED; only the old steps 8-14 are replaced by the helper call
--    (+ undo the just-created reg if the draw fails, so we never orphan a confirmed cash reg without a seat).
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
  v_src            RECORD;
  v_tour           RECORD;
  v_player_id      UUID;
  v_entry_no       INTEGER;
  v_reg_id         UUID;
  v_ref_code       TEXT;
  v_starting_stack INTEGER;
  v_res            JSONB;
  v_attempt        INTEGER := 0;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
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

  SELECT * INTO v_src FROM public.tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  IF v_src.status <> 'busted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_reenterable', 'status', v_src.status);
  END IF;
  v_player_id := v_src.player_id;

  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_src.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

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

  PERFORM 1 FROM public.tournament_seats
  WHERE tournament_id = v_src.tournament_id AND player_id = v_player_id AND is_active = true;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_already_active');
  END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  -- new confirmed cash registration (re-entry payment → revenue + audit); retry ref on collision
  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('REENTRY-%s', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    BEGIN
      INSERT INTO public.tournament_registrations (
        tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay,
        reference_code, status, committed_at, confirmed_at, confirmed_by, source_entry_id
      ) VALUES (
        v_src.tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee,
        v_ref_code, 'confirmed', now(), now(), v_actor_user_id, p_entry_id
      ) RETURNING id INTO v_reg_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- shared draw/seat/entry/receipt/history
  v_res := public._assign_reentry_seat(
    v_src.tournament_id, v_player_id, p_entry_id, v_reg_id, v_actor_user_id, p_draw_mode, v_starting_stack);

  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    -- draw failed (no_table/no_seat/seat_occupied) → undo the reg we just created (nothing else was written)
    DELETE FROM public.tournament_registrations WHERE id = v_reg_id;
    RETURN v_res;
  END IF;

  RETURN v_res || jsonb_build_object('registration_id', v_reg_id, 'reference_code', v_ref_code);
END;
$$;

REVOKE ALL ON FUNCTION public.reenter_tournament_player(UUID, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reenter_tournament_player(UUID, BIGINT, BIGINT, TEXT) TO authenticated;

-- ============================================================================
-- 3. confirm_reentry_and_assign_seat — pay-first re-entry confirm. Mirrors confirm_registration_and_assign_seat
--    guards 2.4 (p_actor = auth.uid()) + 2.5 (owner/cashier) so the SePay system-bot impersonation in settle
--    works identically. Confirms ONLY a PENDING re-entry reg (source_entry_id NOT NULL) and RE-VALIDATES the
--    re-entry state at confirm time. Draws the seat via the shared helper BEFORE flipping the reg → confirmed,
--    so a draw failure leaves the reg pending (settle flags it, money never lost, no orphan-confirmed reg).
--    Amount/reference exactness is enforced UPSTREAM by settle's exact-match gate (same as the initial path —
--    confirm_registration_and_assign_seat does not re-check the amount either).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_reentry_and_assign_seat(
  p_registration_id uuid,
  p_actor_user_id   uuid,
  p_draw_mode       text DEFAULT 'random_balanced'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg  RECORD;
  v_tour RECORD;
  v_src  RECORD;
  v_e    RECORD;
  v_res  jsonb;
  v_lvl  int;
  v_close int;
BEGIN
  -- 1. Lock the registration.
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'registration_not_found'); END IF;

  -- must be a re-entry reg (source_entry_id set)
  IF v_reg.source_entry_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_a_reentry'); END IF;

  -- 2.4 actor = auth.uid()  +  2.5 owner/cashier  (identical predicates to confirm_registration_and_assign_seat)
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  PERFORM 1 FROM public.tournaments t
   WHERE t.id = v_reg.tournament_id
     AND (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = t.club_id AND c.owner_id = p_actor_user_id)
          OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = t.club_id AND cc.user_id = p_actor_user_id));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;

  -- 3. Idempotency: already confirmed AND already produced an entry → return it (no double-seat).
  IF v_reg.status = 'confirmed' THEN
    SELECT te.id AS entry_id, te.seat_id, te.seat_number,
           sdr.id AS receipt_id, sdr.receipt_code, sdr.table_number, sdr.display_name
    INTO v_e
    FROM public.tournament_entries te
    LEFT JOIN public.seat_draw_receipts sdr ON sdr.entry_id = te.id AND sdr.draw_type = 'initial'
    WHERE te.registration_id = p_registration_id
    ORDER BY te.created_at ASC LIMIT 1;
    IF FOUND AND v_e.entry_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'registration_id', p_registration_id,
        'entry_id', v_e.entry_id, 'seat_id', v_e.seat_id, 'receipt_id', v_e.receipt_id,
        'receipt_code', v_e.receipt_code, 'table_number', v_e.table_number,
        'seat_number', v_e.seat_number, 'display_name', v_e.display_name);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'already_confirmed_no_entry');
  END IF;

  -- 4. Must be pending.
  IF v_reg.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_reg.status);
  END IF;

  -- 5. Lock tournament + must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_reg.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 6. Re-entry window still open (late-reg not closed).
  v_lvl := v_tour.current_level;
  v_close := COALESCE(v_tour.late_reg_close_level, 6);
  IF v_lvl IS NOT NULL AND v_lvl > v_close THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reentry_window_closed',
      'current_level', v_lvl, 'late_reg_close_level', v_close);
  END IF;

  -- 7. Source entry: same player + tournament, and still busted (floor-removed).
  SELECT * INTO v_src FROM public.tournament_entries WHERE id = v_reg.source_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'source_entry_not_found'); END IF;
  IF v_src.player_id IS DISTINCT FROM v_reg.player_id OR v_src.tournament_id IS DISTINCT FROM v_reg.tournament_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source_entry_mismatch');
  END IF;
  IF v_src.status <> 'busted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_reenterable', 'status', v_src.status);
  END IF;

  -- 8. One active seat per player.
  PERFORM 1 FROM public.tournament_seats
   WHERE tournament_id = v_reg.tournament_id AND player_id = v_reg.player_id AND is_active = true;
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'player_already_active'); END IF;

  -- 9. Draw + seat via the SHARED helper. Only flip the reg → confirmed if the draw succeeded.
  v_res := public._assign_reentry_seat(
    v_reg.tournament_id, v_reg.player_id, v_reg.source_entry_id, p_registration_id,
    p_actor_user_id, p_draw_mode, COALESCE(v_tour.starting_stack, 0));
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN v_res;  -- no_table/no_seat/seat_occupied → reg stays pending; settle flags it (money not lost)
  END IF;

  UPDATE public.tournament_registrations
    SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor_user_id
    WHERE id = p_registration_id;

  RETURN v_res || jsonb_build_object('registration_id', p_registration_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_reentry_and_assign_seat(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirm_reentry_and_assign_seat(uuid, uuid, text) TO authenticated, service_role;
