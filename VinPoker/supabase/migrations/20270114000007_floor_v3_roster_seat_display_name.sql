-- Prefer the active tournament-seat display identity for Floor V3 rosters.
-- Profiles remain optional enrichment for registered players.
--
-- ROLLBACK: re-apply the reviewed pre-migration function body whose normalized
-- production SHA-256 was 0a149d0fe4d634aad9338c3dacfa7c107a6616340e566aaa3ff85da738a112a6.

BEGIN;

DO $precondition$
DECLARE
  v_proc pg_proc%ROWTYPE;
  v_definition text;
BEGIN
  SELECT p.* INTO v_proc
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.get_floor_tournament_table_roster_v3(uuid)');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'floor_v3_roster_function_missing';
  END IF;

  v_definition := regexp_replace(pg_get_functiondef(v_proc.oid), '\s+', ' ', 'g');
  IF pg_get_userbyid(v_proc.proowner) <> 'postgres'
     OR v_proc.prosecdef IS DISTINCT FROM true
     OR COALESCE(array_to_string(v_proc.proconfig, ', '), '') <> 'search_path=""'
     OR position('COALESCE(NULLIF(profile_row.display_name, ''''), entry_row.player_id::text)' IN v_definition) = 0
     OR position('seat_row.player_name' IN v_definition) > 0
     OR EXISTS (
       SELECT 1
       FROM aclexplode(COALESCE(v_proc.proacl, acldefault('f', v_proc.proowner))) acl
       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_proc.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'floor_v3_roster_function_drift';
  END IF;
END;
$precondition$;

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
          'display_name', COALESCE(
            NULLIF(pg_catalog.btrim(seat_row.player_name), ''),
            NULLIF(pg_catalog.btrim(profile_row.display_name), ''),
            entry_row.player_id::text
          ),
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

ALTER FUNCTION public.get_floor_tournament_table_roster_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_floor_tournament_table_roster_v3(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_roster_v3(uuid) TO authenticated;

COMMIT;
