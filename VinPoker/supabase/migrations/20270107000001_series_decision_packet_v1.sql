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
  IF v_text !~ E'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RETURN false;
  END IF;

  BEGIN
    v_source_cutoff := v_text::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN v_source_cutoff <= p_packet_cutoff;
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
    WHEN p_availability = 'present' THEN p_value IS NOT NULL AND p_value > 0
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
  CONSTRAINT sdp_v1_timing_chk CHECK (source_cutoff <= as_of_ts),
  CONSTRAINT sdp_v1_expectation_chk CHECK (manual_expectation IS NULL OR manual_expectation >= 0),
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
      AND source_timestamp <= captured_at)
    OR
    (source_timestamp_state = 'not_reported' AND source_timestamp IS NULL)
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

CREATE OR REPLACE FUNCTION public._series_sha256_jsonb_v1(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

REVOKE ALL ON FUNCTION public._series_sha256_jsonb_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._series_decision_packet_content_hash_v1(
  p_packet public.series_decision_packets_v1
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public._series_sha256_jsonb_v1(pg_catalog.jsonb_build_object(
    'schema_version', p_packet.schema_version,
    'club_id', p_packet.club_id,
    'event_id', p_packet.event_id,
    'decision_horizon', p_packet.decision_horizon,
    'target_metric', p_packet.target_metric,
    'as_of_ts', p_packet.as_of_ts,
    'source_cutoff', p_packet.source_cutoff,
    'target_event_ts', p_packet.target_event_ts,
    'forecast_snapshot_id', p_packet.forecast_snapshot_id,
    'forecast_state', p_packet.forecast_state,
    'manual_expectation', p_packet.manual_expectation,
    'public_evidence_manifest', p_packet.public_evidence_manifest,
    'registration_slice_manifest', p_packet.registration_slice_manifest,
    'registration_observation_count', p_packet.registration_observation_count,
    'campaign_slice_manifest', p_packet.campaign_slice_manifest,
    'campaign_observation_count', p_packet.campaign_observation_count,
    'known_information', p_packet.known_information,
    'recommended_action', p_packet.recommended_action,
    'recommendation_source_kind', p_packet.recommendation_source_kind,
    'recommendation_source_ref', p_packet.recommendation_source_ref,
    'owner_decision', p_packet.owner_decision,
    'public_action', p_packet.public_action,
    'decision_reason', p_packet.decision_reason,
    'alternatives', p_packet.alternatives,
    'assumptions', p_packet.assumptions,
    'uncertainty_notes', p_packet.uncertainty_notes,
    'supersedes_packet_id', p_packet.supersedes_packet_id,
    'correction_reason', p_packet.correction_reason
  ))
$$;

REVOKE ALL ON FUNCTION public._series_decision_packet_content_hash_v1(
  public.series_decision_packets_v1
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

  v_request_hash := public._series_sha256_jsonb_v1(pg_catalog.jsonb_build_object(
    'event_id', p_event_id,
    'decision_horizon', p_decision_horizon,
    'target_metric', p_target_metric,
    'as_of_ts', p_as_of_ts,
    'source_cutoff', p_source_cutoff,
    'target_event_ts', p_target_event_ts,
    'forecast_snapshot_id', p_forecast_snapshot_id,
    'forecast_state', p_forecast_state,
    'manual_expectation', p_manual_expectation,
    'public_evidence_manifest', p_public_evidence_manifest,
    'registration_slice_manifest', p_registration_slice_manifest,
    'registration_observation_count', p_registration_observation_count,
    'campaign_slice_manifest', p_campaign_slice_manifest,
    'campaign_observation_count', p_campaign_observation_count,
    'known_information', p_known_information,
    'recommended_action', p_recommended_action,
    'recommendation_source_kind', p_recommendation_source_kind,
    'recommendation_source_ref', p_recommendation_source_ref,
    'owner_decision', p_owner_decision,
    'public_action', p_public_action,
    'decision_reason', p_decision_reason,
    'alternatives', p_alternatives,
    'assumptions', p_assumptions,
    'uncertainty_notes', p_uncertainty_notes,
    'supersedes_packet_id', p_supersedes_packet_id,
    'correction_reason', p_correction_reason
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
  IF p_target_event_ts IS DISTINCT FROM v_event.start_time THEN
    RAISE EXCEPTION 'decision_packet_target_event_mismatch' USING ERRCODE = '22023';
  END IF;
  IF p_source_cutoff > p_as_of_ts OR p_as_of_ts > pg_catalog.now() THEN
    RAISE EXCEPTION 'decision_packet_invalid_origin_time' USING ERRCODE = '22023';
  END IF;
  IF public._series_jsonb_has_forbidden_packet_key_v1(p_public_evidence_manifest)
    OR public._series_jsonb_has_forbidden_packet_key_v1(p_registration_slice_manifest)
    OR public._series_jsonb_has_forbidden_packet_key_v1(p_campaign_slice_manifest)
    OR public._series_jsonb_has_forbidden_packet_key_v1(p_known_information)
  THEN
    RAISE EXCEPTION 'decision_packet_outcome_or_pii_leakage' USING ERRCODE = '22023';
  END IF;
  IF NOT public._series_packet_evidence_manifest_valid_v1(
      COALESCE(p_public_evidence_manifest, '[]'::jsonb),
      p_source_cutoff
    )
    OR NOT public._series_packet_slice_manifest_valid_v1(
      p_registration_slice_manifest,
      p_registration_observation_count,
      p_source_cutoff
    )
    OR NOT public._series_packet_slice_manifest_valid_v1(
      p_campaign_slice_manifest,
      p_campaign_observation_count,
      p_source_cutoff
    )
  THEN
    RAISE EXCEPTION 'decision_packet_invalid_evidence_or_slice_manifest' USING ERRCODE = '22023';
  END IF;
  IF p_recommendation_source_kind = 'research_artifact'
    AND NOT public._series_packet_research_artifact_reference_valid_v1(
      COALESCE(p_public_evidence_manifest, '[]'::jsonb),
      p_recommendation_source_ref
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
      OR v_snapshot.target_event_ts IS DISTINCT FROM p_target_event_ts
      OR v_snapshot.forecast_issued_at > p_as_of_ts
      OR v_snapshot.as_of_ts > v_snapshot.forecast_issued_at
      OR v_snapshot.forecast_issued_at > p_target_event_ts
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
    v_event.club_id, p_event_id, p_decision_horizon, p_target_metric, p_as_of_ts, p_source_cutoff,
    p_target_event_ts, p_forecast_snapshot_id, p_forecast_state, p_manual_expectation,
    COALESCE(p_public_evidence_manifest, '[]'::jsonb),
    public._series_sha256_jsonb_v1(COALESCE(p_public_evidence_manifest, '[]'::jsonb)),
    p_registration_slice_manifest,
    CASE WHEN p_registration_slice_manifest IS NULL THEN NULL
      ELSE public._series_sha256_jsonb_v1(p_registration_slice_manifest) END,
    p_registration_observation_count,
    p_campaign_slice_manifest,
    CASE WHEN p_campaign_slice_manifest IS NULL THEN NULL
      ELSE public._series_sha256_jsonb_v1(p_campaign_slice_manifest) END,
    p_campaign_observation_count,
    COALESCE(p_known_information, '{}'::jsonb),
    public._series_sha256_jsonb_v1(COALESCE(p_known_information, '{}'::jsonb)),
    p_recommended_action, p_recommendation_source_kind, p_recommendation_source_ref,
    p_owner_decision, p_public_action, p_decision_reason,
    COALESCE(p_alternatives, '[]'::jsonb), COALESCE(p_assumptions, '[]'::jsonb),
    p_uncertainty_notes, p_idempotency_key, v_request_hash, v_actor,
    p_supersedes_packet_id, p_correction_reason
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
  v_now timestamptz := pg_catalog.now();
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

  v_request_hash := public._series_sha256_jsonb_v1(pg_catalog.jsonb_build_object(
    'event_id', p_event_id,
    'outcome_scope', p_outcome_scope,
    'finality', p_finality,
    'source_timestamp_state', p_source_timestamp_state,
    'source_timestamp', p_source_timestamp,
    'entries', pg_catalog.jsonb_build_object('availability', p_entries_availability, 'value', p_entries_value),
    'unique_players', pg_catalog.jsonb_build_object('availability', p_unique_players_availability, 'value', p_unique_players_value),
    'total_bullets', pg_catalog.jsonb_build_object('availability', p_total_bullets_availability, 'value', p_total_bullets_value),
    'reentries', pg_catalog.jsonb_build_object('availability', p_reentries_availability, 'value', p_reentries_value),
    'registration_records', pg_catalog.jsonb_build_object('availability', p_registration_records_availability, 'value', p_registration_records_value),
    'paid_places', pg_catalog.jsonb_build_object('availability', p_paid_places_availability, 'value', p_paid_places_value),
    'prize_pool', pg_catalog.jsonb_build_object(
      'availability', p_prize_pool_availability, 'amount_minor', p_prize_pool_amount_minor,
      'currency', p_prize_pool_currency, 'scale', p_prize_pool_scale
    ),
    'overlay', pg_catalog.jsonb_build_object(
      'availability', p_overlay_availability, 'amount_minor', p_overlay_amount_minor,
      'currency', p_overlay_currency, 'scale', p_overlay_scale
    ),
    'supersedes_revision_id', p_supersedes_revision_id,
    'correction_reason', p_correction_reason
  ));

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

  v_content_hash := public._series_sha256_jsonb_v1(pg_catalog.jsonb_build_object(
    'schema_version', 'series-event-actual-revision-v1',
    'club_id', v_event.club_id,
    'event_id', p_event_id,
    'outcome_scope', p_outcome_scope,
    'finality', p_finality,
    'source_kind', 'owner_manual',
    'source_timestamp_state', p_source_timestamp_state,
    'source_timestamp', p_source_timestamp,
    'captured_at', v_now,
    'reconciliation_status', 'manual_only',
    'entries', pg_catalog.jsonb_build_object('availability', p_entries_availability, 'value', p_entries_value),
    'unique_players', pg_catalog.jsonb_build_object('availability', p_unique_players_availability, 'value', p_unique_players_value),
    'total_bullets', pg_catalog.jsonb_build_object('availability', p_total_bullets_availability, 'value', p_total_bullets_value),
    'reentries', pg_catalog.jsonb_build_object('availability', p_reentries_availability, 'value', p_reentries_value),
    'registration_records', pg_catalog.jsonb_build_object('availability', p_registration_records_availability, 'value', p_registration_records_value),
    'paid_places', pg_catalog.jsonb_build_object('availability', p_paid_places_availability, 'value', p_paid_places_value),
    'prize_pool', pg_catalog.jsonb_build_object(
      'availability', p_prize_pool_availability, 'amount_minor', p_prize_pool_amount_minor,
      'currency', p_prize_pool_currency, 'scale', p_prize_pool_scale
    ),
    'overlay', pg_catalog.jsonb_build_object(
      'availability', p_overlay_availability, 'amount_minor', p_overlay_amount_minor,
      'currency', p_overlay_currency, 'scale', p_overlay_scale
    ),
    'supersedes_revision_id', p_supersedes_revision_id,
    'idempotency_key', p_idempotency_key,
    'correction_reason', p_correction_reason
  ));

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
    p_prize_pool_availability, p_prize_pool_amount_minor, p_prize_pool_currency, p_prize_pool_scale,
    p_overlay_availability, p_overlay_amount_minor, p_overlay_currency, p_overlay_scale,
    p_supersedes_revision_id, p_idempotency_key, v_request_hash, v_content_hash, p_correction_reason
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
