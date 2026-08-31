-- ============================================================================
-- Floor Table Control V3 — canonical roster read contract (SOURCE-ONLY / RED)
-- ============================================================================
-- Depends on: 20270113000005_floor_table_control_v3_contract_hardening.sql
--
-- Additive only.  This migration does not alter legacy table_id semantics,
-- backfill historical rows, change writer grants, touch money paths, or enable
-- the V3 feature flag.  It exposes only explicit V3 session/assignment rows;
-- mixed legacy seats are intentionally not guessed in browser code.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_floor_tournament_table_roster_v3(
  p_tournament_id uuid
)
RETURNS TABLE(
  tournament_id uuid,
  tournament_table_id uuid,
  game_table_id uuid,
  table_number integer,
  table_name text,
  table_session_id uuid,
  session_revision bigint,
  control_mode text,
  control_epoch bigint,
  tournament_table_status text,
  session_closed_at timestamptz,
  active_dealer_assignment_id uuid,
  seats jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
BEGIN
  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;

  IF NOT FOUND OR v_actor IS NULL
     OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'floor_table_v3_roster_access_denied';
  END IF;

  RETURN QUERY
  SELECT
    table_row.tournament_id,
    table_row.id,
    table_row.game_table_id,
    game_table_row.table_number,
    COALESCE(game_table_row.table_name, table_row.table_name),
    session_row.id,
    session_row.revision,
    session_row.control_mode,
    session_row.control_epoch,
    table_row.status,
    session_row.closed_at,
    dealer_assignment.id,
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'seat_number', seat_row.seat_number,
          'entry_id', seat_row.entry_id,
          'player_id', seat_row.player_id,
          'display_name', COALESCE(NULLIF(profile_row.display_name, ''), entry_row.player_id::text),
          'entry_no', entry_row.entry_no,
          'chip_count', seat_row.chip_count,
          'is_active', seat_row.is_active
        )
        ORDER BY seat_row.seat_number
      ) FILTER (WHERE seat_row.id IS NOT NULL),
      '[]'::jsonb
    )
  FROM public.tournament_tables table_row
  JOIN public.table_sessions session_row
    ON session_row.id = table_row.table_session_id
    AND session_row.tournament_id = table_row.tournament_id
    AND session_row.game_table_id = table_row.game_table_id
  JOIN public.game_tables game_table_row
    ON game_table_row.id = table_row.game_table_id
    AND game_table_row.club_id = v_club_id
  LEFT JOIN public.tournament_seats seat_row
    ON seat_row.tournament_id = table_row.tournament_id
    AND seat_row.tournament_table_id = table_row.id
    AND seat_row.table_session_id = session_row.id
    AND seat_row.is_active
  LEFT JOIN public.tournament_entries entry_row
    ON entry_row.id = seat_row.entry_id
    AND entry_row.tournament_id = table_row.tournament_id
  LEFT JOIN public.profiles profile_row
    ON profile_row.user_id = entry_row.player_id
  LEFT JOIN LATERAL (
    SELECT assignment_row.id
    FROM public.dealer_assignments assignment_row
    WHERE assignment_row.table_session_id = session_row.id
      AND assignment_row.released_at IS NULL
      AND assignment_row.status IN ('assigned', 'on_break')
    ORDER BY assignment_row.assigned_at DESC, assignment_row.id DESC
    LIMIT 1
  ) dealer_assignment ON true
  WHERE table_row.tournament_id = p_tournament_id
    AND table_row.status = 'active'
    AND session_row.closed_at IS NULL
  GROUP BY
    table_row.tournament_id,
    table_row.id,
    table_row.game_table_id,
    game_table_row.table_number,
    game_table_row.table_name,
    table_row.table_name,
    session_row.id,
    session_row.revision,
    session_row.control_mode,
    session_row.control_epoch,
    table_row.status,
    session_row.closed_at,
    dealer_assignment.id
  ORDER BY game_table_row.table_number, table_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_floor_restorable_entries_v3(
  p_tournament_id uuid
)
RETURNS TABLE(
  entry_id uuid,
  player_id uuid,
  entry_no integer,
  display_name text,
  current_stack integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
BEGIN
  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;

  IF NOT FOUND OR v_actor IS NULL
     OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'floor_table_v3_roster_access_denied';
  END IF;

  RETURN QUERY
  SELECT
    entry_row.id,
    entry_row.player_id,
    entry_row.entry_no,
    COALESCE(NULLIF(profile_row.display_name, ''), entry_row.player_id::text),
    entry_row.current_stack
  FROM public.tournament_entries entry_row
  LEFT JOIN public.profiles profile_row ON profile_row.user_id = entry_row.player_id
  WHERE entry_row.tournament_id = p_tournament_id
    AND entry_row.status = 'busted'
    AND entry_row.registration_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_seats active_seat
      WHERE active_seat.tournament_id = entry_row.tournament_id
        AND active_seat.entry_id = entry_row.id
        AND active_seat.is_active
    )
  ORDER BY entry_row.entry_no, entry_row.id;
END;
$$;

ALTER FUNCTION public.get_floor_tournament_table_roster_v3(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_floor_restorable_entries_v3(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_floor_tournament_table_roster_v3(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_floor_restorable_entries_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_roster_v3(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_floor_restorable_entries_v3(uuid) TO authenticated;

COMMIT;
