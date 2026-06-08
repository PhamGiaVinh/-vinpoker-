
-- Migration: Tournament Hand Tracking - Street Actions, Community Cards, Pot
-- Adds: street column, community_cards, pot_size, updated record_hand RPC

ALTER TABLE public.hand_actions ADD COLUMN IF NOT EXISTS street TEXT DEFAULT 'preflop';

ALTER TABLE public.tournament_hands ADD COLUMN IF NOT EXISTS community_cards JSONB DEFAULT '[]';
ALTER TABLE public.tournament_hands ADD COLUMN IF NOT EXISTS pot_size INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_hand_actions_street ON public.hand_actions(hand_id, street);

CREATE OR REPLACE FUNCTION public.record_hand(
  p_tournament_id UUID,
  p_table_id UUID,
  p_hand_number INTEGER,
  p_hand_time TIMESTAMPTZ,
  p_players JSONB,
  p_actions JSONB,
  p_side_pots JSONB DEFAULT '[]'::jsonb,
  p_community_cards JSONB DEFAULT '[]'::jsonb,
  p_pot_size INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_hand_id UUID;
    v_player JSONB;
    v_action JSONB;
    v_player_id UUID;
    v_starting_stack INTEGER;
    v_ending_stack INTEGER;
    v_is_eliminated BOOLEAN;
    v_current_remaining INTEGER;
    v_num_eliminated INTEGER := 0;
BEGIN
    SELECT players_remaining INTO v_current_remaining FROM public.tournaments WHERE id = p_tournament_id;
    IF v_current_remaining IS NULL THEN v_current_remaining := 0; END IF;

    INSERT INTO public.tournament_hands (tournament_id, table_id, hand_number, hand_time, side_pots, community_cards, pot_size)
    VALUES (p_tournament_id, p_table_id, p_hand_number, p_hand_time, p_side_pots, p_community_cards, p_pot_size)
    RETURNING id INTO v_hand_id;

    FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
    LOOP
        v_player_id := (v_player->>'player_id')::UUID;
        v_starting_stack := (v_player->>'starting_stack')::INTEGER;
        v_ending_stack := (v_player->>'ending_stack')::INTEGER;
        v_is_eliminated := (v_player->>'is_eliminated')::BOOLEAN;

        INSERT INTO public.hand_players (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots)
        VALUES (v_hand_id, p_tournament_id, v_player_id, COALESCE((v_player->>'entry_number')::INTEGER, 1), (v_player->>'seat_number')::INTEGER, v_starting_stack, v_ending_stack, v_is_eliminated, COALESCE(v_player->'side_pots', '[]'::JSONB));

        INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
        VALUES (p_tournament_id, v_player_id, COALESCE((v_player->>'entry_number')::INTEGER, 1), v_ending_stack)
        ON CONFLICT (tournament_id, player_id, entry_number)
        DO UPDATE SET chip_count = v_ending_stack, updated_at = now();

        IF v_is_eliminated THEN
            v_num_eliminated := v_num_eliminated + 1;
        END IF;
    END LOOP;

    FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
    LOOP
        v_player_id := (v_player->>'player_id')::UUID;
        v_is_eliminated := (v_player->>'is_eliminated')::BOOLEAN;

        IF v_is_eliminated THEN
            INSERT INTO public.tournament_eliminations (tournament_id, player_id, entry_number, hand_id, position, prize)
            VALUES (p_tournament_id, v_player_id, COALESCE((v_player->>'entry_number')::INTEGER, 1), v_hand_id, v_current_remaining, 0);
        END IF;
    END LOOP;

    FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
    LOOP
        INSERT INTO public.hand_actions (hand_id, player_id, entry_number, action_type, action_amount, action_order, street)
        VALUES (
            v_hand_id,
            (v_action->>'player_id')::UUID,
            COALESCE((v_action->>'entry_number')::INTEGER, 1),
            v_action->>'action_type',
            COALESCE((v_action->>'action_amount')::INTEGER, 0),
            (v_action->>'action_order')::INTEGER,
            COALESCE(v_action->>'street', 'preflop')
        );
    END LOOP;

    UPDATE public.tournaments
    SET players_remaining = v_current_remaining - v_num_eliminated,
        average_stack = (SELECT AVG(chip_count) FROM public.tournament_chip_counts WHERE tournament_id = p_tournament_id)
    WHERE id = p_tournament_id;

    RETURN jsonb_build_object('hand_id', v_hand_id, 'status', 'success');
END;
$$;
