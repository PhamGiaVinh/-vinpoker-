-- ============================================================================
-- MD-3 — seat_day2_qualifiers ("Bốc thăm Day 2": seat the Final Day pool)
-- ============================================================================
-- SOURCE-ONLY. The atomic Final-Day seat draw for multi-day tournaments. Reads the
-- event's qualifiers (tournament_event_qualifiers for this final = the Day-2 pool) and
-- seats each one onto the final's ACTIVE tables, CARRYING their bagged stack
-- (carried_stack) — the whole point of multi-day. Mirrors the proven seating logic of
-- create_offline_buyin_and_seat (entry + live seat + receipt + history) with two
-- deliberate differences:
--   * registration_id = NULL on the entry/receipt → NO tournament_registrations row is
--     created. Qualifiers already paid their buy-in in the flight, so the Final Day is
--     finance-neutral: zero new revenue, zero rake-count inflation, no registration-queue
--     pollution. (registration_id is nullable on both tables — verified in seat_assignment_core.)
--   * chip_count / current_stack = carried_stack (NOT the final's starting_stack).
--
-- Idempotent: a qualifier who already has an entry in the final is skipped, so the floor
-- can add tables and re-run to seat the rest. Capacity shortfall → those players counted
-- in 'no_seat' (floor opens more tables, re-runs). Atomic per player via a subtransaction
-- (a seat race rolls back only that player's writes). The tournament is locked FOR UPDATE,
-- serialising against the other floor seat RPCs.
--
-- Auth: actor = auth.uid(), super_admin OR the final club's owner OR a club cashier.
-- SECURITY DEFINER, search_path=public. REVOKE PUBLIC/anon, GRANT authenticated.
--
-- ROLLBACK: docs/emergency_rollbacks/MD_qualifiers_rollback.sql (drops this too).
-- Controlled apply only (BEGIN..COMMIT). NO db push / deploy_db / schema_migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seat_day2_qualifiers(
  p_final_id  uuid,
  p_draw_mode text DEFAULT 'random_balanced'   -- 'random_balanced' | 'fill_lowest_table'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor        uuid := auth.uid();
  v_tour         RECORD;
  v_authorized   boolean;
  v_q            RECORD;
  v_name         text;
  v_stack        integer;
  v_tt_id        uuid;
  v_game_id      uuid;
  v_table_number integer;
  v_max          integer;
  v_seat_no      integer;
  v_entry_id     uuid;
  v_seat_id      uuid;
  v_code         text;
  v_attempt      integer;
  v_seated       integer := 0;
  v_skipped      integer := 0;
  v_no_seat      integer := 0;
  v_total        integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_draw_mode NOT IN ('random_balanced', 'fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;

  -- Lock the final; it must be a final-phase, open tournament.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_final_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.phase IS DISTINCT FROM 'final' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_final');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  SELECT (has_role(v_actor, 'super_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = v_tour.club_id AND c.owner_id = v_actor)
          OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = v_tour.club_id AND cc.user_id = v_actor))
    INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  FOR v_q IN
    SELECT * FROM public.tournament_event_qualifiers
    WHERE final_tournament_id = p_final_id
    ORDER BY carried_stack DESC
  LOOP
    v_total := v_total + 1;

    -- idempotent: already has an entry in the final → skip (re-run safe).
    IF EXISTS (SELECT 1 FROM public.tournament_entries e
               WHERE e.tournament_id = p_final_id AND e.player_id = v_q.player_id) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_stack := COALESCE(v_q.carried_stack, 0);

    -- display name from the player's flight seat (fallback 'Player')
    SELECT player_name INTO v_name FROM public.tournament_seats
      WHERE tournament_id = v_q.flight_tournament_id AND player_id = v_q.player_id
      ORDER BY entry_number DESC LIMIT 1;
    v_name := COALESCE(NULLIF(TRIM(v_name), ''), 'Player');

    -- pick an active final table with free capacity (mirror create_offline_buyin_and_seat).
    IF p_draw_mode = 'fill_lowest_table' THEN
      SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
        INTO v_tt_id, v_game_id, v_table_number, v_max
      FROM public.tournament_tables tt
      CROSS JOIN LATERAL (
        SELECT count(*) AS active_count FROM public.tournament_seats ts
        WHERE ts.table_id = tt.id AND ts.is_active = true) c
      WHERE tt.tournament_id = p_final_id AND tt.status = 'active' AND tt.table_id IS NOT NULL
        AND c.active_count < tt.max_seats
      ORDER BY tt.table_number ASC NULLS LAST, c.active_count ASC
      LIMIT 1;
    ELSE
      SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
        INTO v_tt_id, v_game_id, v_table_number, v_max
      FROM public.tournament_tables tt
      CROSS JOIN LATERAL (
        SELECT count(*) AS active_count FROM public.tournament_seats ts
        WHERE ts.table_id = tt.id AND ts.is_active = true) c
      WHERE tt.tournament_id = p_final_id AND tt.status = 'active' AND tt.table_id IS NOT NULL
        AND c.active_count < tt.max_seats
      ORDER BY c.active_count ASC, random()
      LIMIT 1;
    END IF;

    IF v_tt_id IS NULL THEN
      v_no_seat := v_no_seat + 1;
      CONTINUE;
    END IF;

    SELECT s.n INTO v_seat_no
    FROM generate_series(1, v_max) AS s(n)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tournament_seats ts
      WHERE ts.table_id = v_tt_id AND ts.seat_number = s.n AND ts.is_active = true)
    ORDER BY random()
    LIMIT 1;
    IF v_seat_no IS NULL THEN
      v_no_seat := v_no_seat + 1;
      CONTINUE;
    END IF;

    -- per-player subtransaction: a seat race rolls back only this player's writes.
    BEGIN
      INSERT INTO public.tournament_entries (
        tournament_id, registration_id, player_id, entry_no, source,
        status, current_stack, table_id, seat_number, seated_at
      ) VALUES (
        p_final_id, NULL, v_q.player_id, 1, 'staff',
        'seated', v_stack, v_game_id, v_seat_no, now()
      ) RETURNING id INTO v_entry_id;

      INSERT INTO public.tournament_seats (
        tournament_id, player_id, entry_number, table_id, seat_number,
        chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
      ) VALUES (
        p_final_id, v_q.player_id, 1, v_tt_id, v_seat_no,
        v_stack, true, v_name, v_entry_id, 'active', v_actor, now()
      ) RETURNING id INTO v_seat_id;

      UPDATE public.tournament_entries SET seat_id = v_seat_id WHERE id = v_entry_id;

      v_attempt := 0;
      LOOP
        v_attempt := v_attempt + 1;
        v_code := format('T%s-S%s-%s',
          COALESCE(v_table_number::text, '?'), v_seat_no,
          upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
        BEGIN
          INSERT INTO public.seat_draw_receipts (
            tournament_id, registration_id, entry_id, player_id, display_name,
            table_id, table_number, seat_id, seat_number, receipt_code,
            qr_payload, draw_type, status, issued_by
          ) VALUES (
            p_final_id, NULL, v_entry_id, v_q.player_id, v_name,
            v_game_id, v_table_number, v_seat_id, v_seat_no, v_code,
            jsonb_build_object('v', 1, 'receipt_code', v_code, 'entry_id', v_entry_id,
              'tournament_id', p_final_id, 'player_id', v_q.player_id,
              'table_number', v_table_number, 'seat_number', v_seat_no, 'source', 'day2'),
            'initial', 'issued', v_actor
          );
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
        p_final_id, v_entry_id, v_q.player_id,
        v_game_id, v_table_number, v_seat_no,
        'day2_seat', 'initial', v_actor,
        jsonb_build_object('draw_mode', p_draw_mode, 'carried_stack', v_stack,
          'flight_tournament_id', v_q.flight_tournament_id)
      );

      v_seated := v_seated + 1;
    EXCEPTION WHEN unique_violation THEN
      -- seat/entry race — this player's subtxn rolled back; count as skipped, re-run safe.
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'seated', v_seated,
    'skipped_existing', v_skipped,
    'no_seat', v_no_seat,
    'total', v_total
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.seat_day2_qualifiers(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seat_day2_qualifiers(uuid, text) TO authenticated;
