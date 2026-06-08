-- Migration: Tournament Live Tracker (P0 Fixes)
-- Date: 2026-06-08
-- Includes: 8 new tables, 1 view, 17 RPCs, RLS policies, indexes
-- Fixes from review: ON CONFLICT target, NULL guard, simultaneous elimination, ITM bubble, bulk update, undo cascade, side_pots, post actions, auth pattern

-- 1. ALTER TABLE tournaments
ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS current_level INTEGER,
    ADD COLUMN IF NOT EXISTS current_blinds TEXT,
    ADD COLUMN IF NOT EXISTS current_level_id UUID,
    ADD COLUMN IF NOT EXISTS clock_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS clock_paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pause_accumulated INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS players_remaining INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS average_stack INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS prize_pool NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS itm_places INTEGER DEFAULT 0;

-- 2. CREATE tournament_levels
CREATE TABLE IF NOT EXISTS public.tournament_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    level_number INTEGER NOT NULL,
    small_blind INTEGER NOT NULL DEFAULT 0,
    big_blind INTEGER NOT NULL DEFAULT 0,
    ante INTEGER NOT NULL DEFAULT 0,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    is_break BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_levels_unique ON public.tournament_levels(tournament_id, level_number);
CREATE INDEX IF NOT EXISTS idx_tournament_levels_tournament ON public.tournament_levels(tournament_id);

-- 3. CREATE tournament_seats
CREATE TABLE IF NOT EXISTS public.tournament_seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    entry_number INTEGER NOT NULL DEFAULT 1,
    table_id UUID NOT NULL REFERENCES public.game_tables(id),
    seat_number INTEGER NOT NULL,
    chip_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_seats_active ON public.tournament_seats(tournament_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tournament_seats_table ON public.tournament_seats(tournament_id, table_id);

-- 4. CREATE tournament_hands
CREATE TABLE IF NOT EXISTS public.tournament_hands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES public.game_tables(id),
    hand_number INTEGER NOT NULL,
    hand_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    side_pots JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_hands_unique ON public.tournament_hands(tournament_id, table_id, hand_number);
CREATE INDEX IF NOT EXISTS idx_tournament_hands_tournament ON public.tournament_hands(tournament_id);

-- 5. CREATE hand_players
CREATE TABLE IF NOT EXISTS public.hand_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hand_id UUID NOT NULL REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    entry_number INTEGER NOT NULL DEFAULT 1,
    seat_number INTEGER NOT NULL,
    starting_stack INTEGER NOT NULL,
    ending_stack INTEGER NOT NULL,
    is_eliminated BOOLEAN NOT NULL DEFAULT FALSE,
    side_pots JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hand_players_hand ON public.hand_players(hand_id);
CREATE INDEX IF NOT EXISTS idx_hand_players_tournament ON public.hand_players(tournament_id);

-- 6. CREATE hand_actions
CREATE TABLE IF NOT EXISTS public.hand_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hand_id UUID NOT NULL REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    entry_number INTEGER NOT NULL DEFAULT 1,
    action_type TEXT NOT NULL,
    action_amount INTEGER DEFAULT 0,
    action_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hand_actions_hand ON public.hand_actions(hand_id);
CREATE INDEX IF NOT EXISTS idx_hand_actions_hand_order ON public.hand_actions(hand_id, action_order);

-- 7. CREATE tournament_chip_counts
CREATE TABLE IF NOT EXISTS public.tournament_chip_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    entry_number INTEGER NOT NULL DEFAULT 1,
    chip_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, player_id, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_tournament_chip_counts_tournament ON public.tournament_chip_counts(tournament_id);

-- 8. CREATE tournament_eliminations
CREATE TABLE IF NOT EXISTS public.tournament_eliminations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    entry_number INTEGER NOT NULL DEFAULT 1,
    hand_id UUID NOT NULL REFERENCES public.tournament_hands(id),
    position INTEGER NOT NULL,
    prize NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournament_eliminations_tournament ON public.tournament_eliminations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_eliminations_position ON public.tournament_eliminations(tournament_id, position);

-- 9. CREATE tournament_state_transitions
CREATE TABLE IF NOT EXISTS public.tournament_state_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    previous_state TEXT NOT NULL,
    new_state TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by UUID REFERENCES auth.users(id),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tournament_state_transitions_tournament ON public.tournament_state_transitions(tournament_id);

-- 10. CREATE tournament_prizes
CREATE TABLE IF NOT EXISTS public.tournament_prizes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    percentage NUMERIC(5,2) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, position)
);

CREATE INDEX IF NOT EXISTS idx_tournament_prizes_tournament ON public.tournament_prizes(tournament_id);

-- 11. CREATE VIEW tournament_leaderboard_view
CREATE OR REPLACE VIEW public.tournament_leaderboard_view AS
SELECT 
    t.id AS tournament_id,
    tec.player_id,
    tec.entry_number,
    COALESCE(te.position, 0) AS position,
    COALESCE(te.prize, 0) AS prize,
    tec.chip_count,
    ts.is_active,
    ts.table_id,
    ts.seat_number,
    te.hand_id AS elimination_hand_id,
    CASE 
        WHEN (te.position IS NOT NULL AND te.position <= t.itm_places) OR (te.position IS NULL AND t.players_remaining <= t.itm_places) 
        THEN TRUE 
        ELSE FALSE 
    END AS is_itm
FROM public.tournaments t
LEFT JOIN public.tournament_chip_counts tec ON tec.tournament_id = t.id
LEFT JOIN public.tournament_seats ts ON ts.tournament_id = t.id AND ts.player_id = tec.player_id AND ts.entry_number = tec.entry_number
LEFT JOIN public.tournament_eliminations te ON te.tournament_id = t.id AND te.player_id = tec.player_id AND te.entry_number = tec.entry_number;

-- 12. CREATE RPC get_tournament_clock
CREATE OR REPLACE FUNCTION public.get_tournament_clock(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tournament RECORD;
    v_elapsed INTEGER;
    v_remaining INTEGER;
    v_current_level RECORD;
    v_is_running BOOLEAN;
    v_is_break BOOLEAN;
BEGIN
    SELECT * INTO v_tournament FROM public.tournaments WHERE id = p_tournament_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Tournament not found');
    END IF;
    
    IF v_tournament.clock_started_at IS NULL THEN
        RETURN jsonb_build_object(
            'tournament_id', p_tournament_id,
            'status', v_tournament.status,
            'is_running', FALSE,
            'elapsed_seconds', 0,
            'remaining_seconds', 0,
            'current_level', NULL,
            'is_break', FALSE,
            'message', 'Clock not started'
        );
    END IF;
    
    v_elapsed := EXTRACT(EPOCH FROM (COALESCE(v_tournament.clock_paused_at, now()) - v_tournament.clock_started_at))::INTEGER - COALESCE(v_tournament.pause_accumulated, 0);
    
    SELECT * INTO v_current_level FROM public.tournament_levels 
    WHERE tournament_id = p_tournament_id AND level_number = v_tournament.current_level;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'tournament_id', p_tournament_id,
            'status', v_tournament.status,
            'is_running', FALSE,
            'elapsed_seconds', v_elapsed,
            'remaining_seconds', 0,
            'current_level', NULL,
            'is_break', FALSE,
            'message', 'Current level not found'
        );
    END IF;
    
    v_remaining := (v_current_level.duration_minutes * 60) - v_elapsed;
    v_is_break := v_current_level.is_break;
    v_is_running := (v_tournament.status IN ('live', 'final_table')) AND (v_tournament.clock_paused_at IS NULL);
    
    RETURN jsonb_build_object(
        'tournament_id', p_tournament_id,
        'status', v_tournament.status,
        'is_running', v_is_running,
        'elapsed_seconds', v_elapsed,
        'remaining_seconds', GREATEST(v_remaining, 0),
        'current_level', jsonb_build_object(
            'id', v_current_level.id,
            'level_number', v_current_level.level_number,
            'small_blind', v_current_level.small_blind,
            'big_blind', v_current_level.big_blind,
            'ante', v_current_level.ante,
            'duration_minutes', v_current_level.duration_minutes,
            'is_break', v_current_level.is_break
        ),
        'is_break', v_is_break,
        'next_level', (SELECT jsonb_build_object(
            'id', id,
            'level_number', level_number,
            'small_blind', small_blind,
            'big_blind', big_blind,
            'ante', ante,
            'duration_minutes', duration_minutes,
            'is_break', is_break
        ) FROM public.tournament_levels WHERE tournament_id = p_tournament_id AND level_number = v_tournament.current_level + 1)
    );
END;
$$;

-- 13. CREATE RPC get_tournament_leaderboard
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

-- 14. CREATE RPC get_next_hand_number
CREATE OR REPLACE FUNCTION public.get_next_hand_number(p_tournament_id UUID, p_table_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_number INTEGER;
BEGIN
    SELECT COALESCE(MAX(hand_number), 0) + 1 INTO v_next_number
    FROM public.tournament_hands
    WHERE tournament_id = p_tournament_id AND table_id = p_table_id;
    RETURN v_next_number;
END;
$$;

-- 15. CREATE RPC get_seats_for_draw
CREATE OR REPLACE FUNCTION public.get_seats_for_draw(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'seat_id', ts.id,
            'player_id', ts.player_id,
            'entry_number', ts.entry_number,
            'table_id', ts.table_id,
            'seat_number', ts.seat_number,
            'chip_count', ts.chip_count,
            'is_active', ts.is_active
        ) ORDER BY ts.table_id, ts.seat_number
    ) INTO v_result
    FROM public.tournament_seats ts
    WHERE ts.tournament_id = p_tournament_id AND ts.is_active = TRUE;
    
    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- 16. CREATE RPC record_hand
CREATE OR REPLACE FUNCTION public.record_hand(
    p_tournament_id UUID,
    p_table_id UUID,
    p_hand_number INTEGER,
    p_hand_time TIMESTAMPTZ,
    p_players JSONB,
    p_actions JSONB,
    p_side_pots JSONB DEFAULT '[]'::JSONB
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
    v_action_type TEXT;
    v_action_amount INTEGER;
    v_action_order INTEGER;
    v_entry_number INTEGER;
    v_current_remaining INTEGER;
    v_num_eliminated INTEGER := 0;
BEGIN
    SELECT players_remaining INTO v_current_remaining FROM public.tournaments WHERE id = p_tournament_id;
    IF v_current_remaining IS NULL THEN v_current_remaining := 0; END IF;

    INSERT INTO public.tournament_hands (tournament_id, table_id, hand_number, hand_time, side_pots)
    VALUES (p_tournament_id, p_table_id, p_hand_number, p_hand_time, p_side_pots)
    RETURNING id INTO v_hand_id;
    
    FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
    LOOP
        v_player_id := (v_player->>'player_id')::UUID;
        v_entry_number := COALESCE((v_player->>'entry_number')::INTEGER, 1);
        v_starting_stack := (v_player->>'starting_stack')::INTEGER;
        v_ending_stack := (v_player->>'ending_stack')::INTEGER;
        v_is_eliminated := (v_player->>'is_eliminated')::BOOLEAN;
        
        INSERT INTO public.hand_players (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots)
        VALUES (v_hand_id, p_tournament_id, v_player_id, v_entry_number, (v_player->>'seat_number')::INTEGER, v_starting_stack, v_ending_stack, v_is_eliminated, COALESCE(v_player->'side_pots', '[]'::JSONB));
        
        INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
        VALUES (p_tournament_id, v_player_id, v_entry_number, v_ending_stack)
        ON CONFLICT (tournament_id, player_id, entry_number)
        DO UPDATE SET chip_count = v_ending_stack, updated_at = now();
        
        IF v_is_eliminated THEN
            v_num_eliminated := v_num_eliminated + 1;
        END IF;
    END LOOP;
    
    FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
    LOOP
        v_player_id := (v_player->>'player_id')::UUID;
        v_entry_number := COALESCE((v_player->>'entry_number')::INTEGER, 1);
        v_is_eliminated := (v_player->>'is_eliminated')::BOOLEAN;
        
        IF v_is_eliminated THEN
            INSERT INTO public.tournament_eliminations (tournament_id, player_id, entry_number, hand_id, position, prize)
            VALUES (p_tournament_id, v_player_id, v_entry_number, v_hand_id, v_current_remaining, 0);
        END IF;
    END LOOP;
    
    FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
    LOOP
        INSERT INTO public.hand_actions (hand_id, player_id, entry_number, action_type, action_amount, action_order)
        VALUES (
            v_hand_id,
            (v_action->>'player_id')::UUID,
            COALESCE((v_action->>'entry_number')::INTEGER, 1),
            v_action->>'action_type',
            COALESCE((v_action->>'action_amount')::INTEGER, 0),
            (v_action->>'action_order')::INTEGER
        );
    END LOOP;
    
    UPDATE public.tournaments
    SET players_remaining = v_current_remaining - v_num_eliminated,
        average_stack = (SELECT AVG(chip_count) FROM public.tournament_chip_counts WHERE tournament_id = p_tournament_id)
    WHERE id = p_tournament_id;
    
    RETURN jsonb_build_object('hand_id', v_hand_id, 'status', 'success');
END;
$$;

-- 17. CREATE RPC update_stack
CREATE OR REPLACE FUNCTION public.update_stack(
    p_tournament_id UUID,
    p_player_id UUID,
    p_entry_number INTEGER,
    p_chip_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
    VALUES (p_tournament_id, p_player_id, p_entry_number, p_chip_count)
    ON CONFLICT (tournament_id, player_id, entry_number)
    DO UPDATE SET chip_count = p_chip_count, updated_at = now();
    
    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- 18. CREATE RPC undo_last_action
CREATE OR REPLACE FUNCTION public.undo_last_action(p_hand_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted_action RECORD;
    v_tournament_id UUID;
    v_remaining_actions JSONB;
    v_current_stacks JSONB;
    v_action JSONB;
    v_player_id UUID;
    v_amount INTEGER;
    v_action_type TEXT;
    v_num_eliminated INTEGER := 0;
BEGIN
    SELECT tournament_id INTO v_tournament_id FROM public.tournament_hands WHERE id = p_hand_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Hand not found');
    END IF;
    
    WITH deleted AS (
        DELETE FROM public.hand_actions
        WHERE id = (
            SELECT id FROM public.hand_actions
            WHERE hand_id = p_hand_id
            ORDER BY action_order DESC
            LIMIT 1
        )
        RETURNING *
    )
    SELECT * INTO v_deleted_action FROM deleted;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'No actions to undo');
    END IF;
    
    SELECT jsonb_agg(
        jsonb_build_object(
            'player_id', player_id,
            'starting_stack', starting_stack
        )
    ) INTO v_current_stacks
    FROM public.hand_players
    WHERE hand_id = p_hand_id;
    
    FOR v_action IN SELECT * FROM jsonb_array_elements(v_current_stacks)
    LOOP
        UPDATE public.tournament_chip_counts
        SET chip_count = (v_action->>'starting_stack')::INTEGER,
            updated_at = now()
        WHERE tournament_id = v_tournament_id
        AND player_id = (v_action->>'player_id')::UUID;
    END LOOP;
    
    SELECT jsonb_agg(
        jsonb_build_object(
            'player_id', player_id,
            'action_type', action_type,
            'action_amount', action_amount,
            'action_order', action_order
        ) ORDER BY action_order
    ) INTO v_remaining_actions
    FROM public.hand_actions
    WHERE hand_id = p_hand_id;
    
    IF v_remaining_actions IS NOT NULL THEN
        FOR v_action IN SELECT * FROM jsonb_array_elements(v_remaining_actions)
        LOOP
            v_player_id := (v_action->>'player_id')::UUID;
            v_amount := COALESCE((v_action->>'action_amount')::INTEGER, 0);
            v_action_type := v_action->>'action_type';
            
            IF v_action_type IN ('bet', 'raise', 'call', 'post_sb', 'post_bb', 'post_ante', 'all_in') THEN
                UPDATE public.tournament_chip_counts
                SET chip_count = chip_count - v_amount,
                    updated_at = now()
                WHERE tournament_id = v_tournament_id
                AND player_id = v_player_id;
            ELSIF v_action_type IN ('win', 'take_pot', 'return_bet') THEN
                UPDATE public.tournament_chip_counts
                SET chip_count = chip_count + v_amount,
                    updated_at = now()
                WHERE tournament_id = v_tournament_id
                AND player_id = v_player_id;
            END IF;
        END LOOP;
    END IF;
    
    UPDATE public.hand_players hp
    SET ending_stack = tcc.chip_count,
        is_eliminated = (tcc.chip_count = 0)
    FROM public.tournament_chip_counts tcc
    WHERE hp.hand_id = p_hand_id
    AND hp.player_id = tcc.player_id
    AND tcc.tournament_id = v_tournament_id;
    
    DELETE FROM public.tournament_eliminations
    WHERE tournament_id = v_tournament_id
    AND hand_id = p_hand_id;
    
    FOR v_action IN SELECT * FROM jsonb_array_elements(v_current_stacks)
    LOOP
        v_player_id := (v_action->>'player_id')::UUID;
        SELECT COUNT(*) INTO v_num_eliminated FROM public.hand_players WHERE hand_id = p_hand_id AND player_id = v_player_id AND is_eliminated = TRUE;
        IF v_num_eliminated > 0 THEN
            INSERT INTO public.tournament_eliminations (tournament_id, player_id, entry_number, hand_id, position, prize)
            SELECT v_tournament_id, hp.player_id, hp.entry_number, p_hand_id, t.players_remaining, 0
            FROM public.hand_players hp
            CROSS JOIN public.tournaments t
            WHERE hp.hand_id = p_hand_id AND hp.player_id = v_player_id AND hp.is_eliminated = TRUE AND t.id = v_tournament_id;
        END IF;
    END LOOP;
    
    UPDATE public.tournaments
    SET players_remaining = (
        SELECT COUNT(*) FROM public.tournament_seats 
        WHERE tournament_id = v_tournament_id AND is_active = TRUE
    ),
    average_stack = (
        SELECT AVG(chip_count) FROM public.tournament_chip_counts 
        WHERE tournament_id = v_tournament_id
    )
    WHERE id = v_tournament_id;
    
    RETURN jsonb_build_object(
        'status', 'success',
        'deleted_action_id', v_deleted_action.id,
        'deleted_action_type', v_deleted_action.action_type
    );
END;
$$;

-- 19. CREATE RPC re_enter_tournament
CREATE OR REPLACE FUNCTION public.re_enter_tournament(
    p_tournament_id UUID,
    p_player_id UUID,
    p_new_chip_count INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_entry INTEGER;
BEGIN
    SELECT COALESCE(MAX(entry_number), 0) + 1 INTO v_next_entry
    FROM public.tournament_chip_counts
    WHERE tournament_id = p_tournament_id AND player_id = p_player_id;
    
    INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
    VALUES (p_tournament_id, p_player_id, v_next_entry, p_new_chip_count);
    
    UPDATE public.tournament_seats
    SET is_active = TRUE,
        chip_count = p_new_chip_count,
        entry_number = v_next_entry
    WHERE tournament_id = p_tournament_id AND player_id = p_player_id;
    
    RETURN jsonb_build_object('status', 'success', 'entry_number', v_next_entry);
END;
$$;

-- 20. CREATE RPC bulk_update_stacks
CREATE OR REPLACE FUNCTION public.bulk_update_stacks(
    p_tournament_id UUID,
    p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
    SELECT 
        p_tournament_id,
        (elem->>'player_id')::UUID,
        COALESCE((elem->>'entry_number')::INTEGER, 1),
        (elem->>'chip_count')::INTEGER
    FROM jsonb_array_elements(p_updates) AS elem
    ON CONFLICT (tournament_id, player_id, entry_number)
    DO UPDATE SET 
        chip_count = EXCLUDED.chip_count,
        updated_at = now();
    
    RETURN jsonb_build_object('status', 'success', 'updated', jsonb_array_length(p_updates));
END;
$$;

-- 21. CREATE RPC get_tournament_state
CREATE OR REPLACE FUNCTION public.get_tournament_state(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_state RECORD;
BEGIN
    SELECT * INTO v_state FROM public.tournaments WHERE id = p_tournament_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Tournament not found');
    END IF;
    
    RETURN jsonb_build_object(
        'tournament_id', v_state.id,
        'status', v_state.status,
        'current_level', v_state.current_level,
        'current_blinds', v_state.current_blinds,
        'players_remaining', v_state.players_remaining,
        'average_stack', v_state.average_stack,
        'prize_pool', v_state.prize_pool,
        'itm_places', v_state.itm_places,
        'clock_started_at', v_state.clock_started_at,
        'clock_paused_at', v_state.clock_paused_at
    );
END;
$$;

-- 22. CREATE RPC update_tournament_state
CREATE OR REPLACE FUNCTION public.update_tournament_state(
    p_tournament_id UUID,
    p_status TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_prev_state TEXT;
BEGIN
    SELECT status INTO v_prev_state FROM public.tournaments WHERE id = p_tournament_id;
    
    UPDATE public.tournaments
    SET status = p_status,
        updated_at = now()
    WHERE id = p_tournament_id;
    
    INSERT INTO public.tournament_state_transitions (tournament_id, previous_state, new_state, reason)
    VALUES (p_tournament_id, v_prev_state, p_status, p_reason);
    
    RETURN jsonb_build_object('status', 'success', 'previous_state', v_prev_state, 'new_state', p_status);
END;
$$;

-- 23. CREATE RPC get_tournament_blinds
CREATE OR REPLACE FUNCTION public.get_tournament_blinds(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', id,
            'level_number', level_number,
            'small_blind', small_blind,
            'big_blind', big_blind,
            'ante', ante,
            'duration_minutes', duration_minutes,
            'is_break', is_break
        ) ORDER BY level_number
    ) INTO v_result
    FROM public.tournament_levels
    WHERE tournament_id = p_tournament_id;
    
    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- 24. CREATE RPC update_tournament_blinds
CREATE OR REPLACE FUNCTION public.update_tournament_blinds(
    p_tournament_id UUID,
    p_blinds JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_blind JSONB;
BEGIN
    FOR v_blind IN SELECT * FROM jsonb_array_elements(p_blinds)
    LOOP
        INSERT INTO public.tournament_levels (tournament_id, level_number, small_blind, big_blind, ante, duration_minutes, is_break)
        VALUES (
            p_tournament_id,
            (v_blind->>'level_number')::INTEGER,
            (v_blind->>'small_blind')::INTEGER,
            (v_blind->>'big_blind')::INTEGER,
            COALESCE((v_blind->>'ante')::INTEGER, 0),
            COALESCE((v_blind->>'duration_minutes')::INTEGER, 0),
            COALESCE((v_blind->>'is_break')::BOOLEAN, FALSE)
        )
        ON CONFLICT (tournament_id, level_number)
        DO UPDATE SET
            small_blind = EXCLUDED.small_blind,
            big_blind = EXCLUDED.big_blind,
            ante = EXCLUDED.ante,
            duration_minutes = EXCLUDED.duration_minutes,
            is_break = EXCLUDED.is_break;
    END LOOP;
    
    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- 25. CREATE RPC import_blind_structure
CREATE OR REPLACE FUNCTION public.import_blind_structure(
    p_tournament_id UUID,
    p_csv_data TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_lines TEXT[];
    v_line TEXT;
    v_parts TEXT[];
    v_level_number INTEGER := 1;
BEGIN
    v_lines := string_to_array(p_csv_data, E'\n');
    
    FOREACH v_line IN ARRAY v_lines
    LOOP
        v_parts := string_to_array(trim(v_line), ',');
        IF array_length(v_parts, 1) >= 2 THEN
            INSERT INTO public.tournament_levels (tournament_id, level_number, small_blind, big_blind, ante, duration_minutes, is_break)
            VALUES (
                p_tournament_id,
                v_level_number,
                (v_parts[1])::INTEGER,
                (v_parts[2])::INTEGER,
                COALESCE((v_parts[3])::INTEGER, 0),
                COALESCE((v_parts[4])::INTEGER, 20),
                COALESCE((v_parts[5])::BOOLEAN, FALSE)
            )
            ON CONFLICT (tournament_id, level_number)
            DO UPDATE SET
                small_blind = EXCLUDED.small_blind,
                big_blind = EXCLUDED.big_blind,
                ante = EXCLUDED.ante,
                duration_minutes = EXCLUDED.duration_minutes,
                is_break = EXCLUDED.is_break;
            v_level_number := v_level_number + 1;
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object('status', 'success', 'levels_imported', v_level_number - 1);
END;
$$;

-- 26. CREATE RPC get_tournament_prizes
CREATE OR REPLACE FUNCTION public.get_tournament_prizes(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'position', position,
            'percentage', percentage,
            'amount', amount
        ) ORDER BY position
    ) INTO v_result
    FROM public.tournament_prizes
    WHERE tournament_id = p_tournament_id;
    
    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- 27. CREATE RPC update_tournament_prizes
CREATE OR REPLACE FUNCTION public.update_tournament_prizes(
    p_tournament_id UUID,
    p_prizes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_prize JSONB;
BEGIN
    DELETE FROM public.tournament_prizes WHERE tournament_id = p_tournament_id;
    
    FOR v_prize IN SELECT * FROM jsonb_array_elements(p_prizes)
    LOOP
        INSERT INTO public.tournament_prizes (tournament_id, position, percentage, amount)
        VALUES (
            p_tournament_id,
            (v_prize->>'position')::INTEGER,
            (v_prize->>'percentage')::NUMERIC,
            (v_prize->>'amount')::NUMERIC
        );
    END LOOP;
    
    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- 28. CREATE RPC get_tournament_tables
CREATE OR REPLACE FUNCTION public.get_tournament_tables(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'table_id', tt.table_id,
            'table_name', gt.table_name,
            'status', gt.status,
            'current_blind_level', gt.current_blind_level
        ) ORDER BY gt.table_name
    ) INTO v_result
    FROM public.tournament_tables tt
    JOIN public.game_tables gt ON gt.id = tt.table_id
    WHERE tt.tournament_id = p_tournament_id;
    
    RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- 29. Enable RLS on all new tables
ALTER TABLE public.tournament_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_hands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hand_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hand_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_chip_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_eliminations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_prizes ENABLE ROW LEVEL SECURITY;

-- 30. Create RLS policies
DO $$
BEGIN
    -- tournament_levels
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_levels' AND policyname = 'Tournament levels viewable by all authenticated users') THEN
        CREATE POLICY "Tournament levels viewable by all authenticated users" ON public.tournament_levels FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_levels' AND policyname = 'Tournament levels manageable by admins') THEN
        CREATE POLICY "Tournament levels manageable by admins" ON public.tournament_levels FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournaments t
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE t.id = tournament_levels.tournament_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- tournament_seats
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_seats' AND policyname = 'Tournament seats viewable by all authenticated users') THEN
        CREATE POLICY "Tournament seats viewable by all authenticated users" ON public.tournament_seats FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_seats' AND policyname = 'Tournament seats manageable by admins') THEN
        CREATE POLICY "Tournament seats manageable by admins" ON public.tournament_seats FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournaments t
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE t.id = tournament_seats.tournament_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- tournament_hands
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_hands' AND policyname = 'Tournament hands viewable by all authenticated users') THEN
        CREATE POLICY "Tournament hands viewable by all authenticated users" ON public.tournament_hands FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_hands' AND policyname = 'Tournament hands manageable by admins') THEN
        CREATE POLICY "Tournament hands manageable by admins" ON public.tournament_hands FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournaments t
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE t.id = tournament_hands.tournament_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- hand_players
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hand_players' AND policyname = 'Hand players viewable by all authenticated users') THEN
        CREATE POLICY "Hand players viewable by all authenticated users" ON public.hand_players FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hand_players' AND policyname = 'Hand players manageable by admins') THEN
        CREATE POLICY "Hand players manageable by admins" ON public.hand_players FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournament_hands th
                JOIN public.tournaments t ON t.id = th.tournament_id
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE th.id = hand_players.hand_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- hand_actions
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hand_actions' AND policyname = 'Hand actions viewable by all authenticated users') THEN
        CREATE POLICY "Hand actions viewable by all authenticated users" ON public.hand_actions FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hand_actions' AND policyname = 'Hand actions manageable by admins') THEN
        CREATE POLICY "Hand actions manageable by admins" ON public.hand_actions FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournament_hands th
                JOIN public.tournaments t ON t.id = th.tournament_id
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE th.id = hand_actions.hand_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- tournament_chip_counts
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_chip_counts' AND policyname = 'Tournament chip counts viewable by all authenticated users') THEN
        CREATE POLICY "Tournament chip counts viewable by all authenticated users" ON public.tournament_chip_counts FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_chip_counts' AND policyname = 'Tournament chip counts manageable by admins') THEN
        CREATE POLICY "Tournament chip counts manageable by admins" ON public.tournament_chip_counts FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournaments t
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE t.id = tournament_chip_counts.tournament_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- tournament_eliminations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_eliminations' AND policyname = 'Tournament eliminations viewable by all authenticated users') THEN
        CREATE POLICY "Tournament eliminations viewable by all authenticated users" ON public.tournament_eliminations FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_eliminations' AND policyname = 'Tournament eliminations manageable by admins') THEN
        CREATE POLICY "Tournament eliminations manageable by admins" ON public.tournament_eliminations FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournaments t
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE t.id = tournament_eliminations.tournament_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- tournament_state_transitions
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_state_transitions' AND policyname = 'Tournament state transitions viewable by all authenticated users') THEN
        CREATE POLICY "Tournament state transitions viewable by all authenticated users" ON public.tournament_state_transitions FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_state_transitions' AND policyname = 'Tournament state transitions manageable by admins') THEN
        CREATE POLICY "Tournament state transitions manageable by admins" ON public.tournament_state_transitions FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournaments t
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE t.id = tournament_state_transitions.tournament_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;

    -- tournament_prizes
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_prizes' AND policyname = 'Tournament prizes viewable by all authenticated users') THEN
        CREATE POLICY "Tournament prizes viewable by all authenticated users" ON public.tournament_prizes FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournament_prizes' AND policyname = 'Tournament prizes manageable by admins') THEN
        CREATE POLICY "Tournament prizes manageable by admins" ON public.tournament_prizes FOR ALL TO authenticated USING (
            EXISTS (
                SELECT 1 FROM public.tournaments t
                LEFT JOIN public.clubs c ON c.id = t.club_id
                LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
                WHERE t.id = tournament_prizes.tournament_id
                AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
            )
        );
    END IF;
END
$$;
