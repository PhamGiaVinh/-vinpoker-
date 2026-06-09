-- ============================================================
-- 20260803000000_fix_dealer_button_tracking.sql
-- Adds button_seat to tournament_hands, recreates start_hand RPC
-- ============================================================

-- A. Add button_seat column with constraint
ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS button_seat INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.tournament_hands
  DROP CONSTRAINT IF EXISTS tournament_hands_button_seat_check,
  ADD CONSTRAINT tournament_hands_button_seat_check
    CHECK (button_seat >= 1 AND button_seat <= 10);

CREATE INDEX IF NOT EXISTS idx_tournament_hands_table_button
  ON public.tournament_hands(tournament_id, table_id, hand_number DESC);

-- B. Backfill existing hands with a reasonable default (seat 1)
UPDATE public.tournament_hands
SET button_seat = 1
WHERE button_seat IS NULL;

-- C. Drop old start_hand signature (5 params)
DROP FUNCTION IF EXISTS public.start_hand(
  p_tournament_id UUID,
  p_table_id UUID,
  p_hand_number INTEGER,
  p_hand_time TIMESTAMPTZ,
  p_created_by UUID
);

-- D. Recreate start_hand with p_button_seat parameter
CREATE OR REPLACE FUNCTION public.start_hand(
  p_tournament_id UUID,
  p_table_id UUID,
  p_hand_number INTEGER,
  p_hand_time TIMESTAMPTZ DEFAULT NOW(),
  p_created_by UUID DEFAULT NULL,
  p_button_seat INTEGER DEFAULT 1
)
RETURNS JSONB LANGUAGE plpgsql AS $$
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
           COALESCE(cc.chip_count, 0) AS chip_count
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
$$;
