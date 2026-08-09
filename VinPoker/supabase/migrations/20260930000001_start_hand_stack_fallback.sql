-- Tracker fix: start_hand seeds hand_players.starting_stack = 0 when a player has
-- no row in tournament_chip_counts, which silently breaks the whole betting round.
--
-- ROOT CAUSE: start_hand reads each seated player's stack from tournament_chip_counts
-- (LEFT JOIN, COALESCE(cc.chip_count, 0)). The live viewer/tracker UI shows stacks
-- from tournament_seats.chip_count, so the operator sees real stacks — but the SERVER
-- validator (_shared/trackerEngine/handState.ts) reconstructs from hand_players.
-- starting_stack. When that is 0, a blind post is clamped to min(amount, stack)=0, so
-- highestBet stays 0 and the Edge validator (enforce mode) rejects the legal UTG call
-- with CALL_WITH_NOTHING_TO_CALL ("Không có cược nào để call"). Raise/All-in fail too.
--
-- FIX (one line): fall back to tournament_seats.chip_count when tournament_chip_counts
-- has no row for the player. This aligns the server's stack source with the client's,
-- so hand_players.starting_stack reflects the real stack. STRICTLY ADDITIVE: existing
-- tournaments that DO have tournament_chip_counts rows are unchanged (cc.chip_count
-- still wins); only the previously-zero fallback is corrected.
--
-- CREATE OR REPLACE with the IDENTICAL signature → preserves grants/owner. Body is
-- byte-identical to live (snapshot: docs/emergency_rollbacks/PRE_start_hand_stack_fallback_20260930.sql)
-- except the single COALESCE on the seat-stack source. SECURITY INVOKER preserved.

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
