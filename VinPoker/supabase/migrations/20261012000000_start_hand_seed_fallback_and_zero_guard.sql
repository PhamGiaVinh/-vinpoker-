-- PR-P0: start_hand seed fallback + zero-seed precondition (supersedes #360).
--
-- TWO minimal, additive changes vs the live start_hand:
--   1) Seed fallback: starting_stack = COALESCE(cc.chip_count, ts.chip_count, 0)
--      — aligns the SERVER seed source with the table the B3 UI guard + the operator
--      UI read (tournament_seats.chip_count). Previously COALESCE(cc.chip_count, 0)
--      seeded 0 when tournament_chip_counts had no row, silently breaking the betting
--      round (post_sb/bb clamp to 0 → highestBet 0 → RAISE_WITHOUT_BET / PLAYER_ALL_IN).
--      (This was source-only migration 20260930000000 / #360 — carried here verbatim.)
--   2) Zero-seed precondition: REJECT (RAISE EXCEPTION → full transaction rollback) if
--      ANY dealt-in seat resolves to a stack <= 0, BEFORE the hand row is created.
--      Fail LOUD at hand start instead of seeding 0 and rejecting every action mid-hand
--      (which the operator cannot diagnose). The B3 client guard already blocks this on
--      tournament_seats; this is the server-side backstop for the real seed source.
--
-- CREATE OR REPLACE with the IDENTICAL signature → preserves grants/owner. SECURITY
-- INVOKER (default) preserved — start_hand has never carried an explicit SECURITY or
-- search_path clause (verified across 20260617 / 20260803 / 20260930). Body is
-- byte-identical to #360 except the one added DECLARE var + the precondition block.
-- Supersedes #360 (which has the fallback but no precondition).
--
-- ⚠️ NOT APPLIED here. Production apply is owner-gated (vinpoker-production-patch), in a
-- separate controlled session, after the PR-T green net + owner review of this diff.
-- Rollback = re-apply 20260803000000 (pre-fallback) to restore the prior start_hand.

CREATE OR REPLACE FUNCTION public.start_hand(
  p_tournament_id uuid,
  p_table_id uuid,
  p_hand_number integer,
  p_hand_time timestamp with time zone DEFAULT now(),
  p_created_by uuid DEFAULT NULL::uuid,
  p_button_seat integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_hand_id UUID;
  v_existing_id UUID;
  v_existing_lock_time TIMESTAMPTZ;
  v_retry_count INTEGER := 0;
  v_seat RECORD;
  v_bad_seat INTEGER;  -- PR-P0: first dealt-in seat whose resolved seed is <= 0
BEGIN
  IF p_button_seat IS NULL OR p_button_seat < 1 OR p_button_seat > 10 THEN
    RETURN jsonb_build_object('error', 'Invalid button_seat: must be between 1 and 10');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_tables
    WHERE id = p_table_id AND tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('error', 'Table does not belong to tournament');
  END IF;

  -- PR-P0 PRECONDITION: every dealt-in seat must resolve to a POSITIVE starting
  -- stack (from tournament_chip_counts, falling back to tournament_seats.chip_count —
  -- the SAME source used to seed hand_players below). If any seat resolves to <= 0,
  -- fail LOUD here (full rollback, no hand created) instead of seeding 0 and breaking
  -- every subsequent action. Runs BEFORE the hand insert so nothing is persisted.
  SELECT ts.seat_number INTO v_bad_seat
  FROM public.tournament_seats ts
  LEFT JOIN public.tournament_chip_counts cc
    ON cc.tournament_id = ts.tournament_id
    AND cc.player_id = ts.player_id
    AND cc.entry_number = ts.entry_number
  WHERE ts.tournament_id = p_tournament_id
    AND ts.table_id = p_table_id
    AND ts.is_active = true
    AND COALESCE(cc.chip_count, ts.chip_count, 0) <= 0
  ORDER BY ts.seat_number
  LIMIT 1;

  IF v_bad_seat IS NOT NULL THEN
    RAISE EXCEPTION 'start_hand: ghế % chưa có chip (seed stack = 0) — không thể bắt đầu hand. Hãy nạp chip cho người chơi trước.', v_bad_seat;
  END IF;

  <<retry_loop>>
  LOOP
    BEGIN
      INSERT INTO public.tournament_hands
        (tournament_id, table_id, hand_number, hand_time, community_cards, pot_size, side_pots, status, created_by, locked_by_user_id, locked_at, button_seat)
      VALUES
        (p_tournament_id, p_table_id, p_hand_number, p_hand_time, '[]'::jsonb, 0, '[]'::jsonb, 'in_progress', p_created_by, p_created_by, NOW(), p_button_seat)
      RETURNING id INTO v_hand_id;

      EXIT retry_loop;

    EXCEPTION WHEN unique_violation THEN
      v_retry_count := v_retry_count + 1;

      IF v_retry_count > 1 THEN
        SELECT id, locked_at INTO v_existing_id, v_existing_lock_time
        FROM public.tournament_hands
        WHERE tournament_id = p_tournament_id AND table_id = p_table_id AND status = 'in_progress';

        RETURN jsonb_build_object('error', 'Table already has an active hand', 'hand_id', v_existing_id);
      END IF;

      SELECT id, locked_at INTO v_existing_id, v_existing_lock_time
      FROM public.tournament_hands
      WHERE tournament_id = p_tournament_id AND table_id = p_table_id AND status = 'in_progress';

      IF v_existing_id IS NULL THEN
        CONTINUE retry_loop;
      END IF;

      IF v_existing_lock_time < NOW() - INTERVAL '10 minutes' THEN
        UPDATE public.tournament_hands
        SET status = 'voided', is_voided = true,
            locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
        WHERE id = v_existing_id AND status = 'in_progress';

        DELETE FROM public.hand_actions WHERE hand_id = v_existing_id;
        DELETE FROM public.tournament_eliminations WHERE hand_id = v_existing_id;
        UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false
        WHERE hand_id = v_existing_id;

        CONTINUE retry_loop;
      ELSE
        RETURN jsonb_build_object('error', 'Table already has an active hand', 'hand_id', v_existing_id);
      END IF;
    END;
  END LOOP;

  FOR v_seat IN
    SELECT ts.player_id, ts.entry_number, ts.seat_number,
           -- FIX: tournament_chip_counts may have no row yet (e.g. seats created
           -- without a chip-count row); fall back to tournament_seats.chip_count —
           -- the same stack the operator UI shows — instead of defaulting to 0.
           COALESCE(cc.chip_count, ts.chip_count, 0) AS chip_count
    FROM public.tournament_seats ts
    LEFT JOIN public.tournament_chip_counts cc
      ON cc.tournament_id = ts.tournament_id
      AND cc.player_id = ts.player_id
      AND cc.entry_number = ts.entry_number
    WHERE ts.tournament_id = p_tournament_id
      AND ts.table_id = p_table_id
      AND ts.is_active = true
    ORDER BY ts.seat_number
  LOOP
    INSERT INTO public.hand_players
      (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots, hole_cards)
    VALUES
      (v_hand_id, p_tournament_id, v_seat.player_id, v_seat.entry_number,
       v_seat.seat_number, v_seat.chip_count, NULL, false, '[]'::jsonb, '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object('status', 'success', 'hand_id', v_hand_id, 'button_seat', p_button_seat);
END;
$function$;
