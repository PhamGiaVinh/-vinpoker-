-- ROLLBACK for 20261014000000_void_last_hand_active_seat_guard.sql
-- Re-applies the ORIGINAL void_last_hand (from 20260617000000) verbatim.
-- Run this in the Supabase SQL editor / via Management API to revert the guard fix.

CREATE OR REPLACE FUNCTION public.void_last_hand(p_hand_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tournament_id UUID;
  v_hand_record RECORD;
  v_player_record RECORD;
BEGIN
  SELECT * INTO v_hand_record FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_hand_record.is_voided THEN
    RETURN jsonb_build_object('error', 'Hand already voided');
  END IF;

  v_tournament_id := v_hand_record.tournament_id;

  IF v_hand_record.status = 'completed' THEN
    FOR v_player_record IN
      SELECT * FROM public.hand_players WHERE hand_id = p_hand_id
    LOOP
      UPDATE public.tournament_chip_counts
      SET chip_count = v_player_record.starting_stack, updated_at = NOW()
      WHERE tournament_id = v_tournament_id
        AND player_id = v_player_record.player_id
        AND entry_number = v_player_record.entry_number;

      UPDATE public.tournament_seats
      SET chip_count = v_player_record.starting_stack, is_active = true
      WHERE tournament_id = v_tournament_id
        AND player_id = v_player_record.player_id
        AND entry_number = v_player_record.entry_number;
    END LOOP;

    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
  END IF;

  IF v_hand_record.status = 'in_progress' THEN
    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;
    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
    UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false WHERE hand_id = p_hand_id;
  END IF;

  UPDATE public.tournament_hands
  SET is_voided = true, status = 'voided',
      locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
  WHERE id = p_hand_id;

  UPDATE public.tournaments
  SET players_remaining = (
      SELECT COUNT(*) FROM public.tournament_seats WHERE tournament_id = v_tournament_id AND is_active = true
    ),
    average_stack = (
      SELECT COALESCE(AVG(chip_count), 0) FROM public.tournament_chip_counts WHERE tournament_id = v_tournament_id
    ),
    updated_at = NOW()
  WHERE id = v_tournament_id;

  RETURN jsonb_build_object('status', 'success', 'message', 'Hand voided successfully', 'hand_id', p_hand_id);
END;
$$;
