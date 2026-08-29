-- ============================================================================
-- Close-table containment: never infer an empty table from entry-backed movers.
-- SOURCE-ONLY. Owner-controlled apply only; do not use supabase db push.
--
-- This supersedes the live-drifted close_tournament_table body without editing
-- 20260914000000_close_tournament_table.sql, whose future filename may already
-- have been manually applied outside schema_migrations.
--
-- Rollback: CREATE OR REPLACE the previously verified function body in a new,
-- owner-approved migration. Do not restore the unsafe bulk-deactivate branch.
-- ============================================================================

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
  v_total_active_seats INTEGER := 0;
  v_entry_backed_active_seats INTEGER := 0;
  v_unlinked_active_seats INTEGER := 0;
  v_active_chip_total NUMERIC := 0;
  v_active_count_before INTEGER := 0;
  v_active_chip_total_before NUMERIC := 0;
  v_active_count_after INTEGER := 0;
  v_active_chip_total_after NUMERIC := 0;
  v_need INTEGER := 0;
  v_have INTEGER := 0;
  v_source_active_after INTEGER := 0;
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

  -- Serialize all floor operations within this tournament before reading the
  -- source table and every active seat used for capacity/conservation checks.
  SELECT tt.id, tt.tournament_id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_close
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;

  SELECT *
  INTO v_tour
  FROM public.tournaments
  WHERE id = v_close.tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor
    WHERE t.id = v_close.tournament_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  )
  INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Lock the complete active-seat snapshot for the tournament. This prevents a
  -- concurrent move from changing capacity or chip conservation mid-close.
  PERFORM 1
  FROM public.tournament_seats ts
  WHERE ts.tournament_id = v_close.tournament_id
    AND ts.is_active = true
  FOR UPDATE;

  CREATE TEMP TABLE tmp_close_active ON COMMIT DROP AS
  SELECT
    ts.id,
    ts.tournament_id,
    ts.table_id,
    ts.seat_number,
    ts.player_id,
    ts.player_name,
    ts.entry_id,
    ts.chip_count,
    e.id AS valid_entry_id,
    e.player_id AS entry_player_id,
    e.entry_no,
    e.registration_id
  FROM public.tournament_seats ts
  LEFT JOIN public.tournament_entries e
    ON e.id = ts.entry_id
   AND e.tournament_id = ts.tournament_id
  WHERE ts.tournament_id = v_close.tournament_id
    AND ts.is_active = true;

  SELECT
    count(*)::INTEGER,
    COALESCE(sum(COALESCE(chip_count, 0)), 0)
  INTO v_active_count_before, v_active_chip_total_before
  FROM tmp_close_active;

  SELECT
    count(*)::INTEGER,
    (count(*) FILTER (WHERE valid_entry_id IS NOT NULL))::INTEGER,
    (count(*) FILTER (WHERE valid_entry_id IS NULL))::INTEGER,
    COALESCE(sum(COALESCE(chip_count, 0)), 0)
  INTO
    v_total_active_seats,
    v_entry_backed_active_seats,
    v_unlinked_active_seats,
    v_active_chip_total
  FROM tmp_close_active
  WHERE table_id IN (v_close.id, v_close.table_id);

  -- A table is empty only when it has no active seats at all. Entry-backed mover
  -- count is intentionally never used as an empty-table proxy.
  IF v_total_active_seats > 0 AND v_unlinked_active_seats > 0 THEN
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

  IF v_close.status = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_already_closed', 'table_id', v_close.id);
  END IF;

  IF v_total_active_seats = 0 THEN
    UPDATE public.tournament_tables
    SET status = 'closed'
    WHERE id = v_close.id;
    IF v_close.table_id IS NOT NULL THEN
      UPDATE public.game_tables
      SET status = 'inactive'
      WHERE id = v_close.table_id;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'closed', true,
      'table_number', v_close.table_number,
      'moved_count', 0,
      'moved', '[]'::jsonb,
      'total_active_seats', 0,
      'entry_backed_active_seats', 0,
      'unlinked_active_seats', 0,
      'active_chip_total', 0
    );
  END IF;

  CREATE TEMP TABLE tmp_movers ON COMMIT DROP AS
  SELECT *
  FROM tmp_close_active
  WHERE table_id IN (v_close.id, v_close.table_id);

  v_need := (SELECT count(*)::INTEGER FROM tmp_movers);
  IF EXISTS (
    SELECT 1
    FROM tmp_movers
    GROUP BY valid_entry_id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'duplicate_source_entry';
  END IF;

  CREATE TEMP TABLE tmp_unchanged_active ON COMMIT DROP AS
  SELECT id, table_id, seat_number, chip_count, entry_id, player_id
  FROM tmp_close_active
  WHERE table_id NOT IN (v_close.id, v_close.table_id);

  CREATE TEMP TABLE tmp_holes ON COMMIT DROP AS
  SELECT
    tt.id AS tt_id,
    tt.table_id AS game_id,
    tt.table_number,
    s.n AS seat_number,
    (
      SELECT count(*)
      FROM tmp_close_active x
      WHERE x.table_id IN (tt.id, tt.table_id)
    )::INTEGER AS occ
  FROM public.tournament_tables tt
  CROSS JOIN LATERAL generate_series(1, tt.max_seats) AS s(n)
  WHERE tt.tournament_id = v_close.tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
    AND tt.id <> v_close.id
    AND NOT EXISTS (
      SELECT 1
      FROM tmp_close_active x
      WHERE x.table_id IN (tt.id, tt.table_id)
        AND x.seat_number = s.n
    );

  v_have := (SELECT count(*)::INTEGER FROM tmp_holes);
  IF v_have < v_need THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity', 'need', v_need, 'have', v_have);
  END IF;

  FOR v_m IN SELECT * FROM tmp_movers ORDER BY random() LOOP
    LOOP
      IF p_draw_mode = 'fill_lowest_table' THEN
        SELECT * INTO v_h FROM tmp_holes ORDER BY table_number ASC, seat_number ASC LIMIT 1;
      ELSE
        SELECT * INTO v_h FROM tmp_holes ORDER BY occ ASC, random() LIMIT 1;
      END IF;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'redraw_no_seat';
      END IF;

      BEGIN
        UPDATE public.tournament_seats
        SET status = 'moved', is_active = false
        WHERE id = v_m.id
          AND is_active = true;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'source_seat_not_active';
        END IF;

        INSERT INTO public.tournament_seats (
          tournament_id, player_id, entry_number, table_id, seat_number,
          chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
        ) VALUES (
          v_close.tournament_id, v_m.entry_player_id, v_m.entry_no, v_h.tt_id, v_h.seat_number,
          v_m.chip_count, true, v_m.player_name, v_m.valid_entry_id, 'active', v_actor, now()
        )
        RETURNING id INTO v_new_seat_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        DELETE FROM tmp_holes WHERE tt_id = v_h.tt_id AND seat_number = v_h.seat_number;
      END;
    END LOOP;

    UPDATE public.tournament_entries
    SET table_id = v_h.game_id,
        seat_number = v_h.seat_number,
        seat_id = v_new_seat_id,
        current_stack = v_m.chip_count
    WHERE id = v_m.valid_entry_id
      AND tournament_id = v_close.tournament_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'entry_changed_during_close';
    END IF;

    UPDATE public.seat_draw_receipts
    SET status = 'superseded', cancelled_at = now()
    WHERE entry_id = v_m.valid_entry_id
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
          v_close.tournament_id, v_m.registration_id, v_m.valid_entry_id, v_m.entry_player_id, v_m.player_name,
          v_h.game_id, v_h.table_number, v_new_seat_id, v_h.seat_number, v_receipt_code,
          jsonb_build_object(
            'v', 1,
            'receipt_code', v_receipt_code,
            'entry_id', v_m.valid_entry_id,
            'tournament_id', v_close.tournament_id,
            'player_id', v_m.entry_player_id,
            'table_number', v_h.table_number,
            'seat_number', v_h.seat_number,
            'reason', 'table_break'
          ),
          'manual_move', 'issued', v_actor
        )
        RETURNING id INTO v_receipt_id;
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
      v_close.tournament_id, v_m.valid_entry_id, v_m.entry_player_id,
      v_close.table_id, v_close.table_number, v_m.seat_number,
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

    DELETE FROM tmp_holes WHERE tt_id = v_h.tt_id AND seat_number = v_h.seat_number;
    UPDATE tmp_holes SET occ = occ + 1 WHERE tt_id = v_h.tt_id;

    v_moves := v_moves || jsonb_build_object(
      'player_name', v_m.player_name,
      'from_seat', v_m.seat_number,
      'to_table_number', v_h.table_number,
      'to_seat_number', v_h.seat_number,
      'receipt_code', v_receipt_code
    );
  END LOOP;

  -- Conservation and isolation checks run before either table status changes.
  SELECT count(*)::INTEGER, COALESCE(sum(COALESCE(chip_count, 0)), 0)
  INTO v_active_count_after, v_active_chip_total_after
  FROM public.tournament_seats
  WHERE tournament_id = v_close.tournament_id
    AND is_active = true;
  IF v_active_count_after <> v_active_count_before
     OR v_active_chip_total_after <> v_active_chip_total_before THEN
    RAISE EXCEPTION 'close_table_conservation_failed';
  END IF;

  SELECT count(*)::INTEGER
  INTO v_source_active_after
  FROM public.tournament_seats
  WHERE tournament_id = v_close.tournament_id
    AND is_active = true
    AND table_id IN (v_close.id, v_close.table_id);
  IF v_source_active_after <> 0 THEN
    RAISE EXCEPTION 'source_table_still_has_active_seats';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_movers m
    LEFT JOIN public.tournament_seats after_move
      ON after_move.tournament_id = v_close.tournament_id
     AND after_move.entry_id = m.valid_entry_id
     AND after_move.is_active = true
    GROUP BY m.valid_entry_id
    HAVING count(after_move.id) <> 1
  ) THEN
    RAISE EXCEPTION 'mover_identity_not_conserved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_unchanged_active before_move
    LEFT JOIN public.tournament_seats after_move ON after_move.id = before_move.id
    WHERE after_move.id IS NULL
       OR after_move.is_active IS DISTINCT FROM true
       OR after_move.table_id IS DISTINCT FROM before_move.table_id
       OR after_move.seat_number IS DISTINCT FROM before_move.seat_number
       OR after_move.chip_count IS DISTINCT FROM before_move.chip_count
       OR after_move.entry_id IS DISTINCT FROM before_move.entry_id
       OR after_move.player_id IS DISTINCT FROM before_move.player_id
  ) THEN
    RAISE EXCEPTION 'other_active_seat_changed';
  END IF;

  UPDATE public.tournament_tables
  SET status = 'closed'
  WHERE id = v_close.id;
  IF v_close.table_id IS NOT NULL THEN
    UPDATE public.game_tables
    SET status = 'inactive'
    WHERE id = v_close.table_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'closed', true,
    'table_number', v_close.table_number,
    'moved_count', v_need,
    'moved', v_moves,
    'total_active_seats', v_total_active_seats,
    'entry_backed_active_seats', v_entry_backed_active_seats,
    'unlinked_active_seats', 0,
    'active_chip_total', v_active_chip_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tournament_table(UUID, TEXT, TEXT) TO authenticated;
