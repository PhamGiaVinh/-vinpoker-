-- ============================================================================
-- Floor Table Ops Phase A1 — close_tournament_table RPC  (SOURCE-ONLY, NOT APPLIED)
-- ============================================================================
-- Break a table: re-draw the CLOSED table's players ONLY into empty seats at the
-- other active tables, then close it. Owner-locked behaviour (#233):
--   * scope = broken-table players only (others never move)
--   * fill  = random order (fairness) + shortest-table-first (balance) [redraw_balanced]
--   * not enough empty seats → BLOCK (insufficient_capacity); never auto-open
--   * atomic: any failure rolls the whole break back
--   * old receipts superseded, new receipts issued; history reason 'table_break_redraw'
-- Actor = auth.uid() ONLY. Owner/cashier gate. Per-move logic mirrors move_player_seat.
--
-- Seat conventions (live drift — handle BOTH): tournament_seats.table_id may be the
-- tournament_tables.id (move-created) OR the game_tables.id (seed/older). Occupancy &
-- mover lookup match `table_id IN (tt.id, tt.table_id)`. New seats are written with
-- tournament_tables.id (the move_player_seat convention).
--
-- ROLLBACK: DROP FUNCTION public.close_tournament_table(uuid, text, text);
-- Controlled apply only. NO supabase db push, NO deploy_db, NO schema_migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_tournament_table(
  p_tournament_table_id  UUID,
  p_draw_mode            TEXT DEFAULT 'redraw_balanced',  -- 'redraw_balanced' | 'fill_lowest_table'
  p_reason               TEXT DEFAULT 'table_break'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       UUID := auth.uid();
  v_authorized  BOOLEAN;
  v_tour        RECORD;
  v_close       RECORD;
  v_need        INTEGER;
  v_have        INTEGER;
  v_m           RECORD;
  v_h           RECORD;
  v_new_seat_id UUID;
  v_receipt_id  UUID;
  v_receipt_code TEXT;
  v_attempt     INTEGER;
  v_moves       JSONB := '[]'::jsonb;
BEGIN
  -- 0. Actor from auth.uid() ONLY.
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_draw_mode NOT IN ('redraw_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  -- 1. Closing table + its tournament; lock the tournament (serialize floor ops).
  SELECT tt.id, tt.tournament_id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_close
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;

  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_close.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 2. Authorization: owner or club_cashier.
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor
    WHERE t.id = v_close.tournament_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 3. Movers = active, entry-backed seats at the closing table (either id convention).
  CREATE TEMP TABLE tmp_movers ON COMMIT DROP AS
  SELECT ts.id AS from_seat_id, ts.seat_number AS from_seat_number,
         ts.player_name, ts.chip_count,
         e.id AS entry_id, e.player_id, e.entry_no, e.registration_id
  FROM public.tournament_seats ts
  JOIN public.tournament_entries e ON e.id = ts.entry_id
  WHERE ts.tournament_id = v_close.tournament_id
    AND ts.is_active = true
    AND ts.table_id IN (v_close.id, v_close.table_id);

  v_need := (SELECT count(*) FROM tmp_movers);

  -- 4. Empty table → just close it (deactivate any orphan seats), no redraw.
  IF v_need = 0 THEN
    UPDATE public.tournament_seats SET is_active = false
    WHERE tournament_id = v_close.tournament_id AND is_active = true
      AND table_id IN (v_close.id, v_close.table_id);
    UPDATE public.tournament_tables SET status = 'closed' WHERE id = v_close.id;
    IF v_close.table_id IS NOT NULL THEN
      UPDATE public.game_tables SET status = 'closed' WHERE id = v_close.table_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'closed', true,
      'table_number', v_close.table_number, 'moved', '[]'::jsonb);
  END IF;

  -- 5. Holes = empty seats at OTHER active+linked tables; carry each table's occupancy.
  CREATE TEMP TABLE tmp_holes ON COMMIT DROP AS
  SELECT tt.id AS tt_id, tt.table_id AS game_id, tt.table_number, s.n AS seat_number,
         (SELECT count(*) FROM public.tournament_seats x
            WHERE x.is_active = true AND x.table_id IN (tt.id, tt.table_id))::int AS occ
  FROM public.tournament_tables tt
  CROSS JOIN LATERAL generate_series(1, tt.max_seats) AS s(n)
  WHERE tt.tournament_id = v_close.tournament_id
    AND tt.status = 'active' AND tt.table_id IS NOT NULL
    AND tt.id <> v_close.id
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_seats x
      WHERE x.is_active = true AND x.seat_number = s.n
        AND x.table_id IN (tt.id, tt.table_id)
    );

  v_have := (SELECT count(*) FROM tmp_holes);

  -- 6. Capacity precheck — no writes yet, so a plain RETURN is the "block" (no auto-open).
  IF v_have < v_need THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity',
      'need', v_need, 'have', v_have);
  END IF;

  -- 7. Redraw each mover (random order). Per move mirrors move_player_seat.
  FOR v_m IN SELECT * FROM tmp_movers ORDER BY random() LOOP
    -- pick a hole + claim its seat; on a concurrent grab, drop that hole and retry.
    LOOP
      IF p_draw_mode = 'fill_lowest_table' THEN
        SELECT * INTO v_h FROM tmp_holes ORDER BY table_number ASC, seat_number ASC LIMIT 1;
      ELSE
        SELECT * INTO v_h FROM tmp_holes ORDER BY occ ASC, random() LIMIT 1;  -- shortest-table-first
      END IF;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'redraw_no_seat';  -- rolls the whole break back
      END IF;

      BEGIN
        UPDATE public.tournament_seats SET status = 'moved', is_active = false
        WHERE id = v_m.from_seat_id;
        INSERT INTO public.tournament_seats (
          tournament_id, player_id, entry_number, table_id, seat_number,
          chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
        ) VALUES (
          v_close.tournament_id, v_m.player_id, v_m.entry_no, v_h.tt_id, v_h.seat_number,
          v_m.chip_count, true, v_m.player_name, v_m.entry_id, 'active', v_actor, now()
        ) RETURNING id INTO v_new_seat_id;
        EXIT;  -- claimed
      EXCEPTION WHEN unique_violation THEN
        DELETE FROM tmp_holes WHERE tt_id = v_h.tt_id AND seat_number = v_h.seat_number;
        -- subtransaction rolled back the old-seat UPDATE too; retry with another hole.
      END;
    END LOOP;

    -- entry → game_tables.id; receipts/history → game_tables.id (live convention)
    UPDATE public.tournament_entries
    SET table_id = v_h.game_id, seat_number = v_h.seat_number,
        seat_id = v_new_seat_id, current_stack = v_m.chip_count
    WHERE id = v_m.entry_id;

    UPDATE public.seat_draw_receipts SET status = 'superseded', cancelled_at = now()
    WHERE entry_id = v_m.entry_id AND status IN ('issued', 'printed');

    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      v_receipt_code := format('T%s-S%s-%s',
        COALESCE(v_h.table_number::text, '?'), v_h.seat_number,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
      BEGIN
        INSERT INTO public.seat_draw_receipts (
          tournament_id, registration_id, entry_id, player_id, display_name,
          table_id, table_number, seat_id, seat_number, receipt_code,
          qr_payload, draw_type, status, issued_by
        ) VALUES (
          v_close.tournament_id, v_m.registration_id, v_m.entry_id, v_m.player_id, v_m.player_name,
          v_h.game_id, v_h.table_number, v_new_seat_id, v_h.seat_number, v_receipt_code,
          jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_m.entry_id,
            'tournament_id', v_close.tournament_id, 'player_id', v_m.player_id,
            'table_number', v_h.table_number, 'seat_number', v_h.seat_number, 'reason', 'table_break'),
          'table_break', 'issued', v_actor
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
      v_close.tournament_id, v_m.entry_id, v_m.player_id,
      v_close.table_id, v_close.table_number, v_m.from_seat_number,
      v_h.game_id, v_h.table_number, v_h.seat_number,
      'table_break_redraw', 'table_break', v_actor,
      jsonb_build_object('from_tournament_table_id', v_close.id, 'to_tournament_table_id', v_h.tt_id,
        'chip_count_at_move', v_m.chip_count, 'draw_mode', p_draw_mode, 'close_reason', p_reason)
    );

    -- consume the hole; the destination table just gained a player → rebalance its remaining holes.
    DELETE FROM tmp_holes WHERE tt_id = v_h.tt_id AND seat_number = v_h.seat_number;
    UPDATE tmp_holes SET occ = occ + 1 WHERE tt_id = v_h.tt_id;

    v_moves := v_moves || jsonb_build_object(
      'player_name', v_m.player_name,
      'from_seat', v_m.from_seat_number,
      'to_table_number', v_h.table_number,
      'to_seat_number', v_h.seat_number,
      'receipt_code', v_receipt_code
    );
  END LOOP;

  -- 8. Deactivate any remaining (orphan, entry-less) active seats at the closing table.
  UPDATE public.tournament_seats SET is_active = false
  WHERE tournament_id = v_close.tournament_id AND is_active = true
    AND table_id IN (v_close.id, v_close.table_id);

  -- 9. Close the table (tournament_tables + linked game_tables).
  UPDATE public.tournament_tables SET status = 'closed' WHERE id = v_close.id;
  IF v_close.table_id IS NOT NULL THEN
    UPDATE public.game_tables SET status = 'closed' WHERE id = v_close.table_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'closed', true,
    'table_number', v_close.table_number,
    'moved_count', v_need,
    'moved', v_moves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) TO authenticated;
