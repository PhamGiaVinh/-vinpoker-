-- Series Intelligence D2A: Decision Packet & Private Outcome Capture V1.
--
-- SOURCE ONLY. CRITICAL/RED. Do not apply with `supabase db push`.
-- Production application is owner-gated by the controlled DB apply runbook.
--
-- This migration is additive:
--   * existing series_decision_logs remains a mutable legacy surface;
--   * existing series_event_actuals remains an autosync current-value cache;
--   * neither legacy table becomes calibration-eligible automatically;
--   * no existing row is rewritten or backfilled.
--
-- New authority:
--   * series_decision_packets_v1: pre-decision information packets, frozen once;
--   * series_event_actual_revisions_v1: append-only scoped actual revisions;
--   * authenticated clients can SELECT owner-scoped rows but cannot write tables directly;
--   * owner writes go through narrow SECURITY DEFINER RPCs with an empty search_path.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1. Validation helpers. These return booleans only and expose no row data.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._series_packet_normalize_information_key_v1(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(p_key),
        E'([[:lower:][:digit:]])([[:upper:]])',
        E'\\1_\\2',
        'g'
      ),
      E'[_[:space:].-]+',
      '_',
      'g'
    )
  )
$$;

CREATE OR REPLACE FUNCTION public._series_jsonb_has_forbidden_packet_key_v1(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_normalized_key text;
  v_child jsonb;
BEGIN
  IF p_value IS NULL THEN
    RETURN false;
  END IF;

  IF pg_catalog.jsonb_typeof(p_value) = 'object' THEN
    FOR v_key, v_child IN SELECT key, value FROM pg_catalog.jsonb_each(p_value)
    LOOP
      v_normalized_key := public._series_packet_normalize_information_key_v1(v_key);
      IF v_normalized_key = ANY (ARRAY[
        'actual', 'actual_entries', 'actual_unique_players', 'actual_reentries',
        'actual_prize_pool', 'actual_overlay_amount', 'outcome', 'outcomes',
        'final_entries', 'final_unique_players', 'final_prize_pool', 'final_overlay',
        'paid_places', 'finished_place', 'finishers', 'payout', 'payouts',
        'bust_order', 'post_event_reason', 'source_entry_id', 'player_id', 'user_id',
        'phone', 'phone_number', 'email', 'telegram', 'id_card', 'full_name'
      ]) OR pg_catalog.replace(v_normalized_key, '_', '') = ANY (ARRAY[
        'actual', 'actualentries', 'actualuniqueplayers', 'actualreentries',
        'actualprizepool', 'actualoverlayamount', 'outcome', 'outcomes',
        'finalentries', 'finaluniqueplayers', 'finalprizepool', 'finaloverlay',
        'paidplaces', 'finishedplace', 'finishers', 'payout', 'payouts',
        'bustorder', 'posteventreason', 'sourceentryid', 'playerid', 'userid',
        'phone', 'phonenumber', 'email', 'telegram', 'idcard', 'fullname'
      ]) THEN
        RETURN true;
      END IF;
      IF public._series_jsonb_has_forbidden_packet_key_v1(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_value) = 'array' THEN
    FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value)
    LOOP
      IF public._series_jsonb_has_forbidden_packet_key_v1(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_jsonb_is_string_array_v1(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    p_value IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_value) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_value) AS member(value)
      WHERE pg_catalog.jsonb_typeof(member.value) <> 'string'
        OR pg_catalog.btrim(member.value #>> '{}') = ''
    )
$$;

CREATE OR REPLACE FUNCTION public._series_packet_reference_text_valid_v1(
  p_value jsonb,
  p_max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_value) = 'string'
    AND pg_catalog.char_length(p_value #>> '{}') BETWEEN 1 AND p_max_length
    AND pg_catalog.btrim(p_value #>> '{}') = p_value #>> '{}'
    AND (p_value #>> '{}') !~ '[[:cntrl:]]'
$$;

CREATE OR REPLACE FUNCTION public._series_packet_source_cutoff_valid_v1(
  p_value jsonb,
  p_packet_cutoff timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source_cutoff timestamptz;
  v_text text;
BEGIN
  IF p_value IS NULL
    OR p_packet_cutoff IS NULL
    OR pg_catalog.jsonb_typeof(p_value) <> 'string'
  THEN
    RETURN false;
  END IF;

  v_text := p_value #>> '{}';
  IF v_text !~ E'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RETURN false;
  END IF;

  BEGIN
    v_source_cutoff := v_text::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN v_source_cutoff <= p_packet_cutoff
    AND pg_catalog.date_trunc('milliseconds', v_source_cutoff) = v_source_cutoff;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_packet_evidence_manifest_valid_v1(
  p_value jsonb,
  p_packet_cutoff timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_kind text;
  v_reference_id text;
  v_identity text;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF p_value IS NULL OR pg_catalog.jsonb_typeof(p_value) <> 'array' THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
      OR NOT (v_item ?& ARRAY['kind', 'referenceId', 'contentHash', 'sourceCutoff'])
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(v_item) AS object_key(key)
        WHERE object_key.key <> ALL (ARRAY['kind', 'referenceId', 'contentHash', 'sourceCutoff'])
      )
      OR pg_catalog.jsonb_typeof(v_item -> 'kind') <> 'string'
      OR pg_catalog.jsonb_typeof(v_item -> 'contentHash') <> 'string'
      OR (v_item ->> 'contentHash') !~ '^[0-9a-f]{64}$'
      OR NOT public._series_packet_reference_text_valid_v1(v_item -> 'referenceId', 512)
      OR NOT public._series_packet_source_cutoff_valid_v1(v_item -> 'sourceCutoff', p_packet_cutoff)
    THEN
      RETURN false;
    END IF;

    v_kind := v_item ->> 'kind';
    v_reference_id := v_item ->> 'referenceId';
    IF v_kind NOT IN ('forecast_snapshot', 'public_research_artifact', 'registration_slice', 'campaign_slice') THEN
      RETURN false;
    END IF;
    v_identity := v_kind || ':' || v_reference_id;
    IF v_identity = ANY (v_seen) THEN
      RETURN false;
    END IF;
    v_seen := pg_catalog.array_append(v_seen, v_identity);
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_packet_slice_manifest_valid_v1(
  p_value jsonb,
  p_observation_count integer,
  p_packet_cutoff timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_observation_count text;
BEGIN
  IF p_value IS NULL THEN
    RETURN p_observation_count IS NULL;
  END IF;
  IF p_observation_count IS NULL
    OR p_observation_count < 0
    OR pg_catalog.jsonb_typeof(p_value) <> 'object'
    OR NOT (p_value ?& ARRAY['manifestId', 'contentHash', 'observationCount', 'sourceCutoff'])
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_value) AS object_key(key)
      WHERE object_key.key <> ALL (ARRAY['manifestId', 'contentHash', 'observationCount', 'sourceCutoff'])
    )
    OR pg_catalog.jsonb_typeof(p_value -> 'contentHash') <> 'string'
    OR (p_value ->> 'contentHash') !~ '^[0-9a-f]{64}$'
    OR NOT public._series_packet_reference_text_valid_v1(p_value -> 'manifestId', 512)
    OR NOT public._series_packet_source_cutoff_valid_v1(p_value -> 'sourceCutoff', p_packet_cutoff)
    OR pg_catalog.jsonb_typeof(p_value -> 'observationCount') <> 'number'
  THEN
    RETURN false;
  END IF;

  v_observation_count := p_value ->> 'observationCount';
  RETURN v_observation_count ~ '^(0|[1-9][0-9]*)$'
    AND v_observation_count::numeric = p_observation_count::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_packet_research_artifact_reference_valid_v1(
  p_evidence jsonb,
  p_reference_id text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_reference_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_evidence) AS evidence(value)
      WHERE evidence.value ->> 'kind' = 'public_research_artifact'
        AND evidence.value ->> 'referenceId' = p_reference_id
    )
$$;

CREATE OR REPLACE FUNCTION public._series_count_metric_valid_v1(
  p_availability text,
  p_value bigint
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_availability = 'present' THEN
      p_value IS NOT NULL AND p_value > 0 AND p_value <= 9007199254740991
    WHEN p_availability = 'explicit_zero' THEN p_value = 0
    WHEN p_availability IN ('missing','uncertain','conflicting','not_applicable') THEN p_value IS NULL
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public._series_money_metric_valid_v1(
  p_availability text,
  p_amount_minor numeric,
  p_currency text,
  p_scale smallint
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_availability = 'present' THEN
      p_amount_minor IS NOT NULL AND p_amount_minor > 0
      AND p_amount_minor = pg_catalog.trunc(p_amount_minor)
      AND p_currency ~ '^[A-Z]{3}$'
      AND p_scale BETWEEN 0 AND 6
    WHEN p_availability = 'explicit_zero' THEN
      p_amount_minor = 0
      AND p_currency ~ '^[A-Z]{3}$'
      AND p_scale BETWEEN 0 AND 6
    WHEN p_availability IN ('missing','uncertain','conflicting','not_applicable') THEN
      p_amount_minor IS NULL AND p_currency IS NULL AND p_scale IS NULL
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public._series_jsonb_has_forbidden_packet_key_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_packet_normalize_information_key_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_jsonb_is_string_array_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_packet_reference_text_valid_v1(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_packet_source_cutoff_valid_v1(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_packet_evidence_manifest_valid_v1(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_packet_slice_manifest_valid_v1(jsonb, integer, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_packet_research_artifact_reference_valid_v1(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_count_metric_valid_v1(text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_money_metric_valid_v1(text, numeric, text, smallint)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Decision packets. A frozen row can never be updated or deleted.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.series_decision_packets_v1 (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version                  text NOT NULL DEFAULT 'series-decision-packet-v1',
  club_id                         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  event_id                        uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  decision_horizon                text NOT NULL,
  target_metric                   text NOT NULL,
  as_of_ts                        timestamptz NOT NULL,
  source_cutoff                   timestamptz NOT NULL,
  target_event_ts                 timestamptz NOT NULL,
  forecast_snapshot_id            uuid REFERENCES public.series_forecast_snapshots(id) ON DELETE RESTRICT,
  forecast_state                  text NOT NULL,
  manual_expectation              bigint,
  public_evidence_manifest        jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_evidence_manifest_hash   text NOT NULL,
  registration_slice_manifest     jsonb,
  registration_slice_hash         text,
  registration_observation_count integer,
  campaign_slice_manifest         jsonb,
  campaign_slice_hash             text,
  campaign_observation_count      integer,
  known_information               jsonb NOT NULL DEFAULT '{}'::jsonb,
  known_information_hash          text NOT NULL,
  recommended_action              text,
  recommendation_source_kind      text,
  recommendation_source_ref       text,
  owner_decision                  text,
  public_action                   text,
  decision_reason                 text,
  alternatives                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions                     jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty_notes               text,
  packet_state                    text NOT NULL DEFAULT 'draft',
  draft_version                   bigint NOT NULL DEFAULT 1,
  content_hash                    text,
  idempotency_key                 text NOT NULL,
  request_hash                    text NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_by                      uuid NOT NULL DEFAULT auth.uid(),
  frozen_at                       timestamptz,
  frozen_by                       uuid,
  supersedes_packet_id            uuid,
  correction_reason               text,

  CONSTRAINT sdp_v1_schema_chk CHECK (schema_version = 'series-decision-packet-v1'),
  CONSTRAINT sdp_v1_horizon_chk CHECK (decision_horizon IN ('T-21','T-7','T-1','T-0')),
  CONSTRAINT sdp_v1_metric_chk CHECK (target_metric IN ('entries','unique_players','total_bullets')),
  CONSTRAINT sdp_v1_forecast_state_chk CHECK (
    forecast_state IN (
      'no_forecast_available',
      'manual_expectation',
      'forecast_provenance_incomplete',
      'forecast_not_identity_eligible',
      'forecast_identity_eligible'
    )
  ),
  CONSTRAINT sdp_v1_timing_chk CHECK (
    source_cutoff <= as_of_ts
    AND pg_catalog.date_trunc('milliseconds', as_of_ts) = as_of_ts
    AND pg_catalog.date_trunc('milliseconds', source_cutoff) = source_cutoff
    AND pg_catalog.date_trunc('milliseconds', target_event_ts) = target_event_ts
  ),
  CONSTRAINT sdp_v1_expectation_chk CHECK (
    manual_expectation IS NULL OR (manual_expectation >= 0 AND manual_expectation <= 9007199254740991)
  ),
  CONSTRAINT sdp_v1_forecast_shape_chk CHECK (
    (forecast_state = 'no_forecast_available'
      AND forecast_snapshot_id IS NULL AND manual_expectation IS NULL)
    OR
    (forecast_state = 'manual_expectation'
      AND forecast_snapshot_id IS NULL AND manual_expectation IS NOT NULL)
    OR
    (forecast_state IN (
        'forecast_provenance_incomplete',
        'forecast_not_identity_eligible',
        'forecast_identity_eligible'
      )
      AND forecast_snapshot_id IS NOT NULL
      AND manual_expectation IS NULL
      AND target_metric = 'entries')
  ),
  CONSTRAINT sdp_v1_evidence_shape_chk CHECK (
     pg_catalog.jsonb_typeof(public_evidence_manifest) = 'array'
     AND public_evidence_manifest_hash ~ '^[0-9a-f]{64}$'
     AND public._series_packet_evidence_manifest_valid_v1(public_evidence_manifest, source_cutoff)
  ),
  CONSTRAINT sdp_v1_registration_shape_chk CHECK (
    (registration_slice_manifest IS NULL
      AND registration_slice_hash IS NULL
      AND registration_observation_count IS NULL)
    OR
    (pg_catalog.jsonb_typeof(registration_slice_manifest) = 'object'
       AND registration_slice_hash ~ '^[0-9a-f]{64}$'
       AND registration_observation_count >= 0)
      AND public._series_packet_slice_manifest_valid_v1(
        registration_slice_manifest, registration_observation_count, source_cutoff
      )
  ),
  CONSTRAINT sdp_v1_campaign_shape_chk CHECK (
    (campaign_slice_manifest IS NULL
      AND campaign_slice_hash IS NULL
      AND campaign_observation_count IS NULL)
    OR
    (pg_catalog.jsonb_typeof(campaign_slice_manifest) = 'object'
       AND campaign_slice_hash ~ '^[0-9a-f]{64}$'
       AND campaign_observation_count >= 0)
      AND public._series_packet_slice_manifest_valid_v1(
        campaign_slice_manifest, campaign_observation_count, source_cutoff
      )
  ),
  CONSTRAINT sdp_v1_known_information_chk CHECK (
    pg_catalog.jsonb_typeof(known_information) = 'object'
    AND known_information_hash ~ '^[0-9a-f]{64}$'
    AND NOT public._series_jsonb_has_forbidden_packet_key_v1(known_information)
  ),
  CONSTRAINT sdp_v1_text_arrays_chk CHECK (
    public._series_jsonb_is_string_array_v1(alternatives)
    AND public._series_jsonb_is_string_array_v1(assumptions)
  ),
  CONSTRAINT sdp_v1_recommendation_chk CHECK (
    (recommended_action IS NULL
      AND recommendation_source_kind IS NULL
      AND recommendation_source_ref IS NULL)
    OR
    (recommended_action IS NOT NULL
      AND pg_catalog.btrim(recommended_action) <> ''
      AND recommendation_source_kind IN ('forecast_snapshot','research_artifact')
      AND recommendation_source_ref IS NOT NULL
      AND public._series_packet_reference_text_valid_v1(
        pg_catalog.to_jsonb(recommendation_source_ref), 512
      ))
    AND (
      recommendation_source_kind IS DISTINCT FROM 'forecast_snapshot'
      OR (
        forecast_snapshot_id IS NOT NULL
        AND recommendation_source_ref = forecast_snapshot_id::text
      )
    )
  ),
  CONSTRAINT sdp_v1_state_chk CHECK (packet_state IN ('draft','frozen')),
  CONSTRAINT sdp_v1_freeze_shape_chk CHECK (
    (packet_state = 'draft' AND content_hash IS NULL AND frozen_at IS NULL AND frozen_by IS NULL)
    OR
    (packet_state = 'frozen'
      AND content_hash ~ '^[0-9a-f]{64}$'
      AND frozen_at IS NOT NULL
      AND frozen_by IS NOT NULL)
  ),
  CONSTRAINT sdp_v1_version_chk CHECK (draft_version >= 1),
  CONSTRAINT sdp_v1_idempotency_chk CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$'
    AND request_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT sdp_v1_correction_chk CHECK (
    (supersedes_packet_id IS NULL AND correction_reason IS NULL)
    OR
    (supersedes_packet_id IS NOT NULL
      AND supersedes_packet_id <> id
      AND pg_catalog.btrim(correction_reason) <> '')
  ),
  CONSTRAINT sdp_v1_identity_unique UNIQUE (id, club_id, event_id, decision_horizon),
  CONSTRAINT sdp_v1_parent_fk FOREIGN KEY (
    supersedes_packet_id, club_id, event_id, decision_horizon
  ) REFERENCES public.series_decision_packets_v1(
    id, club_id, event_id, decision_horizon
  ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sdp_v1_root_unique
  ON public.series_decision_packets_v1(club_id, event_id, decision_horizon)
  WHERE supersedes_packet_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdp_v1_single_successor
  ON public.series_decision_packets_v1(supersedes_packet_id)
  WHERE supersedes_packet_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdp_v1_idempotency
  ON public.series_decision_packets_v1(club_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sdp_v1_event
  ON public.series_decision_packets_v1(club_id, event_id, decision_horizon, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdp_v1_forecast
  ON public.series_decision_packets_v1(forecast_snapshot_id)
  WHERE forecast_snapshot_id IS NOT NULL;

ALTER TABLE public.series_decision_packets_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.series_decision_packets_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.series_decision_packets_v1 TO authenticated;
GRANT SELECT ON TABLE public.series_decision_packets_v1 TO service_role;

DROP POLICY IF EXISTS sdp_v1_owner_select ON public.series_decision_packets_v1;
CREATE POLICY sdp_v1_owner_select ON public.series_decision_packets_v1
  FOR SELECT TO authenticated
  USING (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
  );

CREATE OR REPLACE FUNCTION public._series_guard_decision_packet_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'series_decision_packet_delete_forbidden' USING ERRCODE = '55000';
  END IF;
  IF OLD.packet_state = 'frozen' THEN
    RAISE EXCEPTION 'series_decision_packet_frozen' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.club_id IS DISTINCT FROM OLD.club_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.decision_horizon IS DISTINCT FROM OLD.decision_horizon
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.supersedes_packet_id IS DISTINCT FROM OLD.supersedes_packet_id
  THEN
    RAISE EXCEPTION 'series_decision_packet_identity_immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.packet_state = 'frozen' AND (
    (to_jsonb(NEW) - ARRAY['packet_state','content_hash','frozen_at','frozen_by'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['packet_state','content_hash','frozen_at','frozen_by'])
  ) THEN
    RAISE EXCEPTION 'series_decision_packet_freeze_must_not_change_content' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_series_decision_packet_guard_v1
  ON public.series_decision_packets_v1;
CREATE TRIGGER trg_series_decision_packet_guard_v1
  BEFORE UPDATE OR DELETE ON public.series_decision_packets_v1
  FOR EACH ROW EXECUTE FUNCTION public._series_guard_decision_packet_mutation_v1();

REVOKE ALL ON FUNCTION public._series_guard_decision_packet_mutation_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Append-only actual revisions. Missing and explicit zero are separate states.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.series_event_actual_revisions_v1 (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version                  text NOT NULL DEFAULT 'series-event-actual-revision-v1',
  club_id                         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  event_id                        uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  outcome_scope                   text NOT NULL,
  finality                        text NOT NULL,
  source_kind                     text NOT NULL,
  source_timestamp_state          text NOT NULL,
  source_timestamp                timestamptz,
  captured_at                     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  captured_by                     uuid NOT NULL,
  reconciliation_status           text NOT NULL,

  entries_availability            text NOT NULL,
  entries_value                   bigint,
  unique_players_availability     text NOT NULL,
  unique_players_value            bigint,
  total_bullets_availability      text NOT NULL,
  total_bullets_value             bigint,
  reentries_availability          text NOT NULL,
  reentries_value                 bigint,
  registration_records_availability text NOT NULL,
  registration_records_value      bigint,
  paid_places_availability        text NOT NULL,
  paid_places_value               bigint,

  prize_pool_availability         text NOT NULL,
  prize_pool_amount_minor         numeric(30,0),
  prize_pool_currency             text,
  prize_pool_scale                smallint,
  overlay_availability            text NOT NULL,
  overlay_amount_minor            numeric(30,0),
  overlay_currency                text,
  overlay_scale                   smallint,

  supersedes_revision_id          uuid,
  reconciles_auto_revision_id     uuid,
  reconciles_manual_revision_id   uuid,
  idempotency_key                 text NOT NULL,
  request_hash                    text NOT NULL,
  content_hash                    text NOT NULL,
  correction_reason               text,

  CONSTRAINT sear_v1_schema_chk CHECK (schema_version = 'series-event-actual-revision-v1'),
  CONSTRAINT sear_v1_scope_chk CHECK (
    outcome_scope IN ('event_total','flight_only','day_total','series_total','partial_result','unknown')
  ),
  CONSTRAINT sear_v1_finality_chk CHECK (
    finality IN ('partial','provisional','final','corrected','conflicting','void')
  ),
  CONSTRAINT sear_v1_source_kind_chk CHECK (
    source_kind IN (
      'native_tournament_system','auto_capture','owner_manual','reconciled',
      'legacy_decision_log','import_verified'
    )
  ),
  CONSTRAINT sear_v1_source_time_chk CHECK (
    (source_timestamp_state = 'exact'
      AND source_timestamp IS NOT NULL
      AND source_timestamp <= captured_at
      AND pg_catalog.date_trunc('milliseconds', source_timestamp) = source_timestamp
      AND pg_catalog.date_trunc('milliseconds', captured_at) = captured_at)
    OR
    (source_timestamp_state = 'not_reported'
      AND source_timestamp IS NULL
      AND pg_catalog.date_trunc('milliseconds', captured_at) = captured_at)
  ),
  CONSTRAINT sear_v1_reconciliation_chk CHECK (
    reconciliation_status IN (
      'auto_only','manual_only','matching','mismatch','manually_reconciled','blocked_conflict'
    )
    AND (
      (source_kind = 'reconciled'
        AND reconciles_auto_revision_id IS NOT NULL
        AND reconciles_manual_revision_id IS NOT NULL
        AND reconciliation_status IN ('matching','mismatch','manually_reconciled','blocked_conflict'))
      OR
      (source_kind IN ('native_tournament_system','auto_capture')
        AND reconciles_auto_revision_id IS NULL
        AND reconciles_manual_revision_id IS NULL
        AND reconciliation_status = 'auto_only')
      OR
      (source_kind IN ('owner_manual','legacy_decision_log','import_verified')
        AND reconciles_auto_revision_id IS NULL
        AND reconciles_manual_revision_id IS NULL
        AND reconciliation_status = 'manual_only')
    )
  ),
  CONSTRAINT sear_v1_entries_chk CHECK (
    public._series_count_metric_valid_v1(entries_availability, entries_value)
  ),
  CONSTRAINT sear_v1_unique_chk CHECK (
    public._series_count_metric_valid_v1(unique_players_availability, unique_players_value)
  ),
  CONSTRAINT sear_v1_bullets_chk CHECK (
    public._series_count_metric_valid_v1(total_bullets_availability, total_bullets_value)
  ),
  CONSTRAINT sear_v1_reentries_chk CHECK (
    public._series_count_metric_valid_v1(reentries_availability, reentries_value)
  ),
  CONSTRAINT sear_v1_registration_records_chk CHECK (
    public._series_count_metric_valid_v1(registration_records_availability, registration_records_value)
  ),
  CONSTRAINT sear_v1_paid_places_chk CHECK (
    public._series_count_metric_valid_v1(paid_places_availability, paid_places_value)
  ),
  CONSTRAINT sear_v1_prize_pool_chk CHECK (
    public._series_money_metric_valid_v1(
      prize_pool_availability, prize_pool_amount_minor, prize_pool_currency, prize_pool_scale
    )
  ),
  CONSTRAINT sear_v1_overlay_chk CHECK (
    public._series_money_metric_valid_v1(
      overlay_availability, overlay_amount_minor, overlay_currency, overlay_scale
    )
  ),
  CONSTRAINT sear_v1_money_compatibility_chk CHECK (
    prize_pool_amount_minor IS NULL
    OR overlay_amount_minor IS NULL
    OR (
      prize_pool_currency = overlay_currency
      AND prize_pool_scale = overlay_scale
    )
  ),
  CONSTRAINT sear_v1_count_invariants_chk CHECK (
    (entries_value IS NULL OR unique_players_value IS NULL OR unique_players_value <= entries_value)
    AND
    (total_bullets_value IS NULL OR unique_players_value IS NULL OR unique_players_value <= total_bullets_value)
    AND
    (total_bullets_value IS NULL OR reentries_value IS NULL OR reentries_value <= total_bullets_value)
    AND
    (entries_value IS NULL OR paid_places_value IS NULL OR paid_places_value <= entries_value)
  ),
  CONSTRAINT sear_v1_void_chk CHECK (
    finality <> 'void'
    OR (
      entries_value IS NULL
      AND unique_players_value IS NULL
      AND total_bullets_value IS NULL
      AND reentries_value IS NULL
      AND registration_records_value IS NULL
      AND paid_places_value IS NULL
      AND prize_pool_amount_minor IS NULL
      AND overlay_amount_minor IS NULL
    )
  ),
  CONSTRAINT sear_v1_correction_chk CHECK (
    (supersedes_revision_id IS NULL AND correction_reason IS NULL)
    OR
    (supersedes_revision_id IS NOT NULL
      AND supersedes_revision_id <> id
      AND pg_catalog.btrim(correction_reason) <> '')
  ),
  CONSTRAINT sear_v1_corrected_parent_chk CHECK (
    finality NOT IN ('corrected','void') OR supersedes_revision_id IS NOT NULL
  ),
  CONSTRAINT sear_v1_idempotency_chk CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$'
    AND request_hash ~ '^[0-9a-f]{64}$'
    AND content_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT sear_v1_identity_unique UNIQUE (id, club_id, event_id, outcome_scope),
  CONSTRAINT sear_v1_parent_fk FOREIGN KEY (
    supersedes_revision_id, club_id, event_id, outcome_scope
  ) REFERENCES public.series_event_actual_revisions_v1(
    id, club_id, event_id, outcome_scope
  ) ON DELETE RESTRICT,
  CONSTRAINT sear_v1_auto_ref_fk FOREIGN KEY (
    reconciles_auto_revision_id, club_id, event_id, outcome_scope
  ) REFERENCES public.series_event_actual_revisions_v1(
    id, club_id, event_id, outcome_scope
  ) ON DELETE RESTRICT,
  CONSTRAINT sear_v1_manual_ref_fk FOREIGN KEY (
    reconciles_manual_revision_id, club_id, event_id, outcome_scope
  ) REFERENCES public.series_event_actual_revisions_v1(
    id, club_id, event_id, outcome_scope
  ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sear_v1_single_successor
  ON public.series_event_actual_revisions_v1(supersedes_revision_id)
  WHERE supersedes_revision_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sear_v1_auto_root_unique
  ON public.series_event_actual_revisions_v1(club_id, event_id, outcome_scope)
  WHERE supersedes_revision_id IS NULL
    AND source_kind IN ('native_tournament_system', 'auto_capture');
CREATE UNIQUE INDEX IF NOT EXISTS idx_sear_v1_manual_root_unique
  ON public.series_event_actual_revisions_v1(club_id, event_id, outcome_scope)
  WHERE supersedes_revision_id IS NULL
    AND source_kind IN ('owner_manual', 'legacy_decision_log', 'import_verified');
CREATE UNIQUE INDEX IF NOT EXISTS idx_sear_v1_reconciled_root_unique
  ON public.series_event_actual_revisions_v1(club_id, event_id, outcome_scope)
  WHERE supersedes_revision_id IS NULL
    AND source_kind = 'reconciled';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sear_v1_idempotency
  ON public.series_event_actual_revisions_v1(club_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sear_v1_event_scope
  ON public.series_event_actual_revisions_v1(club_id, event_id, outcome_scope, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_sear_v1_auto_ref
  ON public.series_event_actual_revisions_v1(reconciles_auto_revision_id)
  WHERE reconciles_auto_revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sear_v1_manual_ref
  ON public.series_event_actual_revisions_v1(reconciles_manual_revision_id)
  WHERE reconciles_manual_revision_id IS NOT NULL;

ALTER TABLE public.series_event_actual_revisions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.series_event_actual_revisions_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.series_event_actual_revisions_v1 TO authenticated;
GRANT SELECT ON TABLE public.series_event_actual_revisions_v1 TO service_role;

DROP POLICY IF EXISTS sear_v1_owner_select ON public.series_event_actual_revisions_v1;
CREATE POLICY sear_v1_owner_select ON public.series_event_actual_revisions_v1
  FOR SELECT TO authenticated
  USING (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
  );

CREATE OR REPLACE FUNCTION public._series_reject_actual_revision_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'series_event_actual_revision_is_append_only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_series_event_actual_revision_append_only_v1
  ON public.series_event_actual_revisions_v1;
CREATE TRIGGER trg_series_event_actual_revision_append_only_v1
  BEFORE UPDATE OR DELETE ON public.series_event_actual_revisions_v1
  FOR EACH ROW EXECUTE FUNCTION public._series_reject_actual_revision_mutation_v1();

REVOKE ALL ON FUNCTION public._series_reject_actual_revision_mutation_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Server-authoritative hashing and packet write path.
-- ---------------------------------------------------------------------------------------------

-- D2A's cross-runtime semantic hash contract. It intentionally accepts a
-- narrower domain than generic jsonb: ASCII machine keys, NFC+trimmed strings,
-- non-negative safe-integer JSON numbers, array order preserved, and C-order
-- object keys. This mirrors decisionPacketCanonicalV1.ts byte for byte.
CREATE OR REPLACE FUNCTION public._series_canonical_json_v1(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_type text;
  v_text text;
  v_key text;
  v_child jsonb;
  v_result text;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'series_canonical_json_sql_null' USING ERRCODE = '22023';
  END IF;

  v_type := pg_catalog.jsonb_typeof(p_value);
  IF v_type = 'null' THEN
    RETURN 'null';
  ELSIF v_type = 'boolean' THEN
    v_text := p_value #>> '{}';
    IF v_text NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_boolean' USING ERRCODE = '22023';
    END IF;
    RETURN v_text;
  ELSIF v_type = 'number' THEN
    v_text := p_value #>> '{}';
    IF v_text !~ '^(0|[1-9][0-9]*)$'
      OR v_text::numeric > 9007199254740991::numeric
    THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_safe_integer' USING ERRCODE = '22023';
    END IF;
    RETURN v_text;
  ELSIF v_type = 'string' THEN
    v_text := pg_catalog.btrim(pg_catalog.normalize(p_value #>> '{}', NFC));
    IF v_text ~ E'[\001-\010\013\014\016-\037\177]' THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_control' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.to_json(v_text)::text;
  ELSIF v_type = 'array' THEN
    SELECT '[' || COALESCE(
      pg_catalog.string_agg(public._series_canonical_json_v1(member.value), ',' ORDER BY member.ordinality),
      ''
    ) || ']'
    INTO v_result
    FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS member(value, ordinality);
    RETURN v_result;
  ELSIF v_type = 'object' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS member(key, value)
      WHERE pg_catalog.btrim(pg_catalog.normalize(member.key, NFC)) !~ '^[A-Za-z][A-Za-z0-9]*$'
    ) THEN
      RAISE EXCEPTION 'series_canonical_json_invalid_machine_key' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT pg_catalog.btrim(pg_catalog.normalize(member.key, NFC)) AS normalized_key
        FROM pg_catalog.jsonb_each(p_value) AS member(key, value)
      ) AS normalized
      GROUP BY normalized.normalized_key
      HAVING pg_catalog.count(*) > 1
    ) THEN
      RAISE EXCEPTION 'series_canonical_json_duplicate_key_after_nfc' USING ERRCODE = '22023';
    END IF;
    SELECT '{' || COALESCE(
      pg_catalog.string_agg(
        pg_catalog.to_json(member.normalized_key)::text
        || ':' || public._series_canonical_json_v1(member.value),
        ',' ORDER BY member.normalized_key COLLATE "C"
      ),
      ''
    ) || '}'
    INTO v_result
    FROM (
      SELECT
        pg_catalog.btrim(pg_catalog.normalize(source.key, NFC)) AS normalized_key,
        source.value
      FROM pg_catalog.jsonb_each(p_value) AS source(key, value)
    ) AS member;
    RETURN v_result;
  END IF;

  RAISE EXCEPTION 'series_canonical_json_unsupported_value' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public._series_canonical_jsonb_v1(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public._series_canonical_json_v1(p_value)::jsonb
$$;

CREATE OR REPLACE FUNCTION public._series_canonical_timestamptz_v1(p_value timestamptz)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_value IS NULL
    OR pg_catalog.date_trunc('milliseconds', p_value) <> p_value
  THEN
    RAISE EXCEPTION 'series_canonical_timestamp_not_millisecond_exact' USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.to_char(
    p_value AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._series_sha256_jsonb_v1(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(public._series_canonical_json_v1(p_payload), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION public._series_decision_packet_content_payload_v1(
  p_packet public.series_decision_packets_v1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'hashContractVersion', 'series-canonical-json-v1',
    'schemaVersion', p_packet.schema_version,
    'clubId', p_packet.club_id::text,
    'eventId', p_packet.event_id::text,
    'horizon', p_packet.decision_horizon,
    'targetMetric', p_packet.target_metric,
    'asOfTs', public._series_canonical_timestamptz_v1(p_packet.as_of_ts),
    'sourceCutoff', public._series_canonical_timestamptz_v1(p_packet.source_cutoff),
    'targetEventTs', public._series_canonical_timestamptz_v1(p_packet.target_event_ts),
    'forecastSnapshotId', CASE WHEN p_packet.forecast_snapshot_id IS NULL THEN NULL ELSE p_packet.forecast_snapshot_id::text END,
    'forecastState', p_packet.forecast_state,
    'manualExpectation', p_packet.manual_expectation,
    'publicEvidence', p_packet.public_evidence_manifest,
    'registrationSlice', p_packet.registration_slice_manifest,
    'campaignSlice', p_packet.campaign_slice_manifest,
    'knownInformation', p_packet.known_information,
    'recommendedAction', CASE
      WHEN p_packet.recommended_action IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'text', p_packet.recommended_action,
        'sourceKind', p_packet.recommendation_source_kind,
        'sourceReferenceId', p_packet.recommendation_source_ref
      )
    END,
    'ownerDecision', p_packet.owner_decision,
    'publicAction', p_packet.public_action,
    'decisionReason', p_packet.decision_reason,
    'alternatives', p_packet.alternatives,
    'assumptions', p_packet.assumptions,
    'uncertaintyNotes', p_packet.uncertainty_notes,
    'supersedesPacketId', CASE WHEN p_packet.supersedes_packet_id IS NULL THEN NULL ELSE p_packet.supersedes_packet_id::text END,
    'correctionReason', p_packet.correction_reason
  )
$$;

CREATE OR REPLACE FUNCTION public._series_decision_packet_content_hash_v1(
  p_packet public.series_decision_packets_v1
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public._series_sha256_jsonb_v1(public._series_decision_packet_content_payload_v1(p_packet))
$$;

CREATE OR REPLACE FUNCTION public._series_decision_packet_request_payload_v1(
  p_packet public.series_decision_packets_v1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_set(
    public._series_decision_packet_content_payload_v1(p_packet) - 'clubId',
    '{requestKind}',
    '"decisionPacketCreateRequest"'::jsonb,
    true
  )
$$;

REVOKE ALL ON FUNCTION public._series_canonical_json_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_canonical_jsonb_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_canonical_timestamptz_v1(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_sha256_jsonb_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_decision_packet_content_payload_v1(
  public.series_decision_packets_v1
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_decision_packet_request_payload_v1(
  public.series_decision_packets_v1
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_decision_packet_content_hash_v1(
  public.series_decision_packets_v1
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._series_d2a_normalize_bounded_text_v1(
  p_value text,
  p_max_length integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_value text;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'series_d2a_text_null' USING ERRCODE = '22023';
  END IF;
  v_value := pg_catalog.btrim(pg_catalog.normalize(p_value, NFC));
  IF pg_catalog.char_length(v_value) = 0
    OR pg_catalog.char_length(v_value) > p_max_length
    OR v_value ~ E'[\001-\010\013\014\016-\037\177]'
  THEN
    RAISE EXCEPTION 'series_d2a_text_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_d2a_normalize_text_set_v1(
  p_value jsonb,
  p_max_length integer
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_text text;
  v_values text[] := ARRAY[]::text[];
BEGIN
  IF p_value IS NULL OR pg_catalog.jsonb_typeof(p_value) <> 'array' THEN
    RAISE EXCEPTION 'series_d2a_text_set_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'string' THEN
      RAISE EXCEPTION 'series_d2a_text_set_member_invalid' USING ERRCODE = '22023';
    END IF;
    v_text := public._series_d2a_normalize_bounded_text_v1(v_item #>> '{}', p_max_length);
    IF v_text = ANY (v_values) THEN
      RAISE EXCEPTION 'series_d2a_text_set_duplicate' USING ERRCODE = '22023';
    END IF;
    v_values := pg_catalog.array_append(v_values, v_text);
  END LOOP;
  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(member.value) ORDER BY member.value COLLATE "C"),
    '[]'::jsonb
  )
  INTO p_value
  FROM pg_catalog.unnest(v_values) AS member(value);
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_d2a_normalize_evidence_manifest_v1(
  p_value jsonb,
  p_packet_cutoff timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_kind text;
  v_reference_id text;
  v_content_hash text;
  v_source_cutoff timestamptz;
  v_identity text;
  v_seen text[] := ARRAY[]::text[];
  v_normalized jsonb[] := ARRAY[]::jsonb[];
BEGIN
  IF NOT public._series_packet_evidence_manifest_valid_v1(p_value, p_packet_cutoff) THEN
    RAISE EXCEPTION 'series_d2a_evidence_manifest_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value)
  LOOP
    v_kind := public._series_d2a_normalize_bounded_text_v1(v_item ->> 'kind', 128);
    v_reference_id := public._series_d2a_normalize_bounded_text_v1(v_item ->> 'referenceId', 512);
    v_content_hash := pg_catalog.lower(v_item ->> 'contentHash');
    v_source_cutoff := (v_item ->> 'sourceCutoff')::timestamptz;
    v_identity := v_kind || ':' || v_reference_id;
    IF v_identity = ANY (v_seen) THEN
      RAISE EXCEPTION 'series_d2a_evidence_duplicate' USING ERRCODE = '22023';
    END IF;
    v_seen := pg_catalog.array_append(v_seen, v_identity);
    v_normalized := pg_catalog.array_append(v_normalized, pg_catalog.jsonb_build_object(
      'kind', v_kind,
      'referenceId', v_reference_id,
      'contentHash', v_content_hash,
      'sourceCutoff', public._series_canonical_timestamptz_v1(v_source_cutoff)
    ));
  END LOOP;
  SELECT COALESCE(
    pg_catalog.jsonb_agg(member.value ORDER BY (member.value ->> 'kind') || ':' || (member.value ->> 'referenceId') COLLATE "C"),
    '[]'::jsonb
  )
  INTO p_value
  FROM pg_catalog.unnest(v_normalized) AS member(value);
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_d2a_normalize_slice_manifest_v1(
  p_value jsonb,
  p_observation_count integer,
  p_packet_cutoff timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source_cutoff timestamptz;
BEGIN
  IF p_value IS NULL THEN
    IF p_observation_count IS NULL THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'series_d2a_slice_shape_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public._series_packet_slice_manifest_valid_v1(p_value, p_observation_count, p_packet_cutoff) THEN
    RAISE EXCEPTION 'series_d2a_slice_manifest_invalid' USING ERRCODE = '22023';
  END IF;
  v_source_cutoff := (p_value ->> 'sourceCutoff')::timestamptz;
  RETURN pg_catalog.jsonb_build_object(
    'manifestId', public._series_d2a_normalize_bounded_text_v1(p_value ->> 'manifestId', 512),
    'contentHash', pg_catalog.lower(p_value ->> 'contentHash'),
    'observationCount', p_observation_count,
    'sourceCutoff', public._series_canonical_timestamptz_v1(v_source_cutoff)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._series_event_actual_content_payload_v1(
  p_actual public.series_event_actual_revisions_v1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'hashContractVersion', 'series-canonical-json-v1',
    'schemaVersion', p_actual.schema_version,
    'clubId', p_actual.club_id::text,
    'eventId', p_actual.event_id::text,
    'scope', p_actual.outcome_scope,
    'finality', p_actual.finality,
    'sourceKind', p_actual.source_kind,
    'sourceTimestampState', p_actual.source_timestamp_state,
    'sourceTimestamp', CASE
      WHEN p_actual.source_timestamp IS NULL THEN NULL
      ELSE public._series_canonical_timestamptz_v1(p_actual.source_timestamp)
    END,
    'capturedAt', public._series_canonical_timestamptz_v1(p_actual.captured_at),
    'reconciliationStatus', p_actual.reconciliation_status,
    'metrics', pg_catalog.jsonb_build_object(
      'entries', pg_catalog.jsonb_build_object('availability', p_actual.entries_availability, 'value', p_actual.entries_value),
      'uniquePlayers', pg_catalog.jsonb_build_object('availability', p_actual.unique_players_availability, 'value', p_actual.unique_players_value),
      'totalBullets', pg_catalog.jsonb_build_object('availability', p_actual.total_bullets_availability, 'value', p_actual.total_bullets_value),
      'reentries', pg_catalog.jsonb_build_object('availability', p_actual.reentries_availability, 'value', p_actual.reentries_value),
      'registrationRecords', pg_catalog.jsonb_build_object('availability', p_actual.registration_records_availability, 'value', p_actual.registration_records_value),
      'paidPlaces', pg_catalog.jsonb_build_object('availability', p_actual.paid_places_availability, 'value', p_actual.paid_places_value),
      'prizePool', pg_catalog.jsonb_build_object(
        'availability', p_actual.prize_pool_availability,
        'amountMinor', CASE WHEN p_actual.prize_pool_amount_minor IS NULL THEN NULL ELSE p_actual.prize_pool_amount_minor::text END,
        'currency', p_actual.prize_pool_currency,
        'scale', p_actual.prize_pool_scale
      ),
      'overlay', pg_catalog.jsonb_build_object(
        'availability', p_actual.overlay_availability,
        'amountMinor', CASE WHEN p_actual.overlay_amount_minor IS NULL THEN NULL ELSE p_actual.overlay_amount_minor::text END,
        'currency', p_actual.overlay_currency,
        'scale', p_actual.overlay_scale
      )
    ),
    'supersedesRevisionId', CASE WHEN p_actual.supersedes_revision_id IS NULL THEN NULL ELSE p_actual.supersedes_revision_id::text END,
    'reconcilesAutoRevisionId', CASE WHEN p_actual.reconciles_auto_revision_id IS NULL THEN NULL ELSE p_actual.reconciles_auto_revision_id::text END,
    'reconcilesManualRevisionId', CASE WHEN p_actual.reconciles_manual_revision_id IS NULL THEN NULL ELSE p_actual.reconciles_manual_revision_id::text END,
    'idempotencyKey', p_actual.idempotency_key,
    'correctionReason', p_actual.correction_reason
  )
$$;

CREATE OR REPLACE FUNCTION public._series_event_actual_request_payload_v1(
  p_actual public.series_event_actual_revisions_v1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_set(
    public._series_event_actual_content_payload_v1(p_actual)
      - ARRAY[
        'clubId',
        'sourceKind',
        'capturedAt',
        'reconciliationStatus',
        'reconcilesAutoRevisionId',
        'reconcilesManualRevisionId'
      ],
    '{requestKind}',
    '"eventActualCreateRequest"'::jsonb,
    true
  )
$$;

REVOKE ALL ON FUNCTION public._series_d2a_normalize_bounded_text_v1(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2a_normalize_text_set_v1(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2a_normalize_evidence_manifest_v1(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2a_normalize_slice_manifest_v1(jsonb, integer, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_event_actual_content_payload_v1(
  public.series_event_actual_revisions_v1
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_event_actual_request_payload_v1(
  public.series_event_actual_revisions_v1
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.series_create_decision_packet_v1(
  p_event_id uuid,
  p_decision_horizon text,
  p_target_metric text,
  p_as_of_ts timestamptz,
  p_source_cutoff timestamptz,
  p_target_event_ts timestamptz,
  p_forecast_snapshot_id uuid,
  p_forecast_state text,
  p_manual_expectation bigint,
  p_public_evidence_manifest jsonb,
  p_registration_slice_manifest jsonb,
  p_registration_observation_count integer,
  p_campaign_slice_manifest jsonb,
  p_campaign_observation_count integer,
  p_known_information jsonb,
  p_recommended_action text,
  p_recommendation_source_kind text,
  p_recommendation_source_ref text,
  p_owner_decision text,
  p_public_action text,
  p_decision_reason text,
  p_alternatives jsonb,
  p_assumptions jsonb,
  p_uncertainty_notes text,
  p_supersedes_packet_id uuid,
  p_correction_reason text,
  p_idempotency_key text
)
RETURNS public.series_decision_packets_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.tournaments%ROWTYPE;
  v_parent public.series_decision_packets_v1%ROWTYPE;
  v_existing public.series_decision_packets_v1%ROWTYPE;
  v_snapshot public.series_forecast_snapshots%ROWTYPE;
  v_as_of_ts timestamptz;
  v_source_cutoff timestamptz;
  v_target_event_ts timestamptz;
  v_public_evidence_manifest jsonb;
  v_registration_slice_manifest jsonb;
  v_campaign_slice_manifest jsonb;
  v_known_information jsonb;
  v_alternatives jsonb;
  v_assumptions jsonb;
  v_recommended_action text;
  v_recommendation_source_kind text;
  v_recommendation_source_ref text;
  v_owner_decision text;
  v_public_action text;
  v_decision_reason text;
  v_uncertainty_notes text;
  v_correction_reason text;
  v_request_hash text;
  v_result public.series_decision_packets_v1%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'decision_packet_unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event
  FROM public.tournaments
  WHERE id = p_event_id
    AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_club_owner(v_actor, v_event.club_id) THEN
    RAISE EXCEPTION 'decision_packet_event_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$'
  THEN
    RAISE EXCEPTION 'decision_packet_invalid_idempotency_key' USING ERRCODE = '22023';
  END IF;

  IF p_as_of_ts IS NULL
    OR p_source_cutoff IS NULL
    OR p_target_event_ts IS NULL
    OR pg_catalog.date_trunc('milliseconds', p_as_of_ts) <> p_as_of_ts
    OR pg_catalog.date_trunc('milliseconds', p_source_cutoff) <> p_source_cutoff
    OR pg_catalog.date_trunc('milliseconds', p_target_event_ts) <> p_target_event_ts
    OR (p_manual_expectation IS NOT NULL AND (p_manual_expectation < 0 OR p_manual_expectation > 9007199254740991))
  THEN
    RAISE EXCEPTION 'decision_packet_invalid_canonical_time_or_count' USING ERRCODE = '22023';
  END IF;
  v_as_of_ts := p_as_of_ts;
  v_source_cutoff := p_source_cutoff;
  v_target_event_ts := p_target_event_ts;

  IF public._series_jsonb_has_forbidden_packet_key_v1(p_public_evidence_manifest)
    OR public._series_jsonb_has_forbidden_packet_key_v1(p_registration_slice_manifest)
    OR public._series_jsonb_has_forbidden_packet_key_v1(p_campaign_slice_manifest)
    OR public._series_jsonb_has_forbidden_packet_key_v1(p_known_information)
  THEN
    RAISE EXCEPTION 'decision_packet_outcome_or_pii_leakage' USING ERRCODE = '22023';
  END IF;
  v_public_evidence_manifest := public._series_d2a_normalize_evidence_manifest_v1(
    COALESCE(p_public_evidence_manifest, '[]'::jsonb), v_source_cutoff
  );
  v_registration_slice_manifest := public._series_d2a_normalize_slice_manifest_v1(
    p_registration_slice_manifest, p_registration_observation_count, v_source_cutoff
  );
  v_campaign_slice_manifest := public._series_d2a_normalize_slice_manifest_v1(
    p_campaign_slice_manifest, p_campaign_observation_count, v_source_cutoff
  );
  v_known_information := public._series_canonical_jsonb_v1(COALESCE(p_known_information, '{}'::jsonb));
  v_alternatives := public._series_d2a_normalize_text_set_v1(COALESCE(p_alternatives, '[]'::jsonb), 2048);
  v_assumptions := public._series_d2a_normalize_text_set_v1(COALESCE(p_assumptions, '[]'::jsonb), 2048);
  v_recommended_action := CASE WHEN p_recommended_action IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_recommended_action, 4096) END;
  v_recommendation_source_kind := CASE WHEN p_recommendation_source_kind IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_recommendation_source_kind, 128) END;
  v_recommendation_source_ref := CASE WHEN p_recommendation_source_ref IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_recommendation_source_ref, 512) END;
  v_owner_decision := CASE WHEN p_owner_decision IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_owner_decision, 4096) END;
  v_public_action := CASE WHEN p_public_action IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_public_action, 4096) END;
  v_decision_reason := CASE WHEN p_decision_reason IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_decision_reason, 8192) END;
  v_uncertainty_notes := CASE WHEN p_uncertainty_notes IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_uncertainty_notes, 8192) END;
  v_correction_reason := CASE WHEN p_correction_reason IS NULL THEN NULL ELSE public._series_d2a_normalize_bounded_text_v1(p_correction_reason, 4096) END;

  v_request_hash := public._series_sha256_jsonb_v1(pg_catalog.jsonb_build_object(
    'hashContractVersion', 'series-canonical-json-v1',
    'requestKind', 'decisionPacketCreateRequest',
    'schemaVersion', 'series-decision-packet-v1',
    'eventId', p_event_id::text,
    'horizon', p_decision_horizon,
    'targetMetric', p_target_metric,
    'asOfTs', public._series_canonical_timestamptz_v1(v_as_of_ts),
    'sourceCutoff', public._series_canonical_timestamptz_v1(v_source_cutoff),
    'targetEventTs', public._series_canonical_timestamptz_v1(v_target_event_ts),
    'forecastSnapshotId', CASE WHEN p_forecast_snapshot_id IS NULL THEN NULL ELSE p_forecast_snapshot_id::text END,
    'forecastState', p_forecast_state,
    'manualExpectation', p_manual_expectation,
    'publicEvidence', v_public_evidence_manifest,
    'registrationSlice', v_registration_slice_manifest,
    'campaignSlice', v_campaign_slice_manifest,
    'knownInformation', v_known_information,
    'recommendedAction', CASE WHEN v_recommended_action IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'text', v_recommended_action,
      'sourceKind', v_recommendation_source_kind,
      'sourceReferenceId', v_recommendation_source_ref
    ) END,
    'ownerDecision', v_owner_decision,
    'publicAction', v_public_action,
    'decisionReason', v_decision_reason,
    'alternatives', v_alternatives,
    'assumptions', v_assumptions,
    'uncertaintyNotes', v_uncertainty_notes,
    'supersedesPacketId', CASE WHEN p_supersedes_packet_id IS NULL THEN NULL ELSE p_supersedes_packet_id::text END,
    'correctionReason', v_correction_reason
  ));

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'decision-packet-idempotency:' || v_event.club_id::text || ':' || p_idempotency_key,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'decision-packet-root:' || v_event.club_id::text || ':' || p_event_id::text
        || ':' || COALESCE(p_decision_horizon, ''),
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.series_decision_packets_v1
  WHERE club_id = v_event.club_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'decision_packet_idempotency_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing;
  END IF;

  IF v_event.status::text IN ('finished','completed','cancelled') THEN
    RAISE EXCEPTION 'decision_packet_event_already_closed' USING ERRCODE = '55000';
  END IF;
  IF v_target_event_ts IS DISTINCT FROM v_event.start_time THEN
    RAISE EXCEPTION 'decision_packet_target_event_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_source_cutoff > v_as_of_ts OR v_as_of_ts > pg_catalog.now() THEN
    RAISE EXCEPTION 'decision_packet_invalid_origin_time' USING ERRCODE = '22023';
  END IF;
  IF v_recommendation_source_kind = 'research_artifact'
    AND NOT public._series_packet_research_artifact_reference_valid_v1(
      v_public_evidence_manifest,
      v_recommendation_source_ref
    )
  THEN
    RAISE EXCEPTION 'decision_packet_recommendation_source_mismatch' USING ERRCODE = '22023';
  END IF;

  IF p_forecast_snapshot_id IS NOT NULL THEN
    SELECT * INTO v_snapshot
    FROM public.series_forecast_snapshots
    WHERE id = p_forecast_snapshot_id;
    IF NOT FOUND
      OR p_target_metric <> 'entries'
      OR v_snapshot.club_id <> v_event.club_id
      OR v_snapshot.event_id <> p_event_id
      OR v_snapshot.forecast_issued_at IS NULL
      OR v_snapshot.as_of_ts IS NULL
      OR v_snapshot.target_event_ts IS DISTINCT FROM v_target_event_ts
      OR v_snapshot.forecast_issued_at > v_as_of_ts
      OR v_snapshot.as_of_ts > v_snapshot.forecast_issued_at
      OR v_snapshot.forecast_issued_at > v_target_event_ts
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_identity_mismatch' USING ERRCODE = '22023';
    END IF;
    IF p_forecast_state = 'forecast_identity_eligible'
      AND v_snapshot.forecast_identity_eligible IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_not_identity_eligible' USING ERRCODE = '22023';
    END IF;
    IF p_forecast_state = 'forecast_provenance_incomplete'
      AND (
        v_snapshot.forecast_identity_eligible IS DISTINCT FROM false
        OR v_snapshot.provenance_completeness IS DISTINCT FROM 'missing_code_sha'
      )
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_state_mismatch' USING ERRCODE = '22023';
    END IF;
    IF p_forecast_state = 'forecast_not_identity_eligible'
      AND (
        v_snapshot.forecast_identity_eligible IS DISTINCT FROM false
        OR (v_snapshot.provenance_completeness IN ('manual','complete')) IS DISTINCT FROM true
      )
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_state_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_supersedes_packet_id IS NOT NULL THEN
    SELECT * INTO v_parent
    FROM public.series_decision_packets_v1
    WHERE id = p_supersedes_packet_id
    FOR UPDATE;
    IF NOT FOUND
      OR v_parent.club_id <> v_event.club_id
      OR v_parent.event_id <> p_event_id
      OR v_parent.decision_horizon <> p_decision_horizon
      OR v_parent.target_metric <> p_target_metric
      OR v_parent.packet_state <> 'frozen'
    THEN
      RAISE EXCEPTION 'decision_packet_invalid_predecessor' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.series_decision_packets_v1
      WHERE supersedes_packet_id = p_supersedes_packet_id
    ) THEN
      RAISE EXCEPTION 'decision_packet_predecessor_already_superseded' USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public.series_decision_packets_v1 (
    club_id, event_id, decision_horizon, target_metric, as_of_ts, source_cutoff,
    target_event_ts, forecast_snapshot_id, forecast_state, manual_expectation,
    public_evidence_manifest, public_evidence_manifest_hash,
    registration_slice_manifest, registration_slice_hash, registration_observation_count,
    campaign_slice_manifest, campaign_slice_hash, campaign_observation_count,
    known_information, known_information_hash,
    recommended_action, recommendation_source_kind, recommendation_source_ref,
    owner_decision, public_action, decision_reason, alternatives, assumptions,
    uncertainty_notes, idempotency_key, request_hash, created_by,
    supersedes_packet_id, correction_reason
  ) VALUES (
    v_event.club_id, p_event_id, p_decision_horizon, p_target_metric, v_as_of_ts, v_source_cutoff,
    v_target_event_ts, p_forecast_snapshot_id, p_forecast_state, p_manual_expectation,
    v_public_evidence_manifest,
    public._series_sha256_jsonb_v1(v_public_evidence_manifest),
    v_registration_slice_manifest,
    CASE WHEN v_registration_slice_manifest IS NULL THEN NULL
      ELSE public._series_sha256_jsonb_v1(v_registration_slice_manifest) END,
    p_registration_observation_count,
    v_campaign_slice_manifest,
    CASE WHEN v_campaign_slice_manifest IS NULL THEN NULL
      ELSE public._series_sha256_jsonb_v1(v_campaign_slice_manifest) END,
    p_campaign_observation_count,
    v_known_information,
    public._series_sha256_jsonb_v1(v_known_information),
    v_recommended_action, v_recommendation_source_kind, v_recommendation_source_ref,
    v_owner_decision, v_public_action, v_decision_reason,
    v_alternatives, v_assumptions,
    v_uncertainty_notes, p_idempotency_key, v_request_hash, v_actor,
    p_supersedes_packet_id, v_correction_reason
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.series_freeze_decision_packet_v1(
  p_packet_id uuid,
  p_expected_draft_version bigint
)
RETURNS public.series_decision_packets_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_packet public.series_decision_packets_v1%ROWTYPE;
  v_event public.tournaments%ROWTYPE;
  v_snapshot public.series_forecast_snapshots%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_packet_id IS NULL THEN
    RAISE EXCEPTION 'decision_packet_unauthenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_packet_id::text, 0));

  SELECT * INTO v_packet
  FROM public.series_decision_packets_v1
  WHERE id = p_packet_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_owner(v_actor, v_packet.club_id) THEN
    RAISE EXCEPTION 'decision_packet_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_packet.packet_state = 'frozen' THEN
    RETURN v_packet;
  END IF;
  IF v_packet.draft_version <> p_expected_draft_version THEN
    RAISE EXCEPTION 'decision_packet_draft_conflict' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_event
  FROM public.tournaments
  WHERE id = v_packet.event_id
    AND club_id = v_packet.club_id
    AND deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND
    OR v_event.start_time IS DISTINCT FROM v_packet.target_event_ts
    OR v_event.status::text IN ('finished','completed','cancelled')
    OR v_packet.as_of_ts > v_packet.created_at
  THEN
    RAISE EXCEPTION 'decision_packet_event_not_freezable' USING ERRCODE = '55000';
  END IF;

  IF v_packet.forecast_snapshot_id IS NOT NULL THEN
    SELECT * INTO v_snapshot
    FROM public.series_forecast_snapshots
    WHERE id = v_packet.forecast_snapshot_id;
    IF NOT FOUND
      OR v_snapshot.club_id <> v_packet.club_id
      OR v_snapshot.event_id <> v_packet.event_id
      OR v_snapshot.forecast_issued_at IS NULL
      OR v_snapshot.as_of_ts IS NULL
      OR v_snapshot.target_event_ts IS DISTINCT FROM v_packet.target_event_ts
      OR v_snapshot.forecast_issued_at > v_packet.as_of_ts
      OR v_snapshot.as_of_ts > v_snapshot.forecast_issued_at
      OR v_snapshot.forecast_issued_at > v_packet.target_event_ts
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_identity_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_packet.forecast_state = 'forecast_identity_eligible'
      AND v_snapshot.forecast_identity_eligible IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_not_identity_eligible' USING ERRCODE = '22023';
    END IF;
    IF v_packet.forecast_state = 'forecast_provenance_incomplete'
      AND (
        v_snapshot.forecast_identity_eligible IS DISTINCT FROM false
        OR v_snapshot.provenance_completeness IS DISTINCT FROM 'missing_code_sha'
      )
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_state_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_packet.forecast_state = 'forecast_not_identity_eligible'
      AND (
        v_snapshot.forecast_identity_eligible IS DISTINCT FROM false
        OR (v_snapshot.provenance_completeness IN ('manual','complete')) IS DISTINCT FROM true
      )
    THEN
      RAISE EXCEPTION 'decision_packet_forecast_state_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.series_decision_packets_v1
  SET packet_state = 'frozen',
      content_hash = public._series_decision_packet_content_hash_v1(v_packet),
      frozen_at = pg_catalog.now(),
      frozen_by = v_actor
  WHERE id = p_packet_id
  RETURNING * INTO v_packet;

  RETURN v_packet;
END;
$$;

REVOKE ALL ON FUNCTION public.series_create_decision_packet_v1(
  uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,text,bigint,
  jsonb,jsonb,integer,jsonb,integer,jsonb,text,text,text,text,text,text,
  jsonb,jsonb,text,uuid,text,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.series_create_decision_packet_v1(
  uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,text,bigint,
  jsonb,jsonb,integer,jsonb,integer,jsonb,text,text,text,text,text,text,
  jsonb,jsonb,text,uuid,text,text
) TO authenticated;

REVOKE ALL ON FUNCTION public.series_freeze_decision_packet_v1(uuid,bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.series_freeze_decision_packet_v1(uuid,bigint)
  TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Owner-only manual actual capture. System/autosync integration remains a later source PR.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.series_record_event_actual_v1(
  p_event_id uuid,
  p_outcome_scope text,
  p_finality text,
  p_source_timestamp_state text,
  p_source_timestamp timestamptz,
  p_entries_availability text,
  p_entries_value bigint,
  p_unique_players_availability text,
  p_unique_players_value bigint,
  p_total_bullets_availability text,
  p_total_bullets_value bigint,
  p_reentries_availability text,
  p_reentries_value bigint,
  p_registration_records_availability text,
  p_registration_records_value bigint,
  p_paid_places_availability text,
  p_paid_places_value bigint,
  p_prize_pool_availability text,
  p_prize_pool_amount_minor numeric,
  p_prize_pool_currency text,
  p_prize_pool_scale smallint,
  p_overlay_availability text,
  p_overlay_amount_minor numeric,
  p_overlay_currency text,
  p_overlay_scale smallint,
  p_supersedes_revision_id uuid,
  p_idempotency_key text,
  p_correction_reason text
)
RETURNS public.series_event_actual_revisions_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.tournaments%ROWTYPE;
  v_parent public.series_event_actual_revisions_v1%ROWTYPE;
  v_existing public.series_event_actual_revisions_v1%ROWTYPE;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_prize_pool_currency text;
  v_overlay_currency text;
  v_correction_reason text;
  v_metrics jsonb;
  v_request_payload jsonb;
  v_content_payload jsonb;
  v_request_hash text;
  v_content_hash text;
  v_result public.series_event_actual_revisions_v1%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'event_actual_unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event
  FROM public.tournaments
  WHERE id = p_event_id
    AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_club_owner(v_actor, v_event.club_id) THEN
    RAISE EXCEPTION 'event_actual_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$'
  THEN
    RAISE EXCEPTION 'event_actual_invalid_idempotency_key' USING ERRCODE = '22023';
  END IF;

  IF (p_source_timestamp_state = 'exact' AND (
      p_source_timestamp IS NULL
      OR pg_catalog.date_trunc('milliseconds', p_source_timestamp) <> p_source_timestamp
      OR p_source_timestamp > v_now
    ))
    OR (p_source_timestamp_state = 'not_reported' AND p_source_timestamp IS NOT NULL)
    OR p_source_timestamp_state NOT IN ('exact', 'not_reported')
    OR p_entries_value > 9007199254740991
    OR p_unique_players_value > 9007199254740991
    OR p_total_bullets_value > 9007199254740991
    OR p_reentries_value > 9007199254740991
    OR p_registration_records_value > 9007199254740991
    OR p_paid_places_value > 9007199254740991
  THEN
    RAISE EXCEPTION 'event_actual_invalid_canonical_time_or_count' USING ERRCODE = '22023';
  END IF;
  v_prize_pool_currency := CASE WHEN p_prize_pool_currency IS NULL THEN NULL ELSE pg_catalog.upper(p_prize_pool_currency) END;
  v_overlay_currency := CASE WHEN p_overlay_currency IS NULL THEN NULL ELSE pg_catalog.upper(p_overlay_currency) END;
  v_correction_reason := CASE
    WHEN p_correction_reason IS NULL THEN NULL
    ELSE public._series_d2a_normalize_bounded_text_v1(p_correction_reason, 4096)
  END;
  v_metrics := pg_catalog.jsonb_build_object(
    'entries', pg_catalog.jsonb_build_object('availability', p_entries_availability, 'value', p_entries_value),
    'uniquePlayers', pg_catalog.jsonb_build_object('availability', p_unique_players_availability, 'value', p_unique_players_value),
    'totalBullets', pg_catalog.jsonb_build_object('availability', p_total_bullets_availability, 'value', p_total_bullets_value),
    'reentries', pg_catalog.jsonb_build_object('availability', p_reentries_availability, 'value', p_reentries_value),
    'registrationRecords', pg_catalog.jsonb_build_object('availability', p_registration_records_availability, 'value', p_registration_records_value),
    'paidPlaces', pg_catalog.jsonb_build_object('availability', p_paid_places_availability, 'value', p_paid_places_value),
    'prizePool', pg_catalog.jsonb_build_object(
      'availability', p_prize_pool_availability,
      'amountMinor', CASE WHEN p_prize_pool_amount_minor IS NULL THEN NULL ELSE p_prize_pool_amount_minor::text END,
      'currency', v_prize_pool_currency,
      'scale', p_prize_pool_scale
    ),
    'overlay', pg_catalog.jsonb_build_object(
      'availability', p_overlay_availability,
      'amountMinor', CASE WHEN p_overlay_amount_minor IS NULL THEN NULL ELSE p_overlay_amount_minor::text END,
      'currency', v_overlay_currency,
      'scale', p_overlay_scale
    )
  );
  v_request_payload := pg_catalog.jsonb_build_object(
    'hashContractVersion', 'series-canonical-json-v1',
    'requestKind', 'eventActualCreateRequest',
    'schemaVersion', 'series-event-actual-revision-v1',
    'eventId', p_event_id::text,
    'scope', p_outcome_scope,
    'finality', p_finality,
    'sourceTimestampState', p_source_timestamp_state,
    'sourceTimestamp', CASE WHEN p_source_timestamp IS NULL THEN NULL ELSE public._series_canonical_timestamptz_v1(p_source_timestamp) END,
    'metrics', v_metrics,
    'supersedesRevisionId', CASE WHEN p_supersedes_revision_id IS NULL THEN NULL ELSE p_supersedes_revision_id::text END,
    'correctionReason', v_correction_reason
  );
  v_request_hash := public._series_sha256_jsonb_v1(v_request_payload);

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'event-actual-idempotency:' || v_event.club_id::text || ':' || p_idempotency_key,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'event-actual-lineage:' || p_event_id::text || ':' || COALESCE(p_outcome_scope, ''),
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.series_event_actual_revisions_v1
  WHERE club_id = v_event.club_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.event_id <> p_event_id
      OR v_existing.outcome_scope <> p_outcome_scope
      OR v_existing.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'event_actual_idempotency_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing;
  END IF;

  IF p_finality IN ('final','corrected')
    AND v_event.status::text NOT IN ('finished','completed')
  THEN
    RAISE EXCEPTION 'event_actual_finality_not_supported_by_event_state' USING ERRCODE = '55000';
  END IF;
  IF p_finality IN ('final','corrected')
    AND p_source_timestamp_state = 'exact'
    AND p_source_timestamp < v_event.start_time
  THEN
    RAISE EXCEPTION 'event_actual_final_published_before_event' USING ERRCODE = '22023';
  END IF;

  IF p_supersedes_revision_id IS NOT NULL THEN
    SELECT * INTO v_parent
    FROM public.series_event_actual_revisions_v1
    WHERE id = p_supersedes_revision_id
    FOR UPDATE;
    IF NOT FOUND
      OR v_parent.club_id <> v_event.club_id
      OR v_parent.event_id <> p_event_id
      OR v_parent.outcome_scope <> p_outcome_scope
      OR v_parent.source_kind NOT IN ('owner_manual','legacy_decision_log','import_verified')
    THEN
      RAISE EXCEPTION 'event_actual_invalid_predecessor' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.series_event_actual_revisions_v1
      WHERE supersedes_revision_id = p_supersedes_revision_id
    ) THEN
      RAISE EXCEPTION 'event_actual_predecessor_already_superseded' USING ERRCODE = '40001';
    END IF;
  END IF;

  v_content_payload := pg_catalog.jsonb_build_object(
    'hashContractVersion', 'series-canonical-json-v1',
    'schemaVersion', 'series-event-actual-revision-v1',
    'clubId', v_event.club_id::text,
    'eventId', p_event_id::text,
    'scope', p_outcome_scope,
    'finality', p_finality,
    'sourceKind', 'owner_manual',
    'sourceTimestampState', p_source_timestamp_state,
    'sourceTimestamp', CASE WHEN p_source_timestamp IS NULL THEN NULL ELSE public._series_canonical_timestamptz_v1(p_source_timestamp) END,
    'capturedAt', public._series_canonical_timestamptz_v1(v_now),
    'reconciliationStatus', 'manual_only',
    'metrics', v_metrics,
    'supersedesRevisionId', CASE WHEN p_supersedes_revision_id IS NULL THEN NULL ELSE p_supersedes_revision_id::text END,
    'reconcilesAutoRevisionId', NULL,
    'reconcilesManualRevisionId', NULL,
    'idempotencyKey', p_idempotency_key,
    'correctionReason', v_correction_reason
  );
  v_content_hash := public._series_sha256_jsonb_v1(v_content_payload);

  INSERT INTO public.series_event_actual_revisions_v1 (
    club_id, event_id, outcome_scope, finality, source_kind,
    source_timestamp_state, source_timestamp, captured_at, captured_by,
    reconciliation_status,
    entries_availability, entries_value,
    unique_players_availability, unique_players_value,
    total_bullets_availability, total_bullets_value,
    reentries_availability, reentries_value,
    registration_records_availability, registration_records_value,
    paid_places_availability, paid_places_value,
    prize_pool_availability, prize_pool_amount_minor, prize_pool_currency, prize_pool_scale,
    overlay_availability, overlay_amount_minor, overlay_currency, overlay_scale,
    supersedes_revision_id, idempotency_key, request_hash, content_hash, correction_reason
  ) VALUES (
    v_event.club_id, p_event_id, p_outcome_scope, p_finality, 'owner_manual',
    p_source_timestamp_state, p_source_timestamp, v_now, v_actor,
    'manual_only',
    p_entries_availability, p_entries_value,
    p_unique_players_availability, p_unique_players_value,
    p_total_bullets_availability, p_total_bullets_value,
    p_reentries_availability, p_reentries_value,
    p_registration_records_availability, p_registration_records_value,
    p_paid_places_availability, p_paid_places_value,
    p_prize_pool_availability, p_prize_pool_amount_minor, v_prize_pool_currency, p_prize_pool_scale,
    p_overlay_availability, p_overlay_amount_minor, v_overlay_currency, p_overlay_scale,
    p_supersedes_revision_id, p_idempotency_key, v_request_hash, v_content_hash, v_correction_reason
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.series_record_event_actual_v1(
  uuid,text,text,text,timestamptz,text,bigint,text,bigint,text,bigint,text,bigint,
  text,bigint,text,bigint,text,numeric,text,smallint,text,numeric,text,smallint,uuid,text,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.series_record_event_actual_v1(
  uuid,text,text,text,timestamptz,text,bigint,text,bigint,text,bigint,text,bigint,
  text,bigint,text,bigint,text,numeric,text,smallint,text,numeric,text,smallint,uuid,text,text
) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Rollback (owner-controlled, only before runtime adoption and only after an explicit data audit).
-- ---------------------------------------------------------------------------------------------
-- REVOKE EXECUTE ON FUNCTION public.series_record_event_actual_v1(...) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.series_freeze_decision_packet_v1(uuid,bigint) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.series_create_decision_packet_v1(...) FROM authenticated;
-- DROP TABLE public.series_event_actual_revisions_v1;
-- DROP TABLE public.series_decision_packets_v1;
-- DROP helper functions only after confirming no dependent object remains.

COMMIT;
