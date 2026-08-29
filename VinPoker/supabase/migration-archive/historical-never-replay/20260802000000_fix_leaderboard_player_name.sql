-- Migration: Fix leaderboard to include player_name
-- Adds player_name via LEFT JOIN with profiles

CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tournament RECORD;
    v_remaining INTEGER;
    v_itm_places INTEGER;
    v_result JSONB;
BEGIN
    SELECT * INTO v_tournament FROM public.tournaments WHERE id = p_tournament_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Tournament not found');
    END IF;

    v_remaining := v_tournament.players_remaining;
    v_itm_places := v_tournament.itm_places;

    SELECT jsonb_agg(
        jsonb_build_object(
            'player_id', tec.player_id,
            'player_name', COALESCE(p.display_name, tec.player_id::text),
            'entry_number', tec.entry_number,
            'chip_count', tec.chip_count,
            'is_active', ts.is_active,
            'position', COALESCE(te.position, 0),
            'prize', COALESCE(te.prize, 0),
            'is_itm', CASE
                WHEN (te.position IS NOT NULL AND te.position <= v_itm_places) OR (te.position IS NULL AND v_remaining <= v_itm_places)
                THEN TRUE
                ELSE FALSE
            END,
            'table_id', ts.table_id,
            'seat_number', ts.seat_number
        ) ORDER BY COALESCE(te.position, 0) DESC, tec.chip_count DESC
    ) INTO v_result
    FROM public.tournament_chip_counts tec
    LEFT JOIN public.tournament_seats ts ON ts.tournament_id = tec.tournament_id AND ts.player_id = tec.player_id AND ts.entry_number = tec.entry_number
    LEFT JOIN public.tournament_eliminations te ON te.tournament_id = tec.tournament_id AND te.player_id = tec.player_id AND te.entry_number = tec.entry_number
    LEFT JOIN public.profiles p ON p.user_id = tec.player_id
    WHERE tec.tournament_id = p_tournament_id;

    RETURN jsonb_build_object(
        'tournament_id', p_tournament_id,
        'players_remaining', v_remaining,
        'itm_places', v_itm_places,
        'average_stack', v_tournament.average_stack,
        'prize_pool', v_tournament.prize_pool,
        'players', COALESCE(v_result, '[]'::JSONB)
    );
END;
$$;
