-- Series V Candidate Authoring live-registration compatibility.
--
-- A tournament can be marked `live` before its scheduled start while registration
-- remains open. This migration admits only that pre-start state: live_status must
-- still be registering, the clock must not have started, and registration must not
-- be closed. All existing owner, source-evidence, and re-read-before-approval
-- boundaries remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.series_list_schedule_candidate_sources_v1(
  p_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_as_of timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp());
  v_sources jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR NOT public.is_club_owner(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'series_v_candidate_source_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'tournamentId', t.id::text,
    'labelVi', t.name,
    'scheduledStartAt', pg_catalog.to_char(t.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'optionId', 'tournament:' || t.id::text
  ) ORDER BY t.start_time, t.id), '[]'::jsonb)
  INTO v_sources
  FROM (
    SELECT t.id, t.name, t.start_time
    FROM public.tournaments AS t
    WHERE t.club_id = p_club_id
      AND t.deleted_at IS NULL
      AND (
        t.status IN ('active', 'upcoming', 'registering')
        OR (
          t.status = 'live'
          AND t.live_status = 'registering'
          AND t.clock_started_at IS NULL
          AND t.registration_closed_at IS NULL
        )
      )
      AND t.start_time IS NOT NULL
      AND t.start_time > v_as_of
      AND pg_catalog.btrim(t.name) <> ''
      AND pg_catalog.length(t.name) <= 512
      AND t.buy_in >= 0
      AND t.buy_in <= 9007199254740991
      AND t.buy_in::numeric = pg_catalog.trunc(t.buy_in::numeric)
    ORDER BY t.start_time, t.id
    LIMIT 50
  ) AS t;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'series-v-candidate-authoring-sources-v1',
    'clubId', p_club_id::text,
    'asOf', pg_catalog.to_char(v_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sources', v_sources
  );
END;
$$;

REVOKE ALL ON FUNCTION public.series_list_schedule_candidate_sources_v1(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.series_list_schedule_candidate_sources_v1(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.series_preview_schedule_candidate_v1(
  p_club_id uuid,
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_as_of timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp());
  v_tournament public.tournaments%ROWTYPE;
  v_buy_in bigint;
  v_schedule_gtd bigint;
  v_fee bigint;
  v_service_fee bigint;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR NOT public.is_club_owner(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'series_v_candidate_preview_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'series_v_candidate_tournament_required' USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_tournament
  FROM public.tournaments AS t
  WHERE t.id = p_tournament_id
    AND t.club_id = p_club_id
    AND t.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'series_v_candidate_tournament_unavailable' USING ERRCODE = '42501';
  END IF;

  IF v_tournament.start_time IS NULL OR v_tournament.start_time <= v_as_of THEN
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('scheduled_start_required');
  END IF;
  IF NOT COALESCE(
    v_tournament.status = ANY (ARRAY['active'::text, 'upcoming'::text, 'registering'::text])
    OR (
      v_tournament.status = 'live'
      AND v_tournament.live_status = 'registering'
      AND v_tournament.clock_started_at IS NULL
      AND v_tournament.registration_closed_at IS NULL
    ),
    false
  ) THEN
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('scheduled_tournament_required');
  END IF;
  IF pg_catalog.btrim(v_tournament.name) = '' OR pg_catalog.length(v_tournament.name) > 512 THEN
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('event_name_invalid');
  END IF;

  IF v_tournament.buy_in >= 0
    AND v_tournament.buy_in <= 9007199254740991
    AND v_tournament.buy_in::numeric = pg_catalog.trunc(v_tournament.buy_in::numeric)
  THEN
    v_buy_in := v_tournament.buy_in::bigint;
  ELSE
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('buy_in_invalid');
  END IF;

  IF v_tournament.guarantee_amount IS NOT NULL
    AND v_tournament.guarantee_amount >= 0
    AND v_tournament.guarantee_amount <= 9007199254740991
    AND v_tournament.guarantee_amount::numeric = pg_catalog.trunc(v_tournament.guarantee_amount::numeric)
  THEN
    v_schedule_gtd := v_tournament.guarantee_amount::bigint;
  END IF;
  IF v_tournament.rake_amount IS NOT NULL
    AND v_tournament.rake_amount >= 0
    AND v_tournament.rake_amount <= 9007199254740991
    AND v_tournament.rake_amount::numeric = pg_catalog.trunc(v_tournament.rake_amount::numeric)
  THEN
    v_fee := v_tournament.rake_amount::bigint;
  END IF;
  IF v_tournament.service_fee_amount IS NOT NULL
    AND v_tournament.service_fee_amount >= 0
    AND v_tournament.service_fee_amount <= 9007199254740991
    AND v_tournament.service_fee_amount::numeric = pg_catalog.trunc(v_tournament.service_fee_amount::numeric)
  THEN
    v_service_fee := v_tournament.service_fee_amount::bigint;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'series-v-candidate-authoring-preview-v1',
    'clubId', p_club_id::text,
    'tournamentId', v_tournament.id::text,
    'optionId', 'tournament:' || v_tournament.id::text,
    'asOf', pg_catalog.to_char(v_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'state', CASE WHEN pg_catalog.jsonb_array_length(v_blockers) = 0 THEN 'ready' ELSE 'blocked' END,
    'blockers', v_blockers,
    'fields', pg_catalog.jsonb_build_object(
      'eventName', pg_catalog.jsonb_build_object('value', v_tournament.name, 'source', 'club_schedule'),
      'scheduledStartAt', pg_catalog.jsonb_build_object('value', CASE WHEN v_tournament.start_time IS NULL THEN NULL ELSE pg_catalog.to_char(v_tournament.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END, 'source', CASE WHEN v_tournament.start_time IS NULL THEN 'missing' ELSE 'club_schedule' END),
      'buyInVnd', pg_catalog.jsonb_build_object('value', CASE WHEN v_buy_in IS NULL THEN NULL ELSE v_buy_in::text END, 'source', CASE WHEN v_buy_in IS NULL THEN 'missing' ELSE 'club_schedule' END),
      'scheduleGtdVnd', pg_catalog.jsonb_build_object('value', CASE WHEN v_schedule_gtd IS NULL THEN NULL ELSE v_schedule_gtd::text END, 'source', CASE WHEN v_schedule_gtd IS NULL THEN 'owner_input' ELSE 'club_schedule' END),
      'feeVnd', pg_catalog.jsonb_build_object('value', CASE WHEN v_fee IS NULL THEN NULL ELSE v_fee::text END, 'source', CASE WHEN v_fee IS NULL THEN 'missing' ELSE 'club_schedule' END),
      'serviceFeeVnd', pg_catalog.jsonb_build_object('value', CASE WHEN v_service_fee IS NULL THEN NULL ELSE v_service_fee::text END, 'source', CASE WHEN v_service_fee IS NULL THEN 'missing' ELSE 'club_schedule' END),
      'prizeContributionPerEntryVnd', pg_catalog.jsonb_build_object('value', NULL, 'source', 'owner_input'),
      'flights', pg_catalog.jsonb_build_object('value', NULL, 'source', 'owner_input'),
      'expectedDurationMinutes', pg_catalog.jsonb_build_object('value', NULL, 'source', 'owner_input'),
      'structureState', pg_catalog.jsonb_build_object('value', 'incomplete', 'source', 'deterministic'),
      'capacityState', pg_catalog.jsonb_build_object('value', 'unknown', 'source', 'missing'),
      'collisionState', pg_catalog.jsonb_build_object('value', 'unknown', 'source', 'missing')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.series_preview_schedule_candidate_v1(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.series_preview_schedule_candidate_v1(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.series_approve_schedule_candidate_from_tournament_v1(
  p_club_id uuid,
  p_tournament_id uuid,
  p_gtd_vnd bigint,
  p_prize_contribution_per_entry_vnd bigint,
  p_flights integer,
  p_expected_duration_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_source_as_of timestamptz;
  v_tournament public.tournaments%ROWTYPE;
  v_buy_in bigint;
  v_schedule_gtd bigint;
  v_evidence jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR NOT public.is_club_owner(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'series_v_candidate_authoring_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'series_v_candidate_tournament_required' USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_tournament
  FROM public.tournaments AS t
  WHERE t.id = p_tournament_id
    AND t.club_id = p_club_id
    AND t.deleted_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'series_v_candidate_tournament_unavailable' USING ERRCODE = '42501';
  END IF;
  v_source_as_of := pg_catalog.date_trunc('milliseconds', COALESCE(v_tournament.updated_at, v_tournament.created_at));
  IF v_source_as_of IS NULL OR v_source_as_of > v_now THEN
    RAISE EXCEPTION 'series_v_candidate_tournament_timestamp_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(
    v_tournament.status = ANY (ARRAY['active'::text, 'upcoming'::text, 'registering'::text])
    OR (
      v_tournament.status = 'live'
      AND v_tournament.live_status = 'registering'
      AND v_tournament.clock_started_at IS NULL
      AND v_tournament.registration_closed_at IS NULL
    ),
    false
  )
    OR v_tournament.start_time IS NULL
    OR v_tournament.start_time <= v_now
  THEN
    RAISE EXCEPTION 'series_v_candidate_scheduled_future_tournament_required' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.btrim(v_tournament.name) = '' OR pg_catalog.length(v_tournament.name) > 512 THEN
    RAISE EXCEPTION 'series_v_candidate_tournament_label_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_tournament.buy_in < 0
    OR v_tournament.buy_in > 9007199254740991
    OR v_tournament.buy_in::numeric <> pg_catalog.trunc(v_tournament.buy_in::numeric)
  THEN
    RAISE EXCEPTION 'series_v_candidate_buy_in_invalid' USING ERRCODE = '22023';
  END IF;
  v_buy_in := v_tournament.buy_in::bigint;

  IF p_gtd_vnd IS NULL OR p_gtd_vnd < 0 OR p_gtd_vnd > 9007199254740991 THEN
    RAISE EXCEPTION 'series_v_candidate_gtd_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_prize_contribution_per_entry_vnd IS NOT NULL
    AND (p_prize_contribution_per_entry_vnd <= 0 OR p_prize_contribution_per_entry_vnd > 9007199254740991)
  THEN
    RAISE EXCEPTION 'series_v_candidate_prize_contribution_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_flights IS NULL OR p_flights NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'series_v_candidate_flights_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_expected_duration_minutes IS NOT NULL AND p_expected_duration_minutes NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'series_v_candidate_duration_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_tournament.guarantee_amount IS NOT NULL
    AND v_tournament.guarantee_amount >= 0
    AND v_tournament.guarantee_amount <= 9007199254740991
    AND v_tournament.guarantee_amount::numeric = pg_catalog.trunc(v_tournament.guarantee_amount::numeric)
  THEN
    v_schedule_gtd := v_tournament.guarantee_amount::bigint;
  END IF;
  IF v_schedule_gtd IS NOT NULL AND p_gtd_vnd <> v_schedule_gtd THEN
    RAISE EXCEPTION 'series_v_candidate_gtd_mismatch' USING ERRCODE = '22023';
  END IF;

  v_evidence := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'evidenceId', 'tournament:' || v_tournament.id::text,
      'labelVi', 'Lịch CLB: ' || v_tournament.name,
      'sourceId', 'tournaments',
      'asOf', pg_catalog.to_char(v_source_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'quality', 'owner_scoped_server_aggregate',
      'privacyState', 'safe',
      'metricIds', pg_catalog.jsonb_build_array('event_name', 'scheduled_start_at', 'buy_in')
    ),
    pg_catalog.jsonb_build_object(
      'evidenceId', CASE WHEN v_schedule_gtd IS NULL THEN 'owner_input:' || v_tournament.id::text || ':gtd' ELSE 'tournament:' || v_tournament.id::text || ':gtd' END,
      'labelVi', CASE WHEN v_schedule_gtd IS NULL THEN 'Chủ CLB nhập GTD cho phương án này' ELSE 'GTD từ lịch CLB' END,
      'sourceId', CASE WHEN v_schedule_gtd IS NULL THEN 'series_v_candidate_authoring' ELSE 'tournaments' END,
      'asOf', pg_catalog.to_char(v_source_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'quality', 'owner_scoped_server_aggregate',
      'privacyState', 'safe',
      'metricIds', pg_catalog.jsonb_build_array('gtd')
    ),
    pg_catalog.jsonb_build_object(
      'evidenceId', 'owner_input:' || v_tournament.id::text || ':flights',
      'labelVi', 'Chủ CLB nhập số flight cho phương án này',
      'sourceId', 'series_v_candidate_authoring',
      'asOf', pg_catalog.to_char(v_source_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'quality', 'owner_scoped_server_aggregate',
      'privacyState', 'safe',
      'metricIds', pg_catalog.jsonb_build_array('flights')
    )
  );

  IF p_prize_contribution_per_entry_vnd IS NOT NULL THEN
    v_evidence := v_evidence || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'evidenceId', 'owner_input:' || v_tournament.id::text || ':prize_contribution',
      'labelVi', 'Chủ CLB nhập prize contribution mỗi entry cho phương án này',
      'sourceId', 'series_v_candidate_authoring',
      'asOf', pg_catalog.to_char(v_source_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'quality', 'owner_scoped_server_aggregate',
      'privacyState', 'safe',
      'metricIds', pg_catalog.jsonb_build_array('prize_contribution_per_entry')
    ));
  END IF;
  IF p_expected_duration_minutes IS NOT NULL THEN
    v_evidence := v_evidence || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'evidenceId', 'owner_input:' || v_tournament.id::text || ':duration',
      'labelVi', 'Chủ CLB nhập thời lượng dự kiến cho phương án này',
      'sourceId', 'series_v_candidate_authoring',
      'asOf', pg_catalog.to_char(v_source_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'quality', 'owner_scoped_server_aggregate',
      'privacyState', 'safe',
      'metricIds', pg_catalog.jsonb_build_array('expected_duration_minutes')
    ));
  END IF;

  RETURN public.series_approve_schedule_candidate_v1(
    p_club_id,
    'tournament:' || v_tournament.id::text,
    'owner_authored',
    v_tournament.name,
    v_buy_in,
    p_gtd_vnd,
    p_flights,
    p_expected_duration_minutes,
    p_prize_contribution_per_entry_vnd,
    'incomplete',
    'unknown',
    'unknown',
    v_evidence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.series_approve_schedule_candidate_from_tournament_v1(uuid, uuid, bigint, bigint, integer, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.series_approve_schedule_candidate_from_tournament_v1(uuid, uuid, bigint, bigint, integer, integer)
  TO authenticated;

-- ROLLBACK (owner-gated; never run automatically):
-- Restore the three prior function definitions from
-- 20270112000001_series_v_candidate_authoring_source_state_compatibility.sql
-- in a new migration.

COMMIT;
