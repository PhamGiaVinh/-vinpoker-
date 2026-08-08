BEGIN;

-- This forward migration depends on the PR2A shared tournament lock. Fail
-- closed instead of recreating a semantically different helper.
DO $$
BEGIN
  IF to_regprocedure('public.tracker_unified_ops_lock_tournament(uuid)') IS NULL THEN
    RAISE EXCEPTION 'tracker_unified_ops_lock_tournament(uuid) is required before writer containment'
      USING ERRCODE = '42883';
  END IF;
END;
$$;

-- Lock-only containment for the proven PR2A race. Business validation,
-- revision CAS, audit payload and response shape intentionally match the
-- current-main writer body.
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

  -- Join the V2 tournament-scoped lock before any context row lock. This
  -- serializes mode changes with start_tracker_hand_v2 for one tournament,
  -- while leaving different tournaments independent.
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);

  -- Preserve the current writer's table -> tournament row order after the
  -- shared lock, including its existing table-scoped advisory lock.
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

  -- Re-read after the existing table advisory lock so a concurrent mode
  -- change cannot make this decision from a stale row.
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
  v_lock_tournament_id UUID;
  v_lock_club_id UUID;
  v_lock_authorized BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_draw_mode NOT IN ('redraw_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  -- Resolve identity and authorization without row locks so an unauthorized
  -- caller cannot hold the shared tournament lock. The canonical locked reads
  -- below remain unchanged and revalidate the same business state.
  SELECT tt.tournament_id
  INTO v_lock_tournament_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;

  SELECT t.club_id
  INTO v_lock_club_id
  FROM public.tournaments t
  WHERE t.id = v_lock_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_lock_club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_lock_club_id)
  ) INTO v_lock_authorized;
  IF NOT v_lock_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(v_lock_tournament_id);

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



-- The remaining context-affecting legacy writers are reproduced from their
-- final current-main definitions below. Each block only adds the minimum
-- read-only authorization preflight plus the shared tournament advisory before
-- the existing row-lock graph. Business logic, response envelopes, grants,
-- SECURITY DEFINER and search_path remain unchanged.

CREATE OR REPLACE FUNCTION public.floor_assign_player_to_seat(
  p_tournament_id UUID,
  p_player_name TEXT,
  p_tournament_table_id UUID,
  p_seat_number INTEGER
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
  v_authorized BOOLEAN;
  v_tour RECORD;
  v_tt RECORD;
  v_name TEXT := NULLIF(TRIM(p_player_name), '');
  v_player_id UUID := gen_random_uuid();
  v_starting_stack INTEGER;
  v_seat_id UUID;
  v_entry_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_player_name');
  END IF;

  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor OR cc.user_id IS NOT NULL)) OR public.is_club_floor(v_actor, v_pr2a_lock_club_id)) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
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

  SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  IF p_seat_number IS NULL OR p_seat_number < 1 OR p_seat_number > v_tt.max_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_seat_number', 'max_seats', v_tt.max_seats);
  END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, status, assigned_by, assigned_at
    ) VALUES (
      p_tournament_id, v_player_id, 1, v_tt.id, p_seat_number,
      v_starting_stack, true, v_name, 'active', v_actor, now()
    ) RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  INSERT INTO public.tournament_entries (
    tournament_id, registration_id, player_id, entry_no, source,
    status, current_stack, table_id, seat_id, seat_number, seated_at
  ) VALUES (
    p_tournament_id, NULL, v_player_id, 1, 'manual',
    'seated', v_starting_stack, v_tt.table_id, v_seat_id, p_seat_number, now()
  ) RETURNING id INTO v_entry_id;

  UPDATE public.tournament_seats
  SET entry_id = v_entry_id
  WHERE id = v_seat_id;

  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format(
      'T%s-S%s-%s',
      COALESCE(v_tt.table_number::text, '?'),
      p_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        p_tournament_id, NULL, v_entry_id, v_player_id, v_name,
        v_tt.table_id, v_tt.table_number, v_seat_id, p_seat_number, v_receipt_code,
        jsonb_build_object(
          'v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_entry_id,
          'tournament_id', p_tournament_id, 'player_id', v_player_id,
          'table_number', v_tt.table_number, 'seat_number', p_seat_number,
          'source', 'floor'
        ),
        'initial', 'issued', v_actor
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
    p_tournament_id, v_entry_id, v_player_id,
    v_tt.table_id, v_tt.table_number, p_seat_number,
    'floor_seat_add', 'initial', v_actor,
    jsonb_build_object('source', 'floor', 'money', false, 'tournament_table_id', v_tt.id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'seat_id', v_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code,
    'table_id', v_tt.table_id,
    'table_number', v_tt.table_number,
    'seat_number', p_seat_number,
    'display_name', v_name,
    'starting_stack', v_starting_stack
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.move_player_seat(
  p_entry_id UUID,
  p_to_tournament_table_id UUID,
  p_to_seat_number INTEGER,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'manual_move'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pr2a_lock_tournament_id UUID;
  v_pr2a_lock_club_id UUID;
  v_pr2a_lock_authorized BOOLEAN;
  v_actor UUID := auth.uid();
  v_entry RECORD;
  v_from_seat RECORD;
  v_from_tt RECORD;
  v_to_tt RECORD;
  v_new_seat_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_authorized BOOLEAN;
  v_attempt INTEGER := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  -- Actor identity is derived from auth.uid(); this legacy argument is only an
  -- optional spoof check for older callers and is not used as the actor.
  IF p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT e.tournament_id INTO v_pr2a_lock_tournament_id FROM public.tournament_entries e WHERE e.id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found'); END IF;
  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = v_pr2a_lock_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor OR cc.user_id IS NOT NULL)) OR public.is_club_floor(v_actor, v_pr2a_lock_club_id)) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(v_pr2a_lock_tournament_id);
  SELECT * INTO v_entry
  FROM public.tournament_entries
  WHERE id = p_entry_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  IF v_entry.status <> 'seated' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_seated', 'status', v_entry.status);
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      JOIN public.clubs c ON c.id = t.club_id
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE t.id = v_entry.tournament_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = v_entry.tournament_id
        AND public.is_club_floor(v_actor, t.club_id)
    )
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Exact entry linkage only. Legacy player-id fallback could move the wrong entry.
  SELECT * INTO v_from_seat
  FROM public.tournament_seats
  WHERE entry_id = p_entry_id
    AND tournament_id = v_entry.tournament_id
    AND player_id = v_entry.player_id
    AND entry_number = v_entry.entry_no
    AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.tournament_seats
      WHERE tournament_id = v_entry.tournament_id
        AND player_id = v_entry.player_id
        AND is_active = true
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'seat_entry_mismatch');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'no_active_seat');
  END IF;

  SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats, tt.status
  INTO v_from_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = v_entry.tournament_id
    AND v_from_seat.table_id IN (tt.id, tt.table_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

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

  IF v_from_seat.table_id = p_to_tournament_table_id
     AND v_from_seat.seat_number = p_to_seat_number THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_there', true,
      'entry_id', p_entry_id,
      'player_name', v_from_seat.player_name,
      'to_table_number', v_to_tt.table_number,
      'to_seat_number', p_to_seat_number
    );
  END IF;

  BEGIN
    UPDATE public.tournament_seats
    SET status = 'moved', is_active = false
    WHERE id = v_from_seat.id;

    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, entry_id, status,
      assigned_by, assigned_at
    ) VALUES (
      v_entry.tournament_id, v_entry.player_id, v_entry.entry_no,
      v_to_tt.id, p_to_seat_number,
      v_from_seat.chip_count, true, v_from_seat.player_name, p_entry_id,
      'active', v_actor, now()
    ) RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  UPDATE public.tournament_entries
  SET table_id = v_to_tt.table_id,
      seat_number = p_to_seat_number,
      seat_id = v_new_seat_id,
      current_stack = v_from_seat.chip_count,
      updated_at = now()
  WHERE id = p_entry_id;

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
        v_entry.player_id, v_from_seat.player_name,
        v_to_tt.table_id, v_to_tt.table_number, v_new_seat_id,
        p_to_seat_number, v_receipt_code,
        jsonb_build_object(
          'v', 1, 'receipt_code', v_receipt_code, 'entry_id', p_entry_id,
          'tournament_id', v_entry.tournament_id, 'player_id', v_entry.player_id,
          'table_number', v_to_tt.table_number, 'seat_number', p_to_seat_number,
          'move_reason', p_reason
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
    v_from_tt.table_id, v_from_tt.table_number, v_from_seat.seat_number,
    v_to_tt.table_id, v_to_tt.table_number, p_to_seat_number,
    p_reason, 'manual_move', v_actor,
    jsonb_build_object(
      'from_tournament_table_id', v_from_tt.id,
      'to_tournament_table_id', v_to_tt.id,
      'chip_count_at_move', v_from_seat.chip_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', p_entry_id,
    'player_name', v_from_seat.player_name,
    'from_tournament_table_id', v_from_tt.id,
    'from_game_table_id', v_from_tt.table_id,
    'from_table_number', v_from_tt.table_number,
    'from_seat_number', v_from_seat.seat_number,
    'to_tournament_table_id', v_to_tt.id,
    'to_game_table_id', v_to_tt.table_id,
    'to_table_number', v_to_tt.table_number,
    'to_seat_number', p_to_seat_number,
    'chip_count', v_from_seat.chip_count,
    'current_stack', v_from_seat.chip_count,
    'seat_id', v_new_seat_id,
    'receipt_id', v_receipt_id,
    'receipt_code', v_receipt_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redraw_tournament(
  p_tournament_id UUID,
  p_mode TEXT,
  p_eligible_entry_ids UUID[] DEFAULT NULL,
  p_target_table_count INTEGER DEFAULT NULL,
  p_draw_mode TEXT DEFAULT 'redraw_balanced',
  p_dry_run BOOLEAN DEFAULT TRUE
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
  v_authorized BOOLEAN;
  v_tour RECORD;
  v_reason TEXT;
  v_room_seats INTEGER;
  v_tc INTEGER;
  v_need INTEGER;
  v_have INTEGER;
  v_p RECORD;
  v_h RECORD;
  v_new_seat_id UUID;
  v_receipt_id UUID;
  v_receipt_code TEXT;
  v_attempt INTEGER;
  v_moves JSONB := '[]'::jsonb;
  v_closed JSONB := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_mode NOT IN ('final_table', 'table_count_threshold', 'itm', 'manual_custom') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;
  IF p_draw_mode NOT IN ('redraw_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;
  IF p_mode = 'manual_custom'
     AND (p_eligible_entry_ids IS NULL OR cardinality(p_eligible_entry_ids) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual_requires_entry_ids');
  END IF;

  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor OR cc.user_id IS NOT NULL)) OR public.is_club_floor(v_actor, v_pr2a_lock_club_id)) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
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

  -- Lock and validate the complete active-seat graph before planning, including dry-run.
  PERFORM 1
  FROM public.tournament_seats ts
  WHERE ts.tournament_id = p_tournament_id
    AND ts.is_active = true
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
      AND ts.entry_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'orphan_active_seat');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    LEFT JOIN public.tournament_entries e ON e.id = ts.entry_id
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
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

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
      AND (
        SELECT COUNT(*)
        FROM public.tournament_tables tt
        WHERE tt.tournament_id = p_tournament_id
          AND ts.table_id IN (tt.id, tt.table_id)
      ) <> 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_table_mismatch');
  END IF;

  PERFORM 1
  FROM public.tournament_entries e
  WHERE e.id IN (
    SELECT ts.entry_id
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id
      AND ts.is_active = true
  )
  FOR UPDATE;

  v_reason := CASE p_mode
    WHEN 'final_table' THEN 'final_table_redraw'
    WHEN 'table_count_threshold' THEN 'threshold_redraw'
    WHEN 'itm' THEN 'itm_redraw'
    WHEN 'manual_custom' THEN 'manual_redraw'
  END;

  DROP TABLE IF EXISTS pg_temp._floor_redraw_elig;
  DROP TABLE IF EXISTS pg_temp._floor_redraw_targets;
  DROP TABLE IF EXISTS pg_temp._floor_redraw_holes;
  DROP TABLE IF EXISTS pg_temp._floor_redraw_plan;

  CREATE TEMP TABLE _floor_redraw_elig ON COMMIT DROP AS
  SELECT ts.id AS from_seat_id,
         ts.table_id AS from_seat_tid,
         ts.seat_number AS from_seat_number,
         ts.player_name,
         ts.chip_count,
         e.id AS entry_id,
         e.player_id,
         e.entry_no,
         e.registration_id,
         tt.table_id AS from_game_id,
         tt.table_number AS from_table_number
  FROM public.tournament_seats ts
  JOIN public.tournament_entries e ON e.id = ts.entry_id
  JOIN public.tournament_tables tt
    ON tt.tournament_id = ts.tournament_id
   AND ts.table_id IN (tt.id, tt.table_id)
  WHERE ts.tournament_id = p_tournament_id
    AND ts.is_active = true
    AND (p_mode <> 'manual_custom' OR e.id = ANY(p_eligible_entry_ids));

  SELECT COUNT(*)::integer INTO v_need FROM _floor_redraw_elig;
  IF p_mode = 'manual_custom'
     AND v_need <> (
       SELECT COUNT(DISTINCT entry_id)::integer
       FROM unnest(p_eligible_entry_ids) AS requested(entry_id)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual_entry_not_seated');
  END IF;
  IF v_need = 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'mode', p_mode, 'dry_run', p_dry_run,
      'moves', '[]'::jsonb, 'closed', '[]'::jsonb,
      'note', 'no_eligible_players'
    );
  END IF;

  v_room_seats := COALESCE(
    (
      SELECT mode() WITHIN GROUP (ORDER BY max_seats)
      FROM public.tournament_tables
      WHERE tournament_id = p_tournament_id
        AND status = 'active'
        AND max_seats IS NOT NULL
    ),
    9
  );
  v_tc := COALESCE(
    p_target_table_count,
    CASE p_mode
      WHEN 'final_table' THEN 1
      WHEN 'table_count_threshold' THEN 3
      WHEN 'itm' THEN GREATEST(1, CEIL(v_need::numeric / v_room_seats)::integer)
      WHEN 'manual_custom' THEN (
        SELECT COUNT(*)
        FROM public.tournament_tables
        WHERE tournament_id = p_tournament_id
          AND status = 'active'
          AND table_id IS NOT NULL
      )
    END
  );
  IF v_tc < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_table_count');
  END IF;

  CREATE TEMP TABLE _floor_redraw_targets ON COMMIT DROP AS
  SELECT tt.id AS tt_id,
         tt.table_id AS game_id,
         tt.table_number,
         tt.max_seats
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
  ORDER BY tt.table_number ASC NULLS LAST
  LIMIT v_tc;

  IF (SELECT COUNT(*) FROM _floor_redraw_targets) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_target_tables');
  END IF;

  CREATE TEMP TABLE _floor_redraw_holes ON COMMIT DROP AS
  SELECT target.tt_id,
         target.game_id,
         target.table_number,
         seat_no.n AS seat_number,
         (
           SELECT COUNT(*)
           FROM public.tournament_seats occupied
           WHERE occupied.is_active = true
             AND occupied.table_id IN (target.tt_id, target.game_id)
             AND occupied.entry_id NOT IN (SELECT entry_id FROM _floor_redraw_elig)
         )::integer AS occ
  FROM _floor_redraw_targets target
  CROSS JOIN LATERAL generate_series(1, target.max_seats) AS seat_no(n)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.tournament_seats occupied
    WHERE occupied.is_active = true
      AND occupied.seat_number = seat_no.n
      AND occupied.table_id IN (target.tt_id, target.game_id)
      AND occupied.entry_id NOT IN (SELECT entry_id FROM _floor_redraw_elig)
  );

  SELECT COUNT(*)::integer INTO v_have FROM _floor_redraw_holes;
  IF v_have < v_need THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'insufficient_capacity',
      'need', v_need, 'have', v_have, 'target_table_count', v_tc
    );
  END IF;

  CREATE TEMP TABLE _floor_redraw_plan (
    entry_id UUID,
    player_id UUID,
    entry_no INTEGER,
    registration_id UUID,
    player_name TEXT,
    chip_count INTEGER,
    from_seat_id UUID,
    from_game_id UUID,
    from_table_number INTEGER,
    from_seat_number INTEGER,
    to_tt_id UUID,
    to_game_id UUID,
    to_table_number INTEGER,
    to_seat_number INTEGER
  ) ON COMMIT DROP;

  FOR v_p IN SELECT * FROM _floor_redraw_elig ORDER BY random() LOOP
    IF p_draw_mode = 'fill_lowest_table' THEN
      SELECT * INTO v_h
      FROM _floor_redraw_holes
      ORDER BY table_number ASC, seat_number ASC
      LIMIT 1;
    ELSE
      SELECT * INTO v_h
      FROM _floor_redraw_holes
      ORDER BY occ ASC, random()
      LIMIT 1;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'plan_no_seat'; END IF;

    INSERT INTO _floor_redraw_plan VALUES (
      v_p.entry_id, v_p.player_id, v_p.entry_no, v_p.registration_id,
      v_p.player_name, v_p.chip_count,
      v_p.from_seat_id, v_p.from_game_id, v_p.from_table_number, v_p.from_seat_number,
      v_h.tt_id, v_h.game_id, v_h.table_number, v_h.seat_number
    );

    DELETE FROM _floor_redraw_holes
    WHERE tt_id = v_h.tt_id
      AND seat_number = v_h.seat_number;
    UPDATE _floor_redraw_holes
    SET occ = occ + 1
    WHERE tt_id = v_h.tt_id;
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'player_name', player_name,
        'from_table_number', from_table_number,
        'from_seat', from_seat_number,
        'to_table_number', to_table_number,
        'to_seat_number', to_seat_number
      ) ORDER BY to_table_number, to_seat_number
    ),
    '[]'::jsonb
  ) INTO v_moves
  FROM _floor_redraw_plan;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('table_number', tt.table_number) ORDER BY tt.table_number),
    '[]'::jsonb
  ) INTO v_closed
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND tt.table_id IS NOT NULL
    AND tt.id NOT IN (SELECT tt_id FROM _floor_redraw_targets)
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_seats occupied
      WHERE occupied.is_active = true
        AND occupied.table_id IN (tt.id, tt.table_id)
        AND occupied.entry_id NOT IN (SELECT entry_id FROM _floor_redraw_elig)
    );

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'mode', p_mode, 'dry_run', true,
      'target_table_count', v_tc, 'eligible', v_need, 'free_seats', v_have,
      'moves', v_moves, 'tables_to_close', v_closed
    );
  END IF;

  UPDATE public.tournament_seats
  SET status = 'moved', is_active = false
  WHERE id IN (SELECT from_seat_id FROM _floor_redraw_elig);

  FOR v_p IN SELECT * FROM _floor_redraw_plan LOOP
    BEGIN
      INSERT INTO public.tournament_seats (
        tournament_id, player_id, entry_number, table_id, seat_number,
        chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
      ) VALUES (
        p_tournament_id, v_p.player_id, v_p.entry_no, v_p.to_tt_id,
        v_p.to_seat_number, v_p.chip_count, true, v_p.player_name,
        v_p.entry_id, 'active', v_actor, now()
      ) RETURNING id INTO v_new_seat_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'redraw_seat_conflict';
    END;

    UPDATE public.tournament_entries
    SET table_id = v_p.to_game_id,
        seat_number = v_p.to_seat_number,
        seat_id = v_new_seat_id,
        current_stack = v_p.chip_count,
        updated_at = now()
    WHERE id = v_p.entry_id;

    UPDATE public.seat_draw_receipts
    SET status = 'superseded', cancelled_at = now()
    WHERE entry_id = v_p.entry_id
      AND status IN ('issued', 'printed');

    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      v_receipt_code := format(
        'T%s-S%s-%s',
        COALESCE(v_p.to_table_number::text, '?'),
        v_p.to_seat_number,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
      );
      BEGIN
        INSERT INTO public.seat_draw_receipts (
          tournament_id, registration_id, entry_id, player_id, display_name,
          table_id, table_number, seat_id, seat_number, receipt_code,
          qr_payload, draw_type, status, issued_by
        ) VALUES (
          p_tournament_id, v_p.registration_id, v_p.entry_id, v_p.player_id,
          v_p.player_name, v_p.to_game_id, v_p.to_table_number,
          v_new_seat_id, v_p.to_seat_number, v_receipt_code,
          jsonb_build_object(
            'v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_p.entry_id,
            'tournament_id', p_tournament_id, 'player_id', v_p.player_id,
            'table_number', v_p.to_table_number, 'seat_number', v_p.to_seat_number,
            'reason', v_reason
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
      p_tournament_id, v_p.entry_id, v_p.player_id,
      v_p.from_game_id, v_p.from_table_number, v_p.from_seat_number,
      v_p.to_game_id, v_p.to_table_number, v_p.to_seat_number,
      v_reason, 'manual_move', v_actor,
      jsonb_build_object(
        'mode', p_mode,
        'draw_mode', p_draw_mode,
        'to_tournament_table_id', v_p.to_tt_id,
        'chip_count_at_move', v_p.chip_count
      )
    );
  END LOOP;

  FOR v_h IN
    SELECT tt.id, tt.table_id
    FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active'
      AND tt.table_id IS NOT NULL
      AND tt.id NOT IN (SELECT tt_id FROM _floor_redraw_targets)
      AND NOT EXISTS (
        SELECT 1
        FROM public.tournament_seats occupied
        WHERE occupied.is_active = true
          AND occupied.table_id IN (tt.id, tt.table_id)
      )
    FOR UPDATE
  LOOP
    PERFORM public.release_dealer_from_table(v_h.table_id);
    UPDATE public.tournament_tables SET status = 'closed' WHERE id = v_h.id;
    UPDATE public.game_tables SET status = 'inactive' WHERE id = v_h.table_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'mode', p_mode, 'dry_run', false,
    'target_table_count', v_tc, 'moved_count', v_need,
    'moves', v_moves, 'tables_closed', v_closed
  );
END;
$$;

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
  v_pr2a_lock_club_id UUID;
  v_pr2a_lock_authorized BOOLEAN;
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

  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor OR cc.user_id IS NOT NULL)) OR public.is_club_floor(v_actor, v_pr2a_lock_club_id)) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
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

  -- A restore is a roster mutation. Once Tracker has an in-progress hand on
  -- this tournament table, fail closed before the first seat/receipt write.
  -- Hands created by legacy start_hand store the physical table id while V2
  -- stores the canonical tournament-table id, so guard both identities.
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
  v_pr2a_lock_club_id UUID;
  v_pr2a_lock_authorized BOOLEAN;
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

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);

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

CREATE OR REPLACE FUNCTION public.floor_start_tournament_clock(
  p_tournament_id UUID
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
  v_tour RECORD;
  v_level INTEGER;
  v_authorized BOOLEAN;
  v_started_at TIMESTAMPTZ;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor OR cc.user_id IS NOT NULL)) OR public.is_club_floor(v_actor, v_pr2a_lock_club_id)) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
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

  IF v_tour.status::TEXT IN ('completed', 'cancelled', 'finished') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_close_report
    WHERE tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_already_closed');
  END IF;
  IF v_tour.clock_started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_already_started');
  END IF;

  v_level := v_tour.current_level;
  IF v_level IS NULL THEN
    SELECT level_number INTO v_level
    FROM public.tournament_levels
    WHERE tournament_id = p_tournament_id
    ORDER BY level_number ASC
    LIMIT 1;
  END IF;
  IF v_level IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tournament_level');
  END IF;

  UPDATE public.tournaments
  SET status = 'live',
      current_level = v_level,
      clock_started_at = clock_timestamp(),
      clock_paused_at = NULL,
      pause_accumulated = 0,
      updated_at = now()
  WHERE id = p_tournament_id
    AND clock_started_at IS NULL
  RETURNING clock_started_at INTO v_started_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_already_started');
  END IF;

  IF v_tour.status IS DISTINCT FROM 'live' THEN
    INSERT INTO public.tournament_state_transitions (
      tournament_id, previous_state, new_state, changed_by, reason
    ) VALUES (
      p_tournament_id, v_tour.status, 'live', v_actor, 'floor_clock_started'
    );
  END IF;

  INSERT INTO public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, payload
  ) VALUES (
    v_tour.club_id, v_actor, 'floor_tournament_clock_started', 'tournament', p_tournament_id,
    jsonb_build_object(
      'previous_status', v_tour.status,
      'current_level', v_level,
      'clock_started_at', v_started_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'clock_started',
    'current_level', v_level,
    'clock_started_at', v_started_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_control_tournament_clock(
  p_tournament_id UUID,
  p_action TEXT,
  p_delta_seconds INTEGER DEFAULT NULL,
  p_expected_control_revision TEXT DEFAULT NULL
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
  v_tour public.tournaments%ROWTYPE;
  v_authorized BOOLEAN := false;
  v_now TIMESTAMPTZ;
  v_target_level INTEGER;
  v_level_duration_seconds INTEGER;
  v_elapsed_seconds INTEGER;
  v_current_remaining_seconds INTEGER;
  v_target_remaining_seconds INTEGER;
  v_target_elapsed_seconds INTEGER;
  v_paused_seconds INTEGER;
  v_reference_time TIMESTAMPTZ;
  v_new_started_at TIMESTAMPTZ;
  v_current_control_revision TEXT;
  v_outcome TEXT;
  v_changed BOOLEAN := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_action IS NULL OR p_action NOT IN (
    'pause', 'resume', 'next_level', 'previous_level', 'adjust_time'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  IF p_action = 'adjust_time' AND p_delta_seconds IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delta_must_be_integer');
  END IF;
  IF p_action = 'adjust_time'
    AND (p_delta_seconds < -86400 OR p_delta_seconds > 86400) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delta_too_large');
  END IF;

  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor OR cc.user_id IS NOT NULL)) OR public.is_club_floor(v_actor, v_pr2a_lock_club_id)) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  SELECT *
  INTO v_tour
  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = v_tour.club_id
        AND c.owner_id = v_actor
    )
    OR EXISTS (
      SELECT 1
      FROM public.club_cashiers cc
      WHERE cc.club_id = v_tour.club_id
        AND cc.user_id = v_actor
    )
    OR EXISTS (
      SELECT 1
      FROM public.club_floors cf
      WHERE cf.club_id = v_tour.club_id
        AND cf.user_id = v_actor
    )
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF v_tour.status::TEXT IN ('completed', 'cancelled', 'finished') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_close_report tcr
    WHERE tcr.tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_already_closed');
  END IF;
  IF v_tour.clock_started_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_not_started');
  END IF;
  v_current_control_revision := md5(jsonb_build_array(
    v_tour.current_level,
    EXTRACT(EPOCH FROM v_tour.clock_started_at),
    EXTRACT(EPOCH FROM v_tour.clock_paused_at),
    COALESCE(v_tour.pause_accumulated, 0)
  )::TEXT);
  IF p_expected_control_revision IS NULL
    OR p_expected_control_revision !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'expected_control_revision_required'
    );
  END IF;
  IF v_current_control_revision IS DISTINCT FROM p_expected_control_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_clock_state');
  END IF;

  v_now := clock_timestamp();

  CASE
    WHEN p_action = 'pause' THEN
      IF v_tour.clock_paused_at IS NULL THEN
        UPDATE public.tournaments
        SET clock_paused_at = v_now,
            updated_at = now()
        WHERE id = p_tournament_id;
        v_tour.clock_paused_at := v_now;
        v_changed := true;
        v_outcome := 'clock_paused';
      ELSE
        v_outcome := 'clock_already_paused';
      END IF;

    WHEN p_action = 'resume' THEN
      IF v_tour.clock_paused_at IS NOT NULL THEN
        v_paused_seconds := GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (v_now - v_tour.clock_paused_at)))::INTEGER
        );
        UPDATE public.tournaments
        SET clock_paused_at = NULL,
            pause_accumulated = COALESCE(v_tour.pause_accumulated, 0) + v_paused_seconds,
            updated_at = now()
        WHERE id = p_tournament_id;
        v_tour.clock_paused_at := NULL;
        v_tour.pause_accumulated := COALESCE(v_tour.pause_accumulated, 0) + v_paused_seconds;
        v_changed := true;
        v_outcome := 'clock_resumed';
      ELSE
        v_outcome := 'clock_already_running';
      END IF;

    WHEN p_action IN ('next_level', 'previous_level') THEN
      v_target_level := v_tour.current_level
        + CASE WHEN p_action = 'next_level' THEN 1 ELSE -1 END;
      IF v_target_level < 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'already_first_level');
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.tournament_levels tl
        WHERE tl.tournament_id = p_tournament_id
          AND tl.level_number = v_target_level
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'target_level_missing');
      END IF;
      UPDATE public.tournaments
      SET current_level = v_target_level,
          clock_started_at = v_now,
          clock_paused_at = CASE
            WHEN v_tour.clock_paused_at IS NULL THEN NULL
            ELSE v_now
          END,
          pause_accumulated = 0,
          updated_at = now()
      WHERE id = p_tournament_id;
      v_tour.current_level := v_target_level;
      v_tour.clock_started_at := v_now;
      IF v_tour.clock_paused_at IS NOT NULL THEN
        v_tour.clock_paused_at := v_now;
      END IF;
      v_tour.pause_accumulated := 0;
      v_changed := true;
      v_outcome := CASE
        WHEN p_action = 'next_level' THEN 'clock_level_advanced'
        ELSE 'clock_level_rewound'
      END;

    WHEN p_action = 'adjust_time' THEN
      SELECT tl.duration_minutes * 60
      INTO v_level_duration_seconds
      FROM public.tournament_levels tl
      WHERE tl.tournament_id = p_tournament_id
        AND tl.level_number = v_tour.current_level;
      IF NOT FOUND OR v_level_duration_seconds IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'current_level_missing');
      END IF;

      v_reference_time := COALESCE(v_tour.clock_paused_at, v_now);
      v_elapsed_seconds := FLOOR(EXTRACT(EPOCH FROM (
        v_reference_time - v_tour.clock_started_at
      )))::INTEGER - COALESCE(v_tour.pause_accumulated, 0);
      v_current_remaining_seconds := GREATEST(
        0,
        LEAST(v_level_duration_seconds, v_level_duration_seconds - v_elapsed_seconds)
      );
      v_target_remaining_seconds := GREATEST(
        0,
        LEAST(
          v_level_duration_seconds,
          v_current_remaining_seconds + p_delta_seconds
        )
      );
      v_target_elapsed_seconds := v_level_duration_seconds - v_target_remaining_seconds;

      IF v_target_remaining_seconds = v_current_remaining_seconds THEN
        v_outcome := 'clock_time_unchanged';
      ELSE
        v_new_started_at := v_reference_time
          - make_interval(
              secs => COALESCE(v_tour.pause_accumulated, 0) + v_target_elapsed_seconds
            );
        UPDATE public.tournaments
        SET clock_started_at = v_new_started_at,
            updated_at = now()
        WHERE id = p_tournament_id;
        v_tour.clock_started_at := v_new_started_at;
        v_changed := true;
        v_outcome := 'clock_time_adjusted';
      END IF;
  END CASE;

  IF v_changed THEN
    INSERT INTO public.audit_logs (
      club_id, actor_id, action, entity_type, entity_id, payload
    ) VALUES (
      v_tour.club_id,
      v_actor,
      'floor_tournament_clock_controlled',
      'tournament',
      p_tournament_id,
      jsonb_build_object(
        'clock_action', p_action,
        'outcome', v_outcome,
        'current_level', v_tour.current_level,
        'delta_seconds', CASE WHEN p_action = 'adjust_time' THEN p_delta_seconds ELSE NULL END
      )
    );
  END IF;

  v_current_control_revision := md5(jsonb_build_array(
    v_tour.current_level,
    EXTRACT(EPOCH FROM v_tour.clock_started_at),
    EXTRACT(EPOCH FROM v_tour.clock_paused_at),
    COALESCE(v_tour.pause_accumulated, 0)
  )::TEXT);

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'changed', v_changed,
    'current_level', v_tour.current_level,
    'clock_started_at', v_tour.clock_started_at,
    'clock_paused_at', v_tour.clock_paused_at,
    'pause_accumulated', COALESCE(v_tour.pause_accumulated, 0),
    'control_revision', v_current_control_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_offline_buyin_and_seat(
  p_tournament_id uuid, p_player_name text, p_buy_in bigint, p_fee bigint,
  p_draw_mode text DEFAULT 'random_balanced'::text, p_phone text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pr2a_lock_club_id UUID; v_pr2a_lock_authorized BOOLEAN;
  v_actor_user_id UUID := auth.uid(); v_authorized BOOLEAN; v_tour RECORD;
  v_name TEXT := NULLIF(TRIM(p_player_name), ''); v_player_id UUID := gen_random_uuid();
  v_reg_id UUID; v_ref_code TEXT; v_starting_stack INTEGER; v_entry_id UUID; v_seat_id UUID;
  v_seat_number INTEGER; v_table_tour_id UUID; v_table_game_id UUID; v_table_number INTEGER;
  v_max_seats INTEGER; v_receipt_id UUID; v_receipt_code TEXT; v_attempt INTEGER := 0;
  v_member_id UUID;
BEGIN
  IF v_actor_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN RETURN jsonb_build_object('ok',false,'error','invalid_player_name'); END IF;
  IF p_buy_in IS NULL OR p_buy_in <= 0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_buy_in'); END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_fee'); END IF;
  IF p_draw_mode NOT IN ('random_balanced','fill_lowest_table') THEN RETURN jsonb_build_object('ok',false,'error','invalid_draw_mode'); END IF;

  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor_user_id WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor_user_id OR cc.user_id IS NOT NULL))) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_found'); END IF;
  IF v_tour.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_open','status',v_tour.status); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = p_tournament_id AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  IF p_draw_mode = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (SELECT count(*) AS active_count FROM public.tournament_seats ts WHERE ts.table_id = tt.id AND ts.is_active = true) c
    WHERE tt.tournament_id = p_tournament_id AND tt.status='active' AND tt.table_id IS NOT NULL AND c.active_count < tt.max_seats
    ORDER BY tt.table_number ASC NULLS LAST, c.active_count ASC LIMIT 1;
  ELSE
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (SELECT count(*) AS active_count FROM public.tournament_seats ts WHERE ts.table_id = tt.id AND ts.is_active = true) c
    WHERE tt.tournament_id = p_tournament_id AND tt.status='active' AND tt.table_id IS NOT NULL AND c.active_count < tt.max_seats
    ORDER BY c.active_count ASC, random() LIMIT 1;
  END IF;
  IF v_table_tour_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_table_available'); END IF;

  SELECT s.n INTO v_seat_number FROM generate_series(1, v_max_seats) AS s(n)
  WHERE NOT EXISTS (SELECT 1 FROM public.tournament_seats ts WHERE ts.table_id = v_table_tour_id AND ts.seat_number = s.n AND ts.is_active = true)
  ORDER BY random() LIMIT 1;
  IF v_seat_number IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_table_available'); END IF;

  BEGIN
    INSERT INTO public.tournament_seats (tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, player_name, status, assigned_by, assigned_at)
    VALUES (p_tournament_id, v_player_id, 1, v_table_tour_id, v_seat_number, v_starting_stack, true, v_name, 'active', v_actor_user_id, now())
    RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'error','seat_occupied'); END;

  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('CASH-%s', upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
    BEGIN
      INSERT INTO public.tournament_registrations (tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, committed_at, confirmed_at, confirmed_by)
      VALUES (p_tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee, v_ref_code, 'confirmed', now(), now(), v_actor_user_id)
      RETURNING id INTO v_reg_id; EXIT;
    EXCEPTION WHEN unique_violation THEN IF v_attempt >= 5 THEN RAISE; END IF; END;
  END LOOP;

  INSERT INTO public.tournament_entries (tournament_id, registration_id, player_id, entry_no, source, status, current_stack, table_id, seat_id, seat_number, seated_at)
  VALUES (p_tournament_id, v_reg_id, v_player_id, 1, 'offline', 'seated', v_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now())
  RETURNING id INTO v_entry_id;
  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- Player-history link (best-effort; NEVER blocks the buy-in). Walk-in keyed by phone; gated per club.
  BEGIN
    IF public.normalize_phone(p_phone) IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.club_settings cs WHERE cs.club_id = v_tour.club_id AND cs.player_history_enabled) THEN
      v_member_id := NULLIF(public.find_or_create_club_member(v_tour.club_id, p_phone, v_name, NULL)->>'member_id', '')::uuid;
      IF v_member_id IS NOT NULL THEN
        UPDATE public.tournament_entries SET member_id = v_member_id WHERE id = v_entry_id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.player_history_link_errors (club_id, context, detail)
    VALUES (v_tour.club_id, 'create_offline_buyin_and_seat', left(SQLERRM, 500));
  END;

  v_attempt := 0;
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s', COALESCE(v_table_number::text,'?'), v_seat_number, upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts (tournament_id, registration_id, entry_id, player_id, display_name, table_id, table_number, seat_id, seat_number, receipt_code, qr_payload, draw_type, status, issued_by)
      VALUES (p_tournament_id, v_reg_id, v_entry_id, v_player_id, v_name, v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object('v',1,'receipt_code',v_receipt_code,'entry_id',v_entry_id,'tournament_id',p_tournament_id,'player_id',v_player_id,'table_number',v_table_number,'seat_number',v_seat_number,'source','offline'),
        'initial','issued', v_actor_user_id) RETURNING id INTO v_receipt_id; EXIT;
    EXCEPTION WHEN unique_violation THEN IF v_attempt >= 5 THEN RAISE; END IF; END;
  END LOOP;

  INSERT INTO public.seat_assignment_history (tournament_id, entry_id, player_id, to_table_id, to_table_number, to_seat_number, reason, draw_type, actor_user_id, metadata)
  VALUES (p_tournament_id, v_entry_id, v_player_id, v_table_game_id, v_table_number, v_seat_number, 'offline_buyin', 'initial', v_actor_user_id,
    jsonb_build_object('draw_mode',p_draw_mode,'registration_id',v_reg_id,'buy_in',p_buy_in,'fee',p_fee,'source','offline'));

  RETURN jsonb_build_object('ok',true,'registration_id',v_reg_id,'entry_id',v_entry_id,'seat_id',v_seat_id,'receipt_id',v_receipt_id,'receipt_code',v_receipt_code,'reference_code',v_ref_code,'table_id',v_table_game_id,'table_number',v_table_number,'seat_number',v_seat_number,'display_name',v_name,'starting_stack',v_starting_stack);
END; $function$;

CREATE OR REPLACE FUNCTION public.reenter_tournament_player(p_entry_id uuid, p_buy_in bigint, p_fee bigint, p_draw_mode text DEFAULT 'random_balanced'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pr2a_lock_club_id UUID; v_pr2a_lock_authorized BOOLEAN;
  v_actor_user_id UUID := auth.uid(); v_authorized BOOLEAN; v_src RECORD; v_tour RECORD; v_player_id UUID;
  v_entry_no INTEGER; v_reg_id UUID; v_ref_code TEXT; v_starting_stack INTEGER; v_res JSONB; v_attempt INTEGER := 0;
BEGIN
  IF v_actor_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_buy_in IS NULL OR p_buy_in <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_buy_in'); END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_fee'); END IF;
  IF p_draw_mode NOT IN ('random_balanced', 'fill_lowest_table') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode'); END IF;
  SELECT * INTO v_src FROM public.tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found'); END IF;
  IF v_src.status <> 'busted' THEN RETURN jsonb_build_object('ok', false, 'error', 'entry_not_reenterable', 'status', v_src.status); END IF;
  v_player_id := v_src.player_id;
  SELECT t.club_id INTO v_pr2a_lock_club_id FROM public.tournaments t WHERE t.id = v_src.tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  SELECT (EXISTS (SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=v_actor_user_id WHERE c.id=v_pr2a_lock_club_id AND (c.owner_id=v_actor_user_id OR cc.user_id IS NOT NULL))) INTO v_pr2a_lock_authorized;
  IF NOT v_pr2a_lock_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM public.tracker_unified_ops_lock_tournament(v_src.tournament_id);
  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_src.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status); END IF;
  SELECT EXISTS (SELECT 1 FROM public.tournaments t LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = v_src.tournament_id AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)) INTO v_authorized;
  IF NOT v_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM 1 FROM public.tournament_seats WHERE tournament_id = v_src.tournament_id AND player_id = v_player_id AND is_active = true;
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'player_already_active'); END IF;
  PERFORM 1 FROM public.tournament_registrations WHERE source_entry_id = p_entry_id AND status IN ('pending', 'confirmed');
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reentry_already_pending'); END IF;
  v_starting_stack := COALESCE(v_tour.starting_stack, 0);
  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('REENTRY-%s', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    BEGIN
      INSERT INTO public.tournament_registrations (tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, committed_at, confirmed_at, confirmed_by, source_entry_id)
      VALUES (v_src.tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee, v_ref_code, 'confirmed', now(), now(), v_actor_user_id, p_entry_id) RETURNING id INTO v_reg_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN IF v_attempt >= 5 THEN RAISE; END IF; END;
  END LOOP;
  v_res := public._assign_reentry_seat(v_src.tournament_id, v_player_id, p_entry_id, v_reg_id, v_actor_user_id, p_draw_mode, v_starting_stack);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN DELETE FROM public.tournament_registrations WHERE id = v_reg_id; RETURN v_res; END IF;

  -- Carry the member identity onto the re-entry bullet (best-effort; walk-in has no profile so the
  -- trigger won't link it). The busted source bullet stays linked; "official finish" is derived at
  -- finalize as the member's LAST entry, so old bullets never show a fake result (see M3).
  BEGIN
    IF v_src.member_id IS NOT NULL AND (v_res ? 'entry_id') THEN
      UPDATE public.tournament_entries SET member_id = v_src.member_id
        WHERE id = (v_res->>'entry_id')::uuid AND member_id IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.player_history_link_errors (club_id, context, detail)
    VALUES (v_tour.club_id, 'reenter_tournament_player', left(SQLERRM, 500));
  END;

  RETURN v_res || jsonb_build_object('registration_id', v_reg_id, 'reference_code', v_ref_code);
END; $function$;

COMMIT;
