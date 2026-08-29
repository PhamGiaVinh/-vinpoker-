-- Public Tournament Live Viewer V2 sanitized read contract (SOURCE-ONLY).
--
-- CRITICAL/RED: do not apply to Production outside the owner-gated DB runbook.
-- This function is intentionally anonymous-readable, returns display-only fields,
-- and does not change the existing base-table grants in this migration.
--
-- ROLLBACK (only after removing every consumer):
--   REVOKE ALL ON FUNCTION public.get_public_tournament_event_snapshot(uuid)
--     FROM PUBLIC, anon, authenticated, service_role;
--   DROP FUNCTION public.get_public_tournament_event_snapshot(uuid);

CREATE OR REPLACE FUNCTION public.get_public_tournament_event_snapshot(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_tournament public.tournaments%ROWTYPE;
  v_current public.tournament_levels%ROWTYPE;
  v_next public.tournament_levels%ROWTYPE;
  v_elapsed integer := 0;
  v_remaining integer;
  v_phase text;
  v_is_advancing boolean := false;
  v_entries bigint := 0;
  v_active_seats bigint := 0;
  v_orphan_seats bigint := 0;
  v_structure jsonb := '[]'::jsonb;
  v_tables jsonb := '[]'::jsonb;
BEGIN
  SELECT t.*
  INTO v_tournament
  FROM public.tournaments t
  WHERE t.id = p_tournament_id
    AND t.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'tournament_not_found'
    );
  END IF;

  -- Public URLs use the physical game_tables identity. Fail closed instead of
  -- substituting tournament_tables.id when an active row lacks that identity.
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status IN ('active', 'open', 'running')
      AND tt.table_id IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'public_table_identity_missing'
    );
  END IF;

  SELECT l.*
  INTO v_current
  FROM public.tournament_levels l
  WHERE l.tournament_id = p_tournament_id
    AND l.level_number = v_tournament.current_level
  ORDER BY l.created_at, l.id
  LIMIT 1;

  SELECT l.*
  INTO v_next
  FROM public.tournament_levels l
  WHERE l.tournament_id = p_tournament_id
    AND l.level_number > COALESCE(v_tournament.current_level, 0)
    AND l.is_break = false
  ORDER BY l.level_number, l.created_at, l.id
  LIMIT 1;

  IF v_tournament.clock_started_at IS NOT NULL AND v_current.id IS NOT NULL THEN
    v_elapsed := GREATEST(
      EXTRACT(EPOCH FROM (
        COALESCE(v_tournament.clock_paused_at, v_now)
          - v_tournament.clock_started_at
      ))::integer - COALESCE(v_tournament.pause_accumulated, 0),
      0
    );
    v_remaining := GREATEST((v_current.duration_minutes * 60) - v_elapsed, 0);
  ELSE
    v_remaining := NULL;
  END IF;

  v_is_advancing := v_tournament.clock_started_at IS NOT NULL
    AND v_tournament.clock_paused_at IS NULL
    AND lower(v_tournament.status::text) IN (
      'live', 'running', 'in_progress', 'active', 'final_table'
    );

  IF lower(v_tournament.status::text) IN ('completed', 'finished', 'closed', 'cancelled') THEN
    v_phase := 'completed';
    v_is_advancing := false;
  ELSIF v_tournament.clock_started_at IS NULL
    OR lower(v_tournament.status::text) IN ('upcoming', 'scheduled', 'draft', 'registration') THEN
    v_phase := 'not_started';
    v_is_advancing := false;
  ELSIF COALESCE(v_current.is_break, false) THEN
    v_phase := 'break';
  ELSIF v_is_advancing THEN
    v_phase := 'running';
  ELSE
    v_phase := 'paused';
  END IF;

  SELECT count(*)
  INTO v_entries
  FROM public.tournament_entries e
  WHERE e.tournament_id = p_tournament_id;

  SELECT count(*)
  INTO v_active_seats
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND s.is_active = true;

  SELECT count(*)
  INTO v_orphan_seats
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND s.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_tables tt
      WHERE tt.tournament_id = p_tournament_id
        AND tt.status IN ('active', 'open', 'running')
        AND (s.table_id = tt.id OR s.table_id = tt.table_id)
    );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'levelNumber', l.level_number,
        'smallBlind', l.small_blind,
        'bigBlind', l.big_blind,
        'bigBlindAnte', l.ante,
        'durationMinutes', l.duration_minutes,
        'isBreak', l.is_break
      )
      ORDER BY l.level_number, l.created_at, l.id
    ),
    '[]'::jsonb
  )
  INTO v_structure
  FROM public.tournament_levels l
  WHERE l.tournament_id = p_tournament_id;

  SELECT COALESCE(
    jsonb_agg(table_payload ORDER BY table_number_sort, table_identity),
    '[]'::jsonb
  )
  INTO v_tables
  FROM (
    SELECT
      COALESCE(tt.table_number, 2147483647) AS table_number_sort,
      tt.table_id AS table_identity,
      jsonb_build_object(
        'id', tt.table_id,
        'label', COALESCE(
          NULLIF(btrim(tt.table_name), ''),
          NULLIF(btrim(gt.table_name), ''),
          CASE WHEN tt.table_number IS NOT NULL THEN 'Bàn ' || tt.table_number::text END,
          'Bàn'
        ),
        'status', 'running',
        'maxSeats', tt.max_seats,
        'seats', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'seatNumber', s.seat_number,
              'playerName', NULLIF(btrim(s.player_name), ''),
              'chipCount', s.chip_count,
              'avatarUrl', s.avatar_url
            )
            ORDER BY s.seat_number, s.assigned_at, s.created_at, s.id
          )
          FROM public.tournament_seats s
          WHERE s.tournament_id = p_tournament_id
            AND s.is_active = true
            -- Live has used tournament_tables.id while older source paths used
            -- game_tables.id. Output is always the physical identity above.
            AND (s.table_id = tt.id OR s.table_id = tt.table_id)
        ), '[]'::jsonb)
      ) AS table_payload
    FROM public.tournament_tables tt
    LEFT JOIN public.game_tables gt ON gt.id = tt.table_id
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status IN ('active', 'open', 'running')
  ) running_tables;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament', jsonb_build_object(
      'id', v_tournament.id,
      'name', v_tournament.name,
      'status', v_tournament.status::text
    ),
    'clock', jsonb_build_object(
      'phase', v_phase,
      'isAdvancing', v_is_advancing,
      'levelNumber', v_current.level_number,
      'remainingSeconds', v_remaining,
      'smallBlind', COALESCE(v_current.small_blind, 0),
      'bigBlind', COALESCE(v_current.big_blind, 0),
      'bigBlindAnte', COALESCE(v_current.ante, 0),
      'nextSmallBlind', v_next.small_blind,
      'nextBigBlind', v_next.big_blind,
      'nextBigBlindAnte', v_next.ante
    ),
    'metrics', jsonb_build_object(
      'entries', v_entries,
      'playersRemaining', v_tournament.players_remaining,
      'serverAverageStack', v_tournament.average_stack,
      'activeSeatCount', v_active_seats,
      'orphanSeatCount', v_orphan_seats
    ),
    'structure', v_structure,
    'tables', v_tables,
    'refreshedAt', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_tournament_event_snapshot(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_public_tournament_event_snapshot(uuid)
TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_tournament_event_snapshot(uuid) IS
  'Anonymous read-only, display-only tournament snapshot for Public Live Viewer V2.';
