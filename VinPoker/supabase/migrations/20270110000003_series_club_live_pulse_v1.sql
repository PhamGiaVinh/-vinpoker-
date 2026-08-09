-- Series Intelligence / V Wave 2A: server-authoritative Club Pulse V1.
-- SOURCE-ONLY: this migration must not be applied outside an owner-gated DB runbook.
-- The function returns aggregate counts only. It does not expose player, dealer,
-- registration, seat, or table identifiers and it performs no writes.
-- Amended before first production apply: today metrics use the tournament's
-- canonical start_time in the club timezone, not registration confirmation time.
--
-- ROLLBACK (owner-gated, forward-only): add a reviewed migration that revokes
-- and drops public.get_series_club_live_pulse_v1(uuid).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_series_club_live_pulse_v1(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_as_of timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_as_of_text text;
  v_timezone text;
  v_local_date date;
  v_day_start timestamptz;
  v_day_end timestamptz;

  v_member_count bigint;
  v_member_availability text := 'unavailable';
  v_member_reason text := 'SOURCE_UNAVAILABLE';

  v_unique_today_count bigint;
  v_unique_today_availability text := 'unavailable';
  v_unique_today_reason text := 'SOURCE_UNAVAILABLE';
  v_unique_today_fallback boolean := false;

  v_entries_today_count bigint;
  v_entries_today_availability text := 'unavailable';
  v_entries_today_reason text := 'SOURCE_UNAVAILABLE';

  v_playing_count bigint;
  v_playing_availability text := 'unavailable';
  v_playing_reason text := 'SOURCE_UNAVAILABLE';
  v_playing_fallback boolean := false;

  v_running_count bigint;
  v_running_availability text := 'unavailable';
  v_running_reason text := 'SOURCE_UNAVAILABLE';

  v_open_tables_count bigint;
  v_open_tables_availability text := 'unavailable';
  v_open_tables_reason text := 'SOURCE_UNAVAILABLE';

  v_dealers_count bigint;
  v_dealers_availability text := 'unavailable';
  v_dealers_reason text := 'SOURCE_UNAVAILABLE';

  v_unavailable_ids text[] := ARRAY[]::text[];
  v_partial_ids text[] := ARRAY[]::text[];
  v_stale_ids text[] := ARRAY[]::text[];
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL
     OR NOT COALESCE(public.is_club_owner(v_actor, p_club_id), false) THEN
    RAISE EXCEPTION 'series_club_pulse_owner_required' USING ERRCODE = '42501';
  END IF;

  v_as_of_text := pg_catalog.to_char(
    v_as_of AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  -- A local day exists only when the canonical club_settings timezone exists
  -- and PostgreSQL recognizes it. There is deliberately no UTC fallback.
  IF pg_catalog.to_regclass('public.club_settings') IS NOT NULL THEN
    BEGIN
      SELECT NULLIF(pg_catalog.btrim(cs.timezone), '')
        INTO v_timezone
      FROM public.club_settings AS cs
      WHERE cs.club_id = p_club_id
      LIMIT 1;

      IF v_timezone IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS tz WHERE tz.name = v_timezone) THEN
        v_local_date := (v_as_of AT TIME ZONE v_timezone)::date;
        v_day_start := v_local_date::timestamp AT TIME ZONE v_timezone;
        v_day_end := (v_local_date + 1)::timestamp AT TIME ZONE v_timezone;
      ELSE
        v_timezone := NULL;
        v_local_date := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_timezone := NULL;
      v_local_date := NULL;
    END;
  END IF;

  IF pg_catalog.to_regclass('public.club_members') IS NOT NULL THEN
    BEGIN
      SELECT pg_catalog.count(*) INTO v_member_count
      FROM public.club_members AS cm
      WHERE cm.club_id = p_club_id;
      v_member_availability := 'exact';
      v_member_reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_member_count := NULL;
      v_member_availability := 'unavailable';
      v_member_reason := 'SOURCE_READ_FAILED';
    END;
  END IF;

  IF v_local_date IS NULL THEN
    v_unique_today_reason := 'CLUB_TIMEZONE_UNAVAILABLE';
    v_entries_today_reason := 'CLUB_TIMEZONE_UNAVAILABLE';
  ELSIF pg_catalog.to_regclass('public.tournament_registrations') IS NOT NULL
        AND pg_catalog.to_regclass('public.tournament_entries') IS NOT NULL
        AND pg_catalog.to_regclass('public.tournaments') IS NOT NULL THEN
    BEGIN
      WITH qualifying AS (
        SELECT tr.id, tr.tournament_id, tr.player_id
        FROM public.tournament_registrations AS tr
        JOIN public.tournaments AS t ON t.id = tr.tournament_id
        WHERE t.club_id = p_club_id
          AND t.deleted_at IS NULL
          AND t.status <> 'cancelled'
          AND t.start_time IS NOT NULL
          AND t.start_time >= v_day_start
          AND t.start_time < v_day_end
          AND tr.status = 'confirmed'
      ), identities AS (
        SELECT q.id,
               COALESCE(te.member_id::text, q.player_id::text) AS canonical_identity,
               te.member_id IS NULL AS used_fallback_identity
        FROM qualifying AS q
        LEFT JOIN LATERAL (
          SELECT entry.member_id
          FROM public.tournament_entries AS entry
          WHERE entry.registration_id = q.id
            AND entry.tournament_id = q.tournament_id
          ORDER BY entry.created_at, entry.id
          LIMIT 1
        ) AS te ON true
      )
      SELECT pg_catalog.count(DISTINCT canonical_identity),
             COALESCE(pg_catalog.bool_or(used_fallback_identity), false)
        INTO v_unique_today_count, v_unique_today_fallback
      FROM identities;

      SELECT pg_catalog.count(*) INTO v_entries_today_count
      FROM public.tournament_registrations AS tr
      JOIN public.tournaments AS t ON t.id = tr.tournament_id
      WHERE t.club_id = p_club_id
        AND t.deleted_at IS NULL
        AND t.status <> 'cancelled'
        AND t.start_time IS NOT NULL
        AND t.start_time >= v_day_start
        AND t.start_time < v_day_end
        AND tr.status = 'confirmed';

      v_unique_today_availability := CASE WHEN v_unique_today_fallback THEN 'partial' ELSE 'exact' END;
      v_entries_today_availability := 'exact';
      v_unique_today_reason := NULL;
      v_entries_today_reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_unique_today_count := NULL;
      v_entries_today_count := NULL;
      v_unique_today_availability := 'unavailable';
      v_entries_today_availability := 'unavailable';
      v_unique_today_reason := 'SOURCE_READ_FAILED';
      v_entries_today_reason := 'SOURCE_READ_FAILED';
    END;
  END IF;

  IF pg_catalog.to_regclass('public.tournament_seats') IS NOT NULL
     AND pg_catalog.to_regclass('public.tournament_entries') IS NOT NULL
     AND pg_catalog.to_regclass('public.tournaments') IS NOT NULL THEN
    BEGIN
      SELECT pg_catalog.count(DISTINCT COALESCE(te.member_id::text, ts.player_id::text)),
             COALESCE(pg_catalog.bool_or(te.member_id IS NULL), false)
        INTO v_playing_count, v_playing_fallback
      FROM public.tournament_seats AS ts
      JOIN public.tournaments AS t ON t.id = ts.tournament_id
      LEFT JOIN public.tournament_entries AS te
        ON te.id = ts.entry_id AND te.tournament_id = ts.tournament_id
      WHERE t.club_id = p_club_id
        AND t.deleted_at IS NULL
        AND t.status IN ('live', 'break', 'final_table')
        AND ts.is_active IS TRUE
        AND ts.status = 'active';
      v_playing_availability := CASE WHEN v_playing_fallback THEN 'partial' ELSE 'exact' END;
      v_playing_reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_playing_count := NULL;
      v_playing_availability := 'unavailable';
      v_playing_reason := 'SOURCE_READ_FAILED';
    END;
  END IF;

  IF pg_catalog.to_regclass('public.tournaments') IS NOT NULL THEN
    BEGIN
      SELECT pg_catalog.count(*) INTO v_running_count
      FROM public.tournaments AS t
      WHERE t.club_id = p_club_id
        AND t.deleted_at IS NULL
        AND t.status IN ('live', 'break', 'final_table');
      v_running_availability := 'exact';
      v_running_reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_running_count := NULL;
      v_running_availability := 'unavailable';
      v_running_reason := 'SOURCE_READ_FAILED';
    END;
  END IF;

  IF pg_catalog.to_regclass('public.tournament_tables') IS NOT NULL
     AND pg_catalog.to_regclass('public.tournaments') IS NOT NULL THEN
    BEGIN
      SELECT pg_catalog.count(*) INTO v_open_tables_count
      FROM public.tournament_tables AS tt
      JOIN public.tournaments AS t ON t.id = tt.tournament_id
      WHERE t.club_id = p_club_id
        AND t.deleted_at IS NULL
        AND tt.status = 'active';
      v_open_tables_availability := 'exact';
      v_open_tables_reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_open_tables_count := NULL;
      v_open_tables_availability := 'unavailable';
      v_open_tables_reason := 'SOURCE_READ_FAILED';
    END;
  END IF;

  IF pg_catalog.to_regclass('public.dealer_attendance') IS NOT NULL
     AND pg_catalog.to_regclass('public.dealers') IS NOT NULL THEN
    BEGIN
      SELECT pg_catalog.count(DISTINCT da.dealer_id) INTO v_dealers_count
      FROM public.dealer_attendance AS da
      JOIN public.dealers AS d ON d.id = da.dealer_id
      WHERE d.club_id = p_club_id
        AND d.deleted_at IS NULL
        AND da.status = 'checked_in'
        AND da.check_out_time IS NULL;
      v_dealers_availability := 'exact';
      v_dealers_reason := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_dealers_count := NULL;
      v_dealers_availability := 'unavailable';
      v_dealers_reason := 'SOURCE_READ_FAILED';
    END;
  END IF;

  -- JSON numbers must remain lossless when parsed by JavaScript.
  IF v_member_count > 9007199254740991 THEN
    v_member_count := NULL; v_member_availability := 'unavailable'; v_member_reason := 'COUNT_EXCEEDS_JS_SAFE_INTEGER';
  END IF;
  IF v_unique_today_count > 9007199254740991 THEN
    v_unique_today_count := NULL; v_unique_today_availability := 'unavailable'; v_unique_today_reason := 'COUNT_EXCEEDS_JS_SAFE_INTEGER';
  END IF;
  IF v_entries_today_count > 9007199254740991 THEN
    v_entries_today_count := NULL; v_entries_today_availability := 'unavailable'; v_entries_today_reason := 'COUNT_EXCEEDS_JS_SAFE_INTEGER';
  END IF;
  IF v_playing_count > 9007199254740991 THEN
    v_playing_count := NULL; v_playing_availability := 'unavailable'; v_playing_reason := 'COUNT_EXCEEDS_JS_SAFE_INTEGER';
  END IF;
  IF v_running_count > 9007199254740991 THEN
    v_running_count := NULL; v_running_availability := 'unavailable'; v_running_reason := 'COUNT_EXCEEDS_JS_SAFE_INTEGER';
  END IF;
  IF v_open_tables_count > 9007199254740991 THEN
    v_open_tables_count := NULL; v_open_tables_availability := 'unavailable'; v_open_tables_reason := 'COUNT_EXCEEDS_JS_SAFE_INTEGER';
  END IF;
  IF v_dealers_count > 9007199254740991 THEN
    v_dealers_count := NULL; v_dealers_availability := 'unavailable'; v_dealers_reason := 'COUNT_EXCEEDS_JS_SAFE_INTEGER';
  END IF;

  IF v_member_availability = 'unavailable' THEN v_unavailable_ids := pg_catalog.array_append(v_unavailable_ids, 'club_member_profiles'); END IF;
  IF v_unique_today_availability = 'unavailable' THEN v_unavailable_ids := pg_catalog.array_append(v_unavailable_ids, 'unique_players_today'); END IF;
  IF v_entries_today_availability = 'unavailable' THEN v_unavailable_ids := pg_catalog.array_append(v_unavailable_ids, 'entries_today'); END IF;
  IF v_playing_availability = 'unavailable' THEN v_unavailable_ids := pg_catalog.array_append(v_unavailable_ids, 'players_playing_now'); END IF;
  IF v_running_availability = 'unavailable' THEN v_unavailable_ids := pg_catalog.array_append(v_unavailable_ids, 'running_events'); END IF;
  IF v_open_tables_availability = 'unavailable' THEN v_unavailable_ids := pg_catalog.array_append(v_unavailable_ids, 'open_tables'); END IF;
  IF v_dealers_availability = 'unavailable' THEN v_unavailable_ids := pg_catalog.array_append(v_unavailable_ids, 'dealers_on_duty'); END IF;
  IF v_unique_today_availability = 'partial' THEN v_partial_ids := pg_catalog.array_append(v_partial_ids, 'unique_players_today'); END IF;
  IF v_playing_availability = 'partial' THEN v_partial_ids := pg_catalog.array_append(v_partial_ids, 'players_playing_now'); END IF;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'series-club-live-pulse-v1',
    'clubId', p_club_id,
    'asOf', v_as_of_text,
    'clubLocalDate', CASE WHEN v_local_date IS NULL THEN NULL ELSE v_local_date::text END,
    'timezone', v_timezone,
    'clubMemberProfiles', pg_catalog.jsonb_build_object(
      'metricId', 'club_member_profiles', 'value', v_member_count, 'unit', 'count',
      'availability', v_member_availability,
      'privacyState', CASE WHEN v_member_availability = 'unavailable' THEN 'not_exportable' WHEN v_member_count BETWEEN 1 AND 4 THEN 'small_cohort_suppressed' ELSE 'safe' END,
      'asOf', v_as_of_text, 'sourceId', 'club_members', 'grain', 'club',
      'definitionVersion', 'club-member-profiles-v1'
    ) || CASE WHEN v_member_reason IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('unavailableReason', v_member_reason) END,
    'uniquePlayersToday', pg_catalog.jsonb_build_object(
      'metricId', 'unique_players_today', 'value', v_unique_today_count, 'unit', 'count',
      'availability', v_unique_today_availability,
      'privacyState', CASE WHEN v_unique_today_availability = 'unavailable' THEN 'not_exportable' WHEN v_unique_today_count BETWEEN 1 AND 4 THEN 'small_cohort_suppressed' ELSE 'safe' END,
      'asOf', v_as_of_text, 'sourceId', 'tournaments.tournament_registrations.tournament_entries', 'grain', 'club_event_start_local_calendar_day',
      'definitionVersion', 'club-unique-players-event-day-v1'
    ) || CASE WHEN v_unique_today_reason IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('unavailableReason', v_unique_today_reason) END,
    'entriesToday', pg_catalog.jsonb_build_object(
      'metricId', 'entries_today', 'value', v_entries_today_count, 'unit', 'count',
      'availability', v_entries_today_availability,
      'privacyState', CASE WHEN v_entries_today_availability = 'unavailable' THEN 'not_exportable' WHEN v_entries_today_count BETWEEN 1 AND 4 THEN 'small_cohort_suppressed' ELSE 'safe' END,
      'asOf', v_as_of_text, 'sourceId', 'tournaments.tournament_registrations', 'grain', 'club_event_start_local_calendar_day',
      'definitionVersion', 'club-entries-event-day-v1'
    ) || CASE WHEN v_entries_today_reason IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('unavailableReason', v_entries_today_reason) END,
    'playersPlayingNow', pg_catalog.jsonb_build_object(
      'metricId', 'players_playing_now', 'value', v_playing_count, 'unit', 'count',
      'availability', v_playing_availability,
      'privacyState', CASE WHEN v_playing_availability = 'unavailable' THEN 'not_exportable' WHEN v_playing_count BETWEEN 1 AND 4 THEN 'small_cohort_suppressed' ELSE 'safe' END,
      'asOf', v_as_of_text, 'sourceId', 'tournament_seats.tournament_entries', 'grain', 'club_live_tournaments',
      'definitionVersion', 'club-active-seated-players-v1'
    ) || CASE WHEN v_playing_reason IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('unavailableReason', v_playing_reason) END,
    'runningEvents', pg_catalog.jsonb_build_object(
      'metricId', 'running_events', 'value', v_running_count, 'unit', 'count',
      'availability', v_running_availability,
      'privacyState', CASE WHEN v_running_availability = 'unavailable' THEN 'not_exportable' WHEN v_running_count BETWEEN 1 AND 4 THEN 'small_cohort_suppressed' ELSE 'safe' END,
      'asOf', v_as_of_text, 'sourceId', 'tournaments', 'grain', 'club_live_tournaments',
      'definitionVersion', 'club-running-events-v1'
    ) || CASE WHEN v_running_reason IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('unavailableReason', v_running_reason) END,
    'openTables', pg_catalog.jsonb_build_object(
      'metricId', 'open_tables', 'value', v_open_tables_count, 'unit', 'count',
      'availability', v_open_tables_availability,
      'privacyState', CASE WHEN v_open_tables_availability = 'unavailable' THEN 'not_exportable' WHEN v_open_tables_count BETWEEN 1 AND 4 THEN 'small_cohort_suppressed' ELSE 'safe' END,
      'asOf', v_as_of_text, 'sourceId', 'tournament_tables', 'grain', 'club_tournament_tables',
      'definitionVersion', 'club-open-tables-v1'
    ) || CASE WHEN v_open_tables_reason IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('unavailableReason', v_open_tables_reason) END,
    'dealersOnDuty', pg_catalog.jsonb_build_object(
      'metricId', 'dealers_on_duty', 'value', v_dealers_count, 'unit', 'count',
      'availability', v_dealers_availability,
      'privacyState', CASE WHEN v_dealers_availability = 'unavailable' THEN 'not_exportable' WHEN v_dealers_count BETWEEN 1 AND 4 THEN 'small_cohort_suppressed' ELSE 'safe' END,
      'asOf', v_as_of_text, 'sourceId', 'dealer_attendance.dealers', 'grain', 'club_current_attendance',
      'definitionVersion', 'club-dealers-on-duty-v1'
    ) || CASE WHEN v_dealers_reason IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('unavailableReason', v_dealers_reason) END,
    'dataQuality', pg_catalog.jsonb_build_object(
      'unavailableMetricIds', pg_catalog.to_jsonb(v_unavailable_ids),
      'partialMetricIds', pg_catalog.to_jsonb(v_partial_ids),
      'staleMetricIds', pg_catalog.to_jsonb(v_stale_ids)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_series_club_live_pulse_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_series_club_live_pulse_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_series_club_live_pulse_v1(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_series_club_live_pulse_v1(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_series_club_live_pulse_v1(uuid) IS
  'Owner-scoped aggregate Club Pulse V1 for Series Intelligence. Read-only; no raw identities.';

COMMIT;
