-- ============================================================================
-- Floor Table Ops Phase A1 — open_tournament_table RPC  (SOURCE-ONLY, NOT APPLIED)
-- ============================================================================
-- Manually open a tournament table: CREATE a new table (+ linked game_tables row)
-- OR REOPEN a closed one. Always an operator action — never auto-runs, never
-- auto-closes. Actor = auth.uid() ONLY (no client actor id). Owner/cashier gate.
-- Atomic. No money. Mirrors the seed's table-creation shape (game_tables +
-- tournament_tables) and the auth pattern of create_offline_buyin_and_seat.
--
-- NO seat_assignment_history row: that table requires NOT NULL entry_id/player_id/
-- to_seat_number, and opening a table has none — the new tournament_tables row IS
-- the record.
--
-- ROLLBACK: DROP FUNCTION public.open_tournament_table(uuid, integer, integer);
--   (it is a brand-new object — no prior body to restore.)
-- Controlled apply only (preflight pg_proc absent -> CREATE -> verify grants/
-- SECURITY DEFINER/search_path). NO supabase db push, NO deploy_db, NO schema_migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.open_tournament_table(
  p_tournament_id  UUID,
  p_table_number   INTEGER DEFAULT NULL,   -- NULL → next available number
  p_max_seats      INTEGER DEFAULT NULL    -- NULL → mode of existing tables, else 9
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_authorized BOOLEAN;
  v_tour       RECORD;
  v_existing   RECORD;
  v_number     INTEGER;
  v_seats      INTEGER;
  v_game_id    UUID;
  v_tt_id      UUID;
  v_reopened   BOOLEAN := false;
BEGIN
  -- 0. Actor from auth.uid() ONLY.
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 1. Lock tournament; must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 2. Authorization: owner or club_cashier of the tournament's club.
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor
    WHERE t.id = p_tournament_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 3. Validate / resolve max_seats: explicit → mode of existing tables → 9.
  IF p_max_seats IS NOT NULL AND (p_max_seats < 2 OR p_max_seats > 10) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_max_seats');
  END IF;
  IF p_table_number IS NOT NULL AND p_table_number < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_table_number');
  END IF;
  v_seats := COALESCE(
    p_max_seats,
    (SELECT mode() WITHIN GROUP (ORDER BY max_seats)
       FROM public.tournament_tables
       WHERE tournament_id = p_tournament_id AND max_seats IS NOT NULL),
    9
  );

  -- 4. REOPEN path: an existing CLOSED table with the requested number.
  IF p_table_number IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.tournament_tables
    WHERE tournament_id = p_tournament_id AND table_number = p_table_number
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing.status = 'active' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'table_number_taken', 'table_number', p_table_number);
      END IF;
      v_game_id := v_existing.table_id;
      IF v_game_id IS NULL THEN
        INSERT INTO public.game_tables (club_id, table_name, table_type, status, current_blind_level)
        VALUES (v_tour.club_id, 'Bàn ' || p_table_number::text, 'tournament', 'active',
                COALESCE(v_tour.current_level, 1))
        RETURNING id INTO v_game_id;
      ELSE
        UPDATE public.game_tables SET status = 'active' WHERE id = v_game_id;
      END IF;
      UPDATE public.tournament_tables
        SET status = 'active', table_id = v_game_id
        WHERE id = v_existing.id;
      v_tt_id    := v_existing.id;
      v_number   := p_table_number;
      v_seats    := v_existing.max_seats;
      v_reopened := true;
    END IF;
  END IF;

  -- 5. CREATE path (no reopen happened).
  IF v_tt_id IS NULL THEN
    v_number := COALESCE(
      p_table_number,
      (SELECT COALESCE(MAX(table_number), 0) + 1
         FROM public.tournament_tables WHERE tournament_id = p_tournament_id)
    );
    IF EXISTS (SELECT 1 FROM public.tournament_tables
               WHERE tournament_id = p_tournament_id AND table_number = v_number AND status = 'active') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'table_number_taken', 'table_number', v_number);
    END IF;
    INSERT INTO public.game_tables (club_id, table_name, table_type, status, current_blind_level)
    VALUES (v_tour.club_id, 'Bàn ' || v_number::text, 'tournament', 'active',
            COALESCE(v_tour.current_level, 1))
    RETURNING id INTO v_game_id;
    INSERT INTO public.tournament_tables (tournament_id, table_id, table_number, max_seats, status)
    VALUES (p_tournament_id, v_game_id, v_number, v_seats, 'active')
    RETURNING id INTO v_tt_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_table_id', v_tt_id,
    'table_id', v_game_id,
    'table_number', v_number,
    'max_seats', v_seats,
    'status', 'active',
    'reopened', v_reopened
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_tournament_table(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_tournament_table(UUID, INTEGER, INTEGER) TO authenticated;
