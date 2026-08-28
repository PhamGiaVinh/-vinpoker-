-- Forward-only reconciliation for close_tournament_table(uuid,text,text).
--
-- The historical 20270101000000 containment source was never represented in
-- the live migration ledger and is not the canonical body. The live function
-- still matches 20261240000000. This migration deliberately preserves that
-- live business behavior while adding only the owner-approved table-local
-- safety guards. It does not repair ledger history or add PR2A tournament
-- locking.
--
-- Rollback: restore the exact pre-apply pg_get_functiondef, owner, and grants
-- captured by docs/floor/CLOSE_TABLE_CANONICAL_APPLY_RUNBOOK.md. Rollback is a
-- forward owner-controlled action; never delete or repair ledger history.

BEGIN;

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
  v_history_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER;
  v_moves JSONB := '[]'::jsonb;
  v_active_hand_id UUID;
  v_total_active_seats INTEGER := 0;
  v_entry_backed_active_seats INTEGER := 0;
  v_unlinked_active_seats INTEGER := 0;
  v_active_chip_total BIGINT := 0;
  v_mover_chip_total_before BIGINT := 0;
  v_mover_chip_total_after BIGINT := 0;
  v_mover_active_count_after INTEGER := 0;
  v_mover_distinct_entry_count INTEGER := 0;
  v_result_count INTEGER := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_draw_mode NOT IN ('redraw_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  -- Match the existing mode/start/bust seam: canonical table row first, then
  -- tournament row, then the shared table advisory key.
  SELECT tt.id, tt.tournament_id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_close
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
  FOR UPDATE;
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

  PERFORM pg_advisory_xact_lock(
    hashtext(v_tour.id::text),
    hashtext(v_close.id::text)
  );

  -- Re-read after the shared lock. The caller supplies tournament_tables.id;
  -- physical game-table identity is server-derived only.
  SELECT tt.id, tt.tournament_id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_close
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tour.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;

  IF v_close.status = 'closed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'closed', true,
      'already_closed', true,
      'table_number', v_close.table_number,
      'moved_count', 0,
      'moved', '[]'::jsonb
    );
  END IF;

  SELECT h.id
  INTO v_active_hand_id
  FROM public.tournament_hands h
  WHERE h.tournament_id = v_tour.id
    AND h.table_id IN (v_close.id, v_close.table_id)
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false
  ORDER BY h.hand_time DESC, h.id
  LIMIT 1
  FOR UPDATE;
  IF v_active_hand_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'table_has_active_hand',
      'hand_id', v_active_hand_id
    );
  END IF;

  PERFORM 1
  FROM public.tournament_seats ts
  WHERE ts.tournament_id = v_tour.id
    AND ts.is_active = true
    AND ts.table_id IN (v_close.id, v_close.table_id)
  FOR UPDATE;

  SELECT
    COUNT(*)::INTEGER,
    (COUNT(*) FILTER (WHERE ts.entry_id IS NOT NULL))::INTEGER,
    (COUNT(*) FILTER (WHERE ts.entry_id IS NULL))::INTEGER,
    COALESCE(SUM(ts.chip_count), 0)::BIGINT
  INTO
    v_total_active_seats,
    v_entry_backed_active_seats,
    v_unlinked_active_seats,
    v_active_chip_total
  FROM public.tournament_seats ts
  WHERE ts.tournament_id = v_tour.id
    AND ts.is_active = true
    AND ts.table_id IN (v_close.id, v_close.table_id);

  IF v_unlinked_active_seats > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'UNLINKED_ACTIVE_SEATS',
      'table_id', v_close.id,
      'total_active_seats', v_total_active_seats,
      'entry_backed_active_seats', v_entry_backed_active_seats,
      'unlinked_active_seats', v_unlinked_active_seats,
      'active_chip_total', v_active_chip_total
    );
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
  DROP TABLE IF EXISTS pg_temp._floor_close_results;

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

  CREATE TEMP TABLE _floor_close_results (
    entry_id UUID PRIMARY KEY,
    player_id UUID NOT NULL,
    chip_count INTEGER NOT NULL,
    new_seat_id UUID NOT NULL,
    new_game_table_id UUID NOT NULL,
    receipt_id UUID NOT NULL,
    history_id UUID NOT NULL
  ) ON COMMIT DROP;

  SELECT COUNT(*)::INTEGER, COALESCE(SUM(chip_count), 0)::BIGINT
  INTO v_need, v_mover_chip_total_before
  FROM _floor_close_movers;

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
      'ok', true,
      'closed', true,
      'already_closed', false,
      'table_number', v_close.table_number,
      'moved_count', 0,
      'moved', '[]'::jsonb
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
         )::INTEGER AS occ
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

  SELECT COUNT(*)::INTEGER INTO v_have FROM _floor_close_holes;
  IF v_have < v_need THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'insufficient_capacity',
      'need', v_need,
      'have', v_have
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
        IF v_attempt >= 5 THEN
          RAISE;
        END IF;
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
    ) RETURNING id INTO v_history_id;

    INSERT INTO _floor_close_results (
      entry_id, player_id, chip_count, new_seat_id, new_game_table_id,
      receipt_id, history_id
    ) VALUES (
      v_m.entry_id, v_m.player_id, v_m.chip_count, v_new_seat_id,
      v_h.game_id, v_receipt_id, v_history_id
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

  -- Operation-local conservation only. Do not inspect unrelated tournament
  -- seats until PR2A places every context writer under one tournament lock.
  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats
    WHERE tournament_id = v_tour.id
      AND is_active = true
      AND table_id IN (v_close.id, v_close.table_id)
  ) THEN
    RAISE EXCEPTION 'source_table_not_empty';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_result_count
  FROM _floor_close_results;
  IF v_result_count <> v_need THEN
    RAISE EXCEPTION 'close_table_result_count_mismatch';
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(DISTINCT ts.entry_id)::INTEGER,
    COALESCE(SUM(ts.chip_count), 0)::BIGINT
  INTO
    v_mover_active_count_after,
    v_mover_distinct_entry_count,
    v_mover_chip_total_after
  FROM public.tournament_seats ts
  JOIN _floor_close_movers m ON m.entry_id = ts.entry_id
  WHERE ts.tournament_id = v_tour.id
    AND ts.is_active = true;

  IF v_mover_active_count_after <> v_need
     OR v_mover_distinct_entry_count <> v_need
     OR v_mover_chip_total_after <> v_mover_chip_total_before THEN
    RAISE EXCEPTION 'close_table_mover_conservation_failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _floor_close_movers m
    LEFT JOIN _floor_close_results r ON r.entry_id = m.entry_id
    LEFT JOIN public.tournament_seats ts
      ON ts.id = r.new_seat_id
     AND ts.is_active = true
    LEFT JOIN public.tournament_entries e ON e.id = m.entry_id
    LEFT JOIN public.seat_draw_receipts dr ON dr.id = r.receipt_id
    LEFT JOIN public.seat_assignment_history ah ON ah.id = r.history_id
    WHERE r.entry_id IS NULL
       OR ts.id IS NULL
       OR ts.player_id IS DISTINCT FROM m.player_id
       OR ts.entry_number IS DISTINCT FROM m.entry_no
       OR ts.chip_count IS DISTINCT FROM m.chip_count
       OR ts.entry_id IS DISTINCT FROM m.entry_id
       OR e.player_id IS DISTINCT FROM m.player_id
       OR e.seat_id IS DISTINCT FROM ts.id
       OR e.table_id IS DISTINCT FROM r.new_game_table_id
       OR e.current_stack IS DISTINCT FROM m.chip_count
       OR dr.id IS NULL
       OR ah.id IS NULL
  ) THEN
    RAISE EXCEPTION 'close_table_mover_identity_failed';
  END IF;

  IF EXISTS (
    SELECT m.entry_id
    FROM _floor_close_movers m
    LEFT JOIN public.tournament_seats ts
      ON ts.entry_id = m.entry_id
     AND ts.is_active = true
    GROUP BY m.entry_id
    HAVING COUNT(ts.id) <> 1
  ) THEN
    RAISE EXCEPTION 'close_table_duplicate_active_entry';
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
    'already_closed', false,
    'table_number', v_close.table_number,
    'moved_count', v_need,
    'moved', v_moves
  );
END;
$$;

ALTER FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT)
TO authenticated, service_role;

COMMIT;
