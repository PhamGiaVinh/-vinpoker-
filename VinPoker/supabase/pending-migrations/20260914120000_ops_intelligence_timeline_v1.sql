-- Wave 3: aggregate, read-only operational timeline for one exact tournament.
-- Apply is separately owner-gated.
-- Rollback: DROP FUNCTION public.get_ops_intelligence_timeline_v1(uuid, uuid);
BEGIN;

CREATE OR REPLACE FUNCTION public.get_ops_intelligence_timeline_v1(
  p_club_id uuid,
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_as_of timestamptz := statement_timestamp();
  v_tournament public.tournaments%ROWTYPE;
  v_entries_exact boolean;
  v_entries_reason text;
  v_tables_exact boolean;
  v_tables_reason text;
  v_capacity_exact boolean;
  v_dealer_exact boolean;
  v_gtd_exact boolean;
  v_gtd_reason text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR p_tournament_id IS NULL
    OR NOT COALESCE(public.is_club_owner(v_actor, p_club_id), false)
  THEN
    RAISE EXCEPTION 'OPS_INTELLIGENCE_TIMELINE_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT t.* INTO v_tournament
  FROM public.tournaments t
  WHERE t.id = p_tournament_id
    AND t.club_id = p_club_id
    AND t.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPS_INTELLIGENCE_TIMELINE_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.tournament_entries e
    WHERE e.tournament_id = p_tournament_id
      AND (
        e.status NOT IN ('registered', 'seated', 'busted', 'finished', 'cancelled')
        OR (e.status IN ('seated', 'busted', 'finished') AND e.seated_at IS NULL)
        OR (e.status = 'busted' AND e.busted_at IS NULL)
        OR (e.status IN ('registered', 'cancelled') AND (e.seated_at IS NOT NULL OR e.busted_at IS NOT NULL))
        OR (e.status = 'seated' AND e.busted_at IS NOT NULL)
        OR (e.status IN ('finished', 'cancelled') AND e.seated_at IS NOT NULL AND e.busted_at IS NULL)
        OR (e.busted_at IS NOT NULL AND (e.seated_at IS NULL OR e.busted_at < e.seated_at))
        OR e.seated_at > v_as_of
        OR e.busted_at > v_as_of
      )
  ) INTO v_entries_exact;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id = p_tournament_id AND e.status NOT IN ('registered', 'seated', 'busted', 'finished', 'cancelled')) THEN 'ENTRY_LIFECYCLE_STATUS_UNKNOWN'
    WHEN EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id = p_tournament_id AND e.status IN ('seated', 'busted', 'finished') AND e.seated_at IS NULL) THEN 'ENTRY_SEATED_AT_MISSING'
    WHEN EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id = p_tournament_id AND e.status = 'busted' AND e.busted_at IS NULL) THEN 'ENTRY_BUSTED_AT_MISSING'
    WHEN EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id = p_tournament_id AND ((e.status IN ('registered', 'cancelled') AND (e.seated_at IS NOT NULL OR e.busted_at IS NOT NULL)) OR (e.status = 'seated' AND e.busted_at IS NOT NULL))) THEN 'ENTRY_LIFECYCLE_STATUS_MISMATCH'
    WHEN EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id = p_tournament_id AND e.status IN ('finished', 'cancelled') AND e.seated_at IS NOT NULL AND e.busted_at IS NULL) THEN 'ENTRY_TERMINAL_AT_MISSING'
    WHEN EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id = p_tournament_id AND e.busted_at IS NOT NULL AND (e.seated_at IS NULL OR e.busted_at < e.seated_at)) THEN 'ENTRY_BUST_BEFORE_SEAT'
    WHEN EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id = p_tournament_id AND (e.seated_at > v_as_of OR e.busted_at > v_as_of)) THEN 'ENTRY_LIFECYCLE_TIMESTAMP_FUTURE'
    ELSE NULL
  END INTO v_entries_reason;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.table_sessions s
    WHERE s.club_id = p_club_id
      AND s.tournament_id = p_tournament_id
      AND s.session_type = 'tournament'
      AND (s.opened_at > v_as_of OR (s.closed_at IS NOT NULL AND s.closed_at < s.opened_at))
  ) INTO v_tables_exact;

  v_tables_reason := CASE WHEN v_tables_exact THEN NULL ELSE 'TABLE_SESSION_INTERVAL_INVALID' END;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.table_sessions s
    LEFT JOIN LATERAL (
      SELECT count(*) AS binding_count, min(tt.max_seats) AS max_seats
      FROM public.tournament_tables tt
      WHERE tt.tournament_id = p_tournament_id
        AND tt.table_session_id = s.id
    ) binding ON true
    WHERE s.club_id = p_club_id
      AND s.tournament_id = p_tournament_id
      AND s.session_type = 'tournament'
      AND s.opened_at <= v_as_of
      AND (binding.binding_count <> 1 OR binding.max_seats IS NULL OR binding.max_seats <= 0)
  ) INTO v_capacity_exact;
  v_capacity_exact := v_capacity_exact AND v_tables_exact;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.dealer_assignments da
    JOIN public.table_sessions s
      ON da.club_id = p_club_id
     AND s.club_id = p_club_id
     AND s.tournament_id = p_tournament_id
     AND s.session_type = 'tournament'
     AND s.game_table_id = da.table_id
     AND da.assigned_at < COALESCE(s.closed_at, v_as_of)
     AND COALESCE(da.released_at, v_as_of) > s.opened_at
    WHERE da.table_session_id IS DISTINCT FROM s.id
    UNION ALL
    SELECT 1
    FROM public.dealer_assignments da
    JOIN public.table_sessions s ON s.id = da.table_session_id
    WHERE s.club_id = p_club_id
      AND s.tournament_id = p_tournament_id
      AND s.session_type = 'tournament'
      AND (da.club_id IS DISTINCT FROM p_club_id OR da.table_id IS DISTINCT FROM s.game_table_id)
  ) INTO v_dealer_exact;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.tournament_registrations tr
    WHERE tr.tournament_id = p_tournament_id
      AND tr.status = 'confirmed'
      AND (tr.confirmed_at IS NULL OR tr.confirmed_at > v_as_of)
  ) INTO v_gtd_exact;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.tournament_registrations tr WHERE tr.tournament_id = p_tournament_id AND tr.status = 'confirmed' AND tr.confirmed_at > v_as_of) THEN 'FUTURE_CONFIRMED_AT'
    WHEN EXISTS (SELECT 1 FROM public.tournament_registrations tr WHERE tr.tournament_id = p_tournament_id AND tr.status = 'confirmed' AND tr.confirmed_at IS NULL) THEN 'CONFIRMED_AT_MISSING'
    ELSE NULL
  END INTO v_gtd_reason;

  WITH
  entry_events AS (
    SELECT e.seated_at AS at, 1::bigint AS delta
    FROM public.tournament_entries e
    WHERE e.tournament_id = p_tournament_id AND e.status IN ('seated', 'busted', 'finished')
      AND e.seated_at IS NOT NULL AND e.seated_at <= v_as_of
      AND (e.busted_at IS NULL OR e.busted_at >= e.seated_at)
    UNION ALL
    SELECT e.busted_at, -1::bigint
    FROM public.tournament_entries e
    WHERE e.tournament_id = p_tournament_id AND e.status IN ('busted', 'finished') AND e.seated_at IS NOT NULL
      AND e.busted_at IS NOT NULL AND e.busted_at >= e.seated_at AND e.busted_at <= v_as_of
  ),
  entry_steps AS (
    SELECT at, sum(sum(delta)) OVER (ORDER BY at) AS value
    FROM entry_events GROUP BY at
  ),
  scoped_sessions AS (
    SELECT s.id, s.game_table_id, s.opened_at, s.closed_at,
      CASE WHEN v_capacity_exact THEN binding.max_seats::bigint ELSE NULL END AS max_seats
    FROM public.table_sessions s
    LEFT JOIN LATERAL (
      SELECT min(tt.max_seats) AS max_seats
      FROM public.tournament_tables tt
      WHERE tt.tournament_id = p_tournament_id AND tt.table_session_id = s.id
    ) binding ON true
    WHERE s.club_id = p_club_id AND s.tournament_id = p_tournament_id
      AND s.session_type = 'tournament' AND s.opened_at <= v_as_of
      AND (s.closed_at IS NULL OR s.closed_at >= s.opened_at)
  ),
  table_events AS (
    SELECT opened_at AS at, 1::bigint AS table_delta, max_seats AS capacity_delta FROM scoped_sessions
    UNION ALL
    SELECT closed_at, -1::bigint, -max_seats FROM scoped_sessions WHERE closed_at IS NOT NULL AND closed_at <= v_as_of
  ),
  table_steps AS (
    SELECT at,
      sum(sum(table_delta)) OVER (ORDER BY at) AS table_count,
      CASE WHEN v_capacity_exact THEN sum(sum(capacity_delta)) OVER (ORDER BY at) ELSE NULL END AS seat_capacity
    FROM table_events GROUP BY at
  ),
  dealer_intervals AS (
    SELECT da.id AS assignment_id, s.id AS table_session_id,
      GREATEST(da.assigned_at, s.opened_at) AS assigned_at,
      CASE WHEN da.released_at IS NULL AND s.closed_at IS NULL THEN NULL
        ELSE LEAST(COALESCE(da.released_at, v_as_of), COALESCE(s.closed_at, v_as_of)) END AS released_at
    FROM public.dealer_assignments da
    JOIN scoped_sessions s
      ON s.id = da.table_session_id
     AND da.club_id = p_club_id
     AND da.table_id = s.game_table_id
    WHERE v_dealer_exact
      AND da.assigned_at < COALESCE(s.closed_at, v_as_of)
      AND COALESCE(da.released_at, v_as_of) > s.opened_at
  ),
  dealer_ordered AS (
    SELECT *, max(COALESCE(released_at, 'infinity'::timestamptz)) OVER (
      PARTITION BY table_session_id ORDER BY assigned_at, assignment_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS previous_max_release
    FROM dealer_intervals
  ),
  dealer_grouped AS (
    SELECT *, sum(CASE WHEN previous_max_release IS NULL OR assigned_at > previous_max_release THEN 1 ELSE 0 END) OVER (
      PARTITION BY table_session_id ORDER BY assigned_at, assignment_id
    ) AS coverage_group
    FROM dealer_ordered
  ),
  dealer_coverage_intervals AS (
    SELECT table_session_id, min(assigned_at) AS assigned_at,
      CASE WHEN bool_or(released_at IS NULL) THEN NULL ELSE max(released_at) END AS released_at
    FROM dealer_grouped
    GROUP BY table_session_id, coverage_group
  ),
  dealer_events AS (
    SELECT assigned_at AS at, 1::bigint AS delta
    FROM dealer_coverage_intervals
    UNION ALL
    SELECT released_at, -1::bigint
    FROM dealer_coverage_intervals
    WHERE released_at IS NOT NULL AND released_at <= v_as_of
  ),
  dealer_steps AS (
    SELECT at, sum(sum(delta)) OVER (ORDER BY at) AS value
    FROM dealer_events GROUP BY at
  ),
  gtd_events AS (
    SELECT tr.confirmed_at AS at, tr.buy_in::bigint AS delta
    FROM public.tournament_registrations tr
    WHERE tr.tournament_id = p_tournament_id
      AND tr.status = 'confirmed'
      AND tr.confirmed_at IS NOT NULL
      AND tr.confirmed_at <= v_as_of
  ),
  gtd_steps AS (
    SELECT at, sum(sum(delta)) OVER (ORDER BY at) AS value
    FROM gtd_events GROUP BY at
  ),
  operational_times AS (
    SELECT at FROM table_steps
    UNION SELECT at FROM dealer_steps
    UNION SELECT v_as_of
  ),
  operational_state AS (
    SELECT at,
      COALESCE((SELECT table_count FROM table_steps p WHERE p.at <= t.at ORDER BY p.at DESC LIMIT 1), 0) AS tables,
      COALESCE((SELECT value FROM dealer_steps p WHERE p.at <= t.at ORDER BY p.at DESC LIMIT 1), 0) AS dealers,
      lead(at) OVER (ORDER BY at) AS next_at
    FROM operational_times t
  ),
  dealer_gaps AS (
    SELECT at AS from_at, next_at AS to_at, (tables - dealers)::bigint AS max_gap
    FROM operational_state
    WHERE v_tables_exact AND v_dealer_exact AND tables > dealers AND next_at IS NOT NULL AND next_at > at
  )
  SELECT jsonb_build_object(
    'version', 'ops-intelligence-timeline-v1',
    'clubId', p_club_id,
    'tournamentId', p_tournament_id,
    'asOf', to_char(v_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'entries', jsonb_build_object(
      'availability', CASE WHEN v_entries_exact THEN 'exact' ELSE 'partial' END,
      'reasonCode', v_entries_reason,
      'points', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'value', value) ORDER BY at) FROM entry_steps), '[]'::jsonb)
    ),
    'tables', jsonb_build_object(
      'availability', CASE WHEN v_tables_exact THEN 'exact' ELSE 'partial' END,
      'reasonCode', v_tables_reason,
      'capacityAvailability', CASE WHEN v_capacity_exact THEN 'exact' ELSE 'partial' END,
      'capacityReasonCode', CASE WHEN v_capacity_exact THEN NULL WHEN NOT v_tables_exact THEN v_tables_reason ELSE 'TABLE_CAPACITY_BINDING_INCOMPLETE' END,
      'points', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'value', table_count, 'seatCapacity', seat_capacity) ORDER BY at) FROM table_steps), '[]'::jsonb)
    ),
    'dealers', jsonb_build_object(
      'availability', CASE WHEN v_dealer_exact THEN 'exact' ELSE 'partial' END,
      'reasonCode', CASE WHEN v_dealer_exact THEN NULL ELSE 'DEALER_SESSION_BINDING_INCOMPLETE' END,
      'points', CASE WHEN v_dealer_exact THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('at', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'value', value) ORDER BY at) FROM dealer_steps), '[]'::jsonb) ELSE '[]'::jsonb END
    ),
    'gtd', jsonb_build_object(
      'availability', CASE WHEN v_tournament.guarantee_amount IS NULL THEN 'unavailable' WHEN v_gtd_exact THEN 'exact' ELSE 'partial' END,
      'reasonCode', CASE WHEN v_tournament.guarantee_amount IS NULL THEN 'GTD_NOT_REPORTED' ELSE v_gtd_reason END,
      'guaranteeState', CASE WHEN v_tournament.guarantee_amount IS NULL THEN 'unavailable' WHEN v_tournament.guarantee_amount = 0 THEN 'no_guarantee' ELSE 'available' END,
      'guaranteeAmount', v_tournament.guarantee_amount,
      'points', CASE WHEN v_tournament.guarantee_amount IS NULL THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('at', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'value', value) ORDER BY at) FROM gtd_steps), '[]'::jsonb) END
    ),
    'dealerGaps', CASE WHEN v_tables_exact AND v_dealer_exact THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('from', to_char(from_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'to', to_char(to_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'maxGap', max_gap) ORDER BY from_at) FROM dealer_gaps), '[]'::jsonb) ELSE '[]'::jsonb END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_ops_intelligence_timeline_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ops_intelligence_timeline_v1(uuid, uuid) TO authenticated;

COMMIT;
