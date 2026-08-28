-- ============================================================================
-- update_blind_structure — full-replace save for the Floor blind editor
-- ============================================================================
-- SOURCE-ONLY in the Floor UI/UX redesign PR. NOT applied to production here.
-- Requires a separate controlled DB apply before the BlindEditorPanel "Lưu" is
-- enabled in production (until then the UI shows Save disabled = "Cần bật RPC").
--
-- Mirrors public.update_tournament_prizes (DELETE-then-INSERT, SECURITY INVOKER):
-- it runs as the caller, so the existing tournament_levels RLS
-- ("manageable by admins" = club owner / club_cashier) is the authorization gate.
-- Replaces the whole stored blind structure for a tournament in one call so the
-- editor can add / edit / delete levels without orphaning rows that
-- import_blind_structure (insert-or-update only) would leave behind.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_blind_structure(
    p_tournament_id UUID,
    p_levels JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_level JSONB;
    v_count INTEGER := 0;
BEGIN
    DELETE FROM public.tournament_levels WHERE tournament_id = p_tournament_id;

    FOR v_level IN SELECT * FROM jsonb_array_elements(p_levels)
    LOOP
        INSERT INTO public.tournament_levels (
            tournament_id, level_number, small_blind, big_blind, ante, duration_minutes, is_break
        )
        VALUES (
            p_tournament_id,
            (v_level->>'level_number')::INTEGER,
            COALESCE((v_level->>'small_blind')::INTEGER, 0),
            COALESCE((v_level->>'big_blind')::INTEGER, 0),
            COALESCE((v_level->>'ante')::INTEGER, 0),
            COALESCE((v_level->>'duration_minutes')::INTEGER, 0),
            COALESCE((v_level->>'is_break')::BOOLEAN, FALSE)
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('status', 'success', 'levels_saved', v_count);
END;
$$;
