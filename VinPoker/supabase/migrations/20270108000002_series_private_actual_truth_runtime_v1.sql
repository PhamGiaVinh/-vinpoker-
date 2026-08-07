-- Series Intelligence D2B: Private Actual Truth Runtime V1.
--
-- SOURCE ONLY. CRITICAL/RED. This migration is additive and must be applied only through the
-- owner-controlled database runbook. It never promotes the mutable series_event_actuals cache.
--
-- Native truth contract:
--   * public.tournament_registrations.status = confirmed is one paid entry/bullet;
--   * buy_in is prize contribution; platform_fixed_fee and total_pay are never prize-pool inputs;
--   * VND integer-major units are represented as { currency: VND, scale: 0 }.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1. D2B provenance: immutable, non-PII server records keyed by a D2A actual revision.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.series_event_actual_native_sources_v1 (
  revision_id                 uuid PRIMARY KEY REFERENCES public.series_event_actual_revisions_v1(id) ON DELETE RESTRICT,
  club_id                     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  event_id                    uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  outcome_scope               text NOT NULL,
  counting_contract_version   text NOT NULL,
  economics_contract_version  text NOT NULL,
  source_fingerprint          text NOT NULL,
  source_payload_hash         text NOT NULL,
  native_event_status         text NOT NULL,
  source_observed_at          timestamptz NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),

  CONSTRAINT seas_v1_scope_chk CHECK (outcome_scope = 'event_total'),
  CONSTRAINT seas_v1_counting_contract_chk CHECK (
    counting_contract_version = 'native-tournament-confirmed-registration-v1'
  ),
  CONSTRAINT seas_v1_economics_contract_chk CHECK (
    economics_contract_version = 'native-confirmed-prize-contribution-v1'
  ),
  CONSTRAINT seas_v1_hash_chk CHECK (
    source_fingerprint ~ '^[0-9a-f]{64}$'
    AND source_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT seas_v1_observed_time_chk CHECK (
    pg_catalog.date_trunc('milliseconds', source_observed_at) = source_observed_at
    AND pg_catalog.date_trunc('milliseconds', created_at) = created_at
  ),
  CONSTRAINT seas_v1_identity_fk FOREIGN KEY (revision_id, club_id, event_id, outcome_scope)
    REFERENCES public.series_event_actual_revisions_v1(id, club_id, event_id, outcome_scope)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_seas_v1_event_source
  ON public.series_event_actual_native_sources_v1(club_id, event_id, outcome_scope, source_fingerprint);

CREATE TABLE IF NOT EXISTS public.series_event_actual_reconciliations_v1 (
  revision_id                 uuid PRIMARY KEY REFERENCES public.series_event_actual_revisions_v1(id) ON DELETE RESTRICT,
  club_id                     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  event_id                    uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  outcome_scope               text NOT NULL,
  auto_revision_id            uuid NOT NULL,
  manual_revision_id          uuid NOT NULL,
  resolution                  jsonb NOT NULL,
  resolution_hash             text NOT NULL,
  owner_reason                text,
  created_at                  timestamptz NOT NULL DEFAULT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()),

  CONSTRAINT searx_v1_scope_chk CHECK (outcome_scope = 'event_total'),
  CONSTRAINT searx_v1_distinct_sources_chk CHECK (auto_revision_id <> manual_revision_id),
  CONSTRAINT searx_v1_hash_chk CHECK (resolution_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT searx_v1_resolution_shape_chk CHECK (pg_catalog.jsonb_typeof(resolution) = 'object'),
  CONSTRAINT searx_v1_identity_fk FOREIGN KEY (revision_id, club_id, event_id, outcome_scope)
    REFERENCES public.series_event_actual_revisions_v1(id, club_id, event_id, outcome_scope)
    ON DELETE RESTRICT,
  CONSTRAINT searx_v1_auto_fk FOREIGN KEY (auto_revision_id, club_id, event_id, outcome_scope)
    REFERENCES public.series_event_actual_revisions_v1(id, club_id, event_id, outcome_scope)
    ON DELETE RESTRICT,
  CONSTRAINT searx_v1_manual_fk FOREIGN KEY (manual_revision_id, club_id, event_id, outcome_scope)
    REFERENCES public.series_event_actual_revisions_v1(id, club_id, event_id, outcome_scope)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_searx_v1_event
  ON public.series_event_actual_reconciliations_v1(club_id, event_id, outcome_scope, created_at DESC);

ALTER TABLE public.series_event_actual_native_sources_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_event_actual_reconciliations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.series_event_actual_native_sources_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.series_event_actual_reconciliations_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._series_d2b_reject_metadata_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'series_actual_runtime_metadata_append_only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS seas_v1_append_only ON public.series_event_actual_native_sources_v1;
CREATE TRIGGER seas_v1_append_only
  BEFORE UPDATE OR DELETE ON public.series_event_actual_native_sources_v1
  FOR EACH ROW EXECUTE FUNCTION public._series_d2b_reject_metadata_mutation_v1();

DROP TRIGGER IF EXISTS searx_v1_append_only ON public.series_event_actual_reconciliations_v1;
CREATE TRIGGER searx_v1_append_only
  BEFORE UPDATE OR DELETE ON public.series_event_actual_reconciliations_v1
  FOR EACH ROW EXECUTE FUNCTION public._series_d2b_reject_metadata_mutation_v1();

-- ---------------------------------------------------------------------------------------------
-- 2. Small validation and projection helpers. None exposes a row to clients.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._series_d2b_exact_keys_v1(p_value jsonb, p_keys text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_value) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys(p_value) AS key)
      = (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.unnest(p_keys) AS key)
$$;

CREATE OR REPLACE FUNCTION public._series_d2b_actual_metrics_json_v1(
  p_actual public.series_event_actual_revisions_v1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
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
  )
$$;

CREATE OR REPLACE FUNCTION public._series_d2b_safe_actual_json_v1(
  p_actual public.series_event_actual_revisions_v1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'revisionId', p_actual.id::text,
    'scope', p_actual.outcome_scope,
    'finality', p_actual.finality,
    'sourceKind', p_actual.source_kind,
    'sourceTimestampState', p_actual.source_timestamp_state,
    'sourceTimestamp', CASE WHEN p_actual.source_timestamp IS NULL THEN NULL ELSE public._series_canonical_timestamptz_v1(p_actual.source_timestamp) END,
    'capturedAt', public._series_canonical_timestamptz_v1(p_actual.captured_at),
    'reconciliationStatus', p_actual.reconciliation_status,
    'metrics', public._series_d2b_actual_metrics_json_v1(p_actual),
    'supersedesRevisionId', CASE WHEN p_actual.supersedes_revision_id IS NULL THEN NULL ELSE p_actual.supersedes_revision_id::text END,
    'reconcilesAutoRevisionId', CASE WHEN p_actual.reconciles_auto_revision_id IS NULL THEN NULL ELSE p_actual.reconciles_auto_revision_id::text END,
    'reconcilesManualRevisionId', CASE WHEN p_actual.reconciles_manual_revision_id IS NULL THEN NULL ELSE p_actual.reconciles_manual_revision_id::text END,
    'contentHash', p_actual.content_hash,
    'correctionReason', p_actual.correction_reason
  )
$$;

CREATE OR REPLACE FUNCTION public._series_d2b_count_resolution_valid_v1(
  p_field jsonb,
  p_auto_availability text,
  p_auto_value bigint,
  p_manual_availability text,
  p_manual_value bigint
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source text;
  v_availability text;
  v_value bigint;
BEGIN
  IF NOT public._series_d2b_exact_keys_v1(p_field, ARRAY['availability','resolutionSource','value'])
    OR pg_catalog.jsonb_typeof(p_field -> 'resolutionSource') <> 'string'
    OR pg_catalog.jsonb_typeof(p_field -> 'availability') <> 'string'
  THEN RETURN false; END IF;
  v_source := p_field ->> 'resolutionSource';
  v_availability := p_field ->> 'availability';
  IF v_availability IN ('present','explicit_zero') THEN
    IF pg_catalog.jsonb_typeof(p_field -> 'value') <> 'number'
      OR (p_field ->> 'value') !~ '^(0|[1-9][0-9]*)$'
      OR pg_catalog.char_length(p_field ->> 'value') > 16
    THEN RETURN false; END IF;
    v_value := (p_field ->> 'value')::bigint;
  ELSIF p_field -> 'value' <> 'null'::jsonb THEN
    RETURN false;
  END IF;
  IF NOT public._series_count_metric_valid_v1(v_availability, v_value) THEN RETURN false; END IF;
  IF v_source = 'chose_auto' THEN RETURN v_availability = p_auto_availability AND v_value IS NOT DISTINCT FROM p_auto_value; END IF;
  IF v_source = 'chose_manual' THEN RETURN v_availability = p_manual_availability AND v_value IS NOT DISTINCT FROM p_manual_value; END IF;
  IF v_source = 'owner_override' THEN RETURN true; END IF;
  IF v_source = 'unavailable' THEN RETURN v_availability IN ('missing','uncertain','conflicting','not_applicable'); END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_d2b_money_resolution_valid_v1(
  p_field jsonb,
  p_auto_availability text, p_auto_amount numeric, p_auto_currency text, p_auto_scale smallint,
  p_manual_availability text, p_manual_amount numeric, p_manual_currency text, p_manual_scale smallint
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source text;
  v_availability text;
  v_amount numeric;
  v_currency text;
  v_scale smallint;
BEGIN
  IF NOT public._series_d2b_exact_keys_v1(p_field, ARRAY['amountMinor','availability','currency','resolutionSource','scale'])
    OR pg_catalog.jsonb_typeof(p_field -> 'resolutionSource') <> 'string'
    OR pg_catalog.jsonb_typeof(p_field -> 'availability') <> 'string'
  THEN RETURN false; END IF;
  v_source := p_field ->> 'resolutionSource';
  v_availability := p_field ->> 'availability';
  IF v_availability IN ('present','explicit_zero') THEN
    IF pg_catalog.jsonb_typeof(p_field -> 'amountMinor') <> 'string'
      OR (p_field ->> 'amountMinor') !~ '^(0|[1-9][0-9]*)$'
      OR pg_catalog.char_length(p_field ->> 'amountMinor') > 30
      OR pg_catalog.jsonb_typeof(p_field -> 'currency') <> 'string'
      OR pg_catalog.jsonb_typeof(p_field -> 'scale') <> 'number'
      OR (p_field ->> 'scale') !~ '^[0-6]$'
    THEN RETURN false; END IF;
    v_amount := (p_field ->> 'amountMinor')::numeric;
    v_currency := pg_catalog.upper(p_field ->> 'currency');
    v_scale := (p_field ->> 'scale')::smallint;
  ELSIF p_field -> 'amountMinor' <> 'null'::jsonb
     OR p_field -> 'currency' <> 'null'::jsonb
     OR p_field -> 'scale' <> 'null'::jsonb THEN
    RETURN false;
  END IF;
  IF NOT public._series_money_metric_valid_v1(v_availability, v_amount, v_currency, v_scale) THEN RETURN false; END IF;
  IF v_source = 'chose_auto' THEN
    RETURN v_availability = p_auto_availability AND v_amount IS NOT DISTINCT FROM p_auto_amount
      AND v_currency IS NOT DISTINCT FROM p_auto_currency AND v_scale IS NOT DISTINCT FROM p_auto_scale;
  END IF;
  IF v_source = 'chose_manual' THEN
    RETURN v_availability = p_manual_availability AND v_amount IS NOT DISTINCT FROM p_manual_amount
      AND v_currency IS NOT DISTINCT FROM p_manual_currency AND v_scale IS NOT DISTINCT FROM p_manual_scale;
  END IF;
  IF v_source = 'owner_override' THEN RETURN true; END IF;
  IF v_source = 'unavailable' THEN RETURN v_availability IN ('missing','uncertain','conflicting','not_applicable'); END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public._series_d2b_resolution_fields_valid_v1(
  p_resolution jsonb,
  p_auto public.series_event_actual_revisions_v1,
  p_manual public.series_event_actual_revisions_v1
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public._series_d2b_exact_keys_v1(p_resolution, ARRAY['fields','mode'])
    AND p_resolution ->> 'mode' = 'manual'
    AND public._series_d2b_exact_keys_v1(
      p_resolution -> 'fields',
      ARRAY['entries','overlay','paidPlaces','prizePool','reentries','registrationRecords','totalBullets','uniquePlayers']
    )
    AND public._series_d2b_count_resolution_valid_v1(p_resolution -> 'fields' -> 'entries', p_auto.entries_availability, p_auto.entries_value, p_manual.entries_availability, p_manual.entries_value)
    AND public._series_d2b_count_resolution_valid_v1(p_resolution -> 'fields' -> 'uniquePlayers', p_auto.unique_players_availability, p_auto.unique_players_value, p_manual.unique_players_availability, p_manual.unique_players_value)
    AND public._series_d2b_count_resolution_valid_v1(p_resolution -> 'fields' -> 'totalBullets', p_auto.total_bullets_availability, p_auto.total_bullets_value, p_manual.total_bullets_availability, p_manual.total_bullets_value)
    AND public._series_d2b_count_resolution_valid_v1(p_resolution -> 'fields' -> 'reentries', p_auto.reentries_availability, p_auto.reentries_value, p_manual.reentries_availability, p_manual.reentries_value)
    AND public._series_d2b_count_resolution_valid_v1(p_resolution -> 'fields' -> 'registrationRecords', p_auto.registration_records_availability, p_auto.registration_records_value, p_manual.registration_records_availability, p_manual.registration_records_value)
    AND public._series_d2b_count_resolution_valid_v1(p_resolution -> 'fields' -> 'paidPlaces', p_auto.paid_places_availability, p_auto.paid_places_value, p_manual.paid_places_availability, p_manual.paid_places_value)
    AND public._series_d2b_money_resolution_valid_v1(p_resolution -> 'fields' -> 'prizePool', p_auto.prize_pool_availability, p_auto.prize_pool_amount_minor, p_auto.prize_pool_currency, p_auto.prize_pool_scale, p_manual.prize_pool_availability, p_manual.prize_pool_amount_minor, p_manual.prize_pool_currency, p_manual.prize_pool_scale)
    AND public._series_d2b_money_resolution_valid_v1(p_resolution -> 'fields' -> 'overlay', p_auto.overlay_availability, p_auto.overlay_amount_minor, p_auto.overlay_currency, p_auto.overlay_scale, p_manual.overlay_availability, p_manual.overlay_amount_minor, p_manual.overlay_currency, p_manual.overlay_scale)
$$;

CREATE OR REPLACE FUNCTION public._series_d2b_actual_truth_state_v1(
  p_event_id uuid,
  p_scope text DEFAULT 'event_total'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_auto public.series_event_actual_revisions_v1%ROWTYPE;
  v_manual public.series_event_actual_revisions_v1%ROWTYPE;
  v_reconciled public.series_event_actual_revisions_v1%ROWTYPE;
  v_auto_count integer;
  v_manual_count integer;
  v_reconciled_count integer;
BEGIN
  SELECT count(*) INTO v_auto_count
  FROM public.series_event_actual_revisions_v1 a
  WHERE a.event_id = p_event_id AND a.outcome_scope = p_scope
    AND a.source_kind IN ('native_tournament_system','auto_capture') AND a.finality <> 'void'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = a.id);
  SELECT count(*) INTO v_manual_count
  FROM public.series_event_actual_revisions_v1 a
  WHERE a.event_id = p_event_id AND a.outcome_scope = p_scope
    AND a.source_kind IN ('owner_manual','legacy_decision_log','import_verified') AND a.finality <> 'void'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = a.id);
  SELECT count(*) INTO v_reconciled_count
  FROM public.series_event_actual_revisions_v1 a
  WHERE a.event_id = p_event_id AND a.outcome_scope = p_scope
    AND a.source_kind = 'reconciled' AND a.finality <> 'void'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = a.id);
  IF v_auto_count > 1 OR v_manual_count > 1 OR v_reconciled_count > 1 THEN
    RETURN pg_catalog.jsonb_build_object('state','conflict','reason','divergent_lineage');
  END IF;
  SELECT * INTO v_auto FROM public.series_event_actual_revisions_v1 a
  WHERE a.event_id = p_event_id AND a.outcome_scope = p_scope
    AND a.source_kind IN ('native_tournament_system','auto_capture') AND a.finality <> 'void'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = a.id);
  SELECT * INTO v_manual FROM public.series_event_actual_revisions_v1 a
  WHERE a.event_id = p_event_id AND a.outcome_scope = p_scope
    AND a.source_kind IN ('owner_manual','legacy_decision_log','import_verified') AND a.finality <> 'void'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = a.id);
  SELECT * INTO v_reconciled FROM public.series_event_actual_revisions_v1 a
  WHERE a.event_id = p_event_id AND a.outcome_scope = p_scope
    AND a.source_kind = 'reconciled' AND a.finality <> 'void'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = a.id);
  IF FOUND THEN
    IF v_reconciled.finality = 'conflicting' OR v_reconciled.reconciliation_status = 'blocked_conflict' THEN
      RETURN pg_catalog.jsonb_build_object('state','conflict','reason','conflicting_revision','reconciledHead',public._series_d2b_safe_actual_json_v1(v_reconciled));
    END IF;
    IF v_auto.id IS DISTINCT FROM v_reconciled.reconciles_auto_revision_id
      OR v_manual.id IS DISTINCT FROM v_reconciled.reconciles_manual_revision_id THEN
      RETURN pg_catalog.jsonb_build_object('state','conflict','reason','stale_reconciliation','reconciledHead',public._series_d2b_safe_actual_json_v1(v_reconciled));
    END IF;
    RETURN pg_catalog.jsonb_build_object('state','current','sourceState','reconciled','chosenRevision',public._series_d2b_safe_actual_json_v1(v_reconciled));
  END IF;
  IF v_auto.id IS NOT NULL AND v_manual.id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('state','needs_reconciliation','autoHead',public._series_d2b_safe_actual_json_v1(v_auto),'manualHead',public._series_d2b_safe_actual_json_v1(v_manual));
  END IF;
  IF v_auto.id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('state','current','sourceState','auto_only','chosenRevision',public._series_d2b_safe_actual_json_v1(v_auto));
  END IF;
  IF v_manual.id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('state','current','sourceState','manual_only','chosenRevision',public._series_d2b_safe_actual_json_v1(v_manual));
  END IF;
  RETURN pg_catalog.jsonb_build_object('state','unavailable','reason','no_revision');
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Server-authoritative native promotion. Directly reads native registrations, never the cache.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.series_promote_native_event_actual_v1(
  p_event_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.tournaments%ROWTYPE;
  v_predecessor public.series_event_actual_revisions_v1%ROWTYPE;
  v_existing public.series_event_actual_revisions_v1%ROWTYPE;
  v_result public.series_event_actual_revisions_v1%ROWTYPE;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_source_ts timestamptz;
  v_finality text;
  v_entries bigint;
  v_unique_players bigint;
  v_prize_pool numeric(30,0);
  v_guarantee numeric(30,0);
  v_overlay_availability text := 'missing';
  v_overlay_amount numeric(30,0);
  v_source_payload jsonb;
  v_source_fingerprint text;
  v_request_hash text;
  v_content_hash text;
  v_content_payload jsonb;
BEGIN
  IF v_actor IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'native_actual_unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$' THEN
    RAISE EXCEPTION 'native_actual_invalid_idempotency_key' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_event FROM public.tournaments
  WHERE id = p_event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR NOT public.is_club_owner(v_actor, v_event.club_id) THEN RAISE EXCEPTION 'native_actual_forbidden' USING ERRCODE = '42501'; END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'native_actual_cancelled_event' USING ERRCODE = '55000'; END IF;
  IF v_event.status NOT IN ('upcoming','registering','drawing','live','break','final_table','active','completed') THEN
    RAISE EXCEPTION 'native_actual_unknown_event_status' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('series-native-actual:' || p_event_id::text, 0));

  SELECT count(*)::bigint, count(DISTINCT tr.player_id)::bigint, COALESCE(sum(tr.buy_in), 0)::numeric(30,0),
         max(tr.updated_at)
    INTO v_entries, v_unique_players, v_prize_pool, v_source_ts
  FROM public.tournament_registrations tr
  WHERE tr.tournament_id = p_event_id AND tr.status = 'confirmed';
  IF v_entries > 9007199254740991 OR v_unique_players > 9007199254740991 OR v_prize_pool < 0 OR v_prize_pool <> trunc(v_prize_pool) THEN
    RAISE EXCEPTION 'native_actual_source_count_or_money_invalid' USING ERRCODE = '22023';
  END IF;
  v_source_ts := pg_catalog.date_trunc('milliseconds', GREATEST(v_source_ts, v_event.updated_at));
  IF v_source_ts IS NULL THEN RAISE EXCEPTION 'native_actual_source_timestamp_unavailable' USING ERRCODE = '55000'; END IF;
  IF v_event.status = 'completed' THEN v_finality := 'final'; ELSE v_finality := 'provisional'; END IF;
  IF v_event.guarantee_amount IS NOT NULL AND v_event.guarantee_amount >= 0
     AND v_event.guarantee_amount = trunc(v_event.guarantee_amount)
     AND v_event.guarantee_amount <= 999999999999999999999999999999 THEN
    v_guarantee := v_event.guarantee_amount::numeric(30,0);
    v_overlay_amount := GREATEST(v_guarantee - v_prize_pool, 0)::numeric(30,0);
    v_overlay_availability := CASE WHEN v_overlay_amount = 0 THEN 'explicit_zero' ELSE 'present' END;
  END IF;
  SELECT pg_catalog.jsonb_build_object(
    'eventId', v_event.id::text, 'clubId', v_event.club_id::text, 'eventStatus', v_event.status,
    'eventUpdatedAt', public._series_canonical_timestamptz_v1(v_event.updated_at),
    'guaranteeAmount', CASE WHEN v_event.guarantee_amount IS NULL THEN NULL ELSE v_event.guarantee_amount::text END,
    'confirmedRegistrations', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'registrationId', tr.id::text, 'playerId', tr.player_id::text, 'buyIn', tr.buy_in,
        'updatedAt', public._series_canonical_timestamptz_v1(tr.updated_at), 'sourceEntryId', CASE WHEN tr.source_entry_id IS NULL THEN NULL ELSE tr.source_entry_id::text END
      ) ORDER BY tr.id)
      FROM public.tournament_registrations tr
      WHERE tr.tournament_id = p_event_id AND tr.status = 'confirmed'
    ), '[]'::jsonb)
  ) INTO v_source_payload;
  v_source_fingerprint := public._series_sha256_jsonb_v1(v_source_payload);

  SELECT a.* INTO v_predecessor
  FROM public.series_event_actual_revisions_v1 a
  WHERE a.club_id = v_event.club_id AND a.event_id = p_event_id AND a.outcome_scope = 'event_total'
    AND a.source_kind = 'native_tournament_system' AND a.finality <> 'void'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = a.id)
  FOR UPDATE;
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.series_event_actual_native_sources_v1 s
    WHERE s.revision_id = v_predecessor.id AND s.source_fingerprint = v_source_fingerprint
  ) THEN
    RETURN pg_catalog.jsonb_build_object('version','series-decision-event-state-v1','state','idempotent','revision',public._series_d2b_safe_actual_json_v1(v_predecessor));
  END IF;
  IF v_predecessor.id IS NOT NULL THEN v_finality := CASE WHEN v_event.status = 'completed' THEN 'corrected' ELSE 'provisional' END; END IF;
  v_request_hash := public._series_sha256_jsonb_v1(pg_catalog.jsonb_build_object(
    'hashContractVersion','series-canonical-json-v1','requestKind','nativeEventActualPromotion',
    'eventId',p_event_id::text,'sourceFingerprint',v_source_fingerprint,'countingContractVersion','native-tournament-confirmed-registration-v1'
  ));
  v_content_payload := pg_catalog.jsonb_build_object(
    'hashContractVersion','series-canonical-json-v1','schemaVersion','series-event-actual-revision-v1',
    'clubId',v_event.club_id::text,'eventId',p_event_id::text,'scope','event_total','finality',v_finality,
    'sourceKind','native_tournament_system','sourceTimestampState','exact','sourceTimestamp',public._series_canonical_timestamptz_v1(v_source_ts),
    'capturedAt',public._series_canonical_timestamptz_v1(v_now),'reconciliationStatus','auto_only',
    'metrics',pg_catalog.jsonb_build_object(
      'entries',pg_catalog.jsonb_build_object('availability',CASE WHEN v_entries = 0 THEN 'explicit_zero' ELSE 'present' END,'value',v_entries),
      'uniquePlayers',pg_catalog.jsonb_build_object('availability',CASE WHEN v_unique_players = 0 THEN 'explicit_zero' ELSE 'present' END,'value',v_unique_players),
      'totalBullets',pg_catalog.jsonb_build_object('availability',CASE WHEN v_entries = 0 THEN 'explicit_zero' ELSE 'present' END,'value',v_entries),
      'reentries',pg_catalog.jsonb_build_object('availability',CASE WHEN v_entries - v_unique_players = 0 THEN 'explicit_zero' ELSE 'present' END,'value',v_entries - v_unique_players),
      'registrationRecords',pg_catalog.jsonb_build_object('availability',CASE WHEN v_entries = 0 THEN 'explicit_zero' ELSE 'present' END,'value',v_entries),
      'paidPlaces',pg_catalog.jsonb_build_object('availability','missing','value',NULL),
      'prizePool',pg_catalog.jsonb_build_object('availability',CASE WHEN v_prize_pool = 0 THEN 'explicit_zero' ELSE 'present' END,'amountMinor',v_prize_pool::text,'currency','VND','scale',0),
      'overlay',pg_catalog.jsonb_build_object('availability',v_overlay_availability,'amountMinor',CASE WHEN v_overlay_amount IS NULL THEN NULL ELSE v_overlay_amount::text END,'currency',CASE WHEN v_overlay_amount IS NULL THEN NULL ELSE 'VND' END,'scale',CASE WHEN v_overlay_amount IS NULL THEN NULL ELSE 0 END)
    ),
    'supersedesRevisionId',CASE WHEN v_predecessor.id IS NULL THEN NULL ELSE v_predecessor.id::text END,
    'reconcilesAutoRevisionId',NULL,'reconcilesManualRevisionId',NULL,'idempotencyKey',p_idempotency_key,
    'correctionReason',CASE WHEN v_predecessor.id IS NULL THEN NULL ELSE 'native_source_recomputed' END
  );
  v_content_hash := public._series_sha256_jsonb_v1(v_content_payload);
  SELECT * INTO v_existing FROM public.series_event_actual_revisions_v1
  WHERE club_id = v_event.club_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN RAISE EXCEPTION 'native_actual_idempotency_conflict' USING ERRCODE = '22023'; END IF;
    RETURN pg_catalog.jsonb_build_object('version','series-decision-event-state-v1','state','idempotent','revision',public._series_d2b_safe_actual_json_v1(v_existing));
  END IF;
  INSERT INTO public.series_event_actual_revisions_v1 (
    club_id,event_id,outcome_scope,finality,source_kind,source_timestamp_state,source_timestamp,captured_at,captured_by,reconciliation_status,
    entries_availability,entries_value,unique_players_availability,unique_players_value,total_bullets_availability,total_bullets_value,reentries_availability,reentries_value,
    registration_records_availability,registration_records_value,paid_places_availability,paid_places_value,
    prize_pool_availability,prize_pool_amount_minor,prize_pool_currency,prize_pool_scale,overlay_availability,overlay_amount_minor,overlay_currency,overlay_scale,
    supersedes_revision_id,idempotency_key,request_hash,content_hash,correction_reason
  ) VALUES (
    v_event.club_id,p_event_id,'event_total',v_finality,'native_tournament_system','exact',v_source_ts,v_now,v_actor,'auto_only',
    CASE WHEN v_entries=0 THEN 'explicit_zero' ELSE 'present' END,v_entries,CASE WHEN v_unique_players=0 THEN 'explicit_zero' ELSE 'present' END,v_unique_players,
    CASE WHEN v_entries=0 THEN 'explicit_zero' ELSE 'present' END,v_entries,CASE WHEN v_entries-v_unique_players=0 THEN 'explicit_zero' ELSE 'present' END,v_entries-v_unique_players,
    CASE WHEN v_entries=0 THEN 'explicit_zero' ELSE 'present' END,v_entries,'missing',NULL,
    CASE WHEN v_prize_pool=0 THEN 'explicit_zero' ELSE 'present' END,v_prize_pool,'VND',0,v_overlay_availability,v_overlay_amount,CASE WHEN v_overlay_amount IS NULL THEN NULL ELSE 'VND' END,CASE WHEN v_overlay_amount IS NULL THEN NULL ELSE 0 END,
    v_predecessor.id,p_idempotency_key,v_request_hash,v_content_hash,CASE WHEN v_predecessor.id IS NULL THEN NULL ELSE 'native_source_recomputed' END
  ) RETURNING * INTO v_result;
  INSERT INTO public.series_event_actual_native_sources_v1(revision_id,club_id,event_id,outcome_scope,counting_contract_version,economics_contract_version,source_fingerprint,source_payload_hash,native_event_status,source_observed_at)
  VALUES (v_result.id,v_event.club_id,p_event_id,'event_total','native-tournament-confirmed-registration-v1','native-confirmed-prize-contribution-v1',v_source_fingerprint,public._series_sha256_jsonb_v1(v_source_payload),v_event.status,v_source_ts);
  RETURN pg_catalog.jsonb_build_object('version','series-decision-event-state-v1','state','created','revision',public._series_d2b_safe_actual_json_v1(v_result));
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Explicit reconciliation. A conflict creates a non-scoring reconciled record; it never guesses.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.series_reconcile_event_actual_v1(
  p_auto_revision_id uuid,
  p_manual_revision_id uuid,
  p_resolution jsonb,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_auto public.series_event_actual_revisions_v1%ROWTYPE;
  v_manual public.series_event_actual_revisions_v1%ROWTYPE;
  v_previous public.series_event_actual_revisions_v1%ROWTYPE;
  v_existing public.series_event_actual_revisions_v1%ROWTYPE;
  v_result public.series_event_actual_revisions_v1%ROWTYPE;
  v_event public.tournaments%ROWTYPE;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_mode text;
  v_reason text;
  v_resolution_hash text;
  v_request_hash text;
  v_finality text;
  v_source_time_state text;
  v_source_time timestamptz;
  v_metrics jsonb;
  v_content jsonb;
  v_status text;
BEGIN
  IF v_actor IS NULL OR p_auto_revision_id IS NULL OR p_manual_revision_id IS NULL THEN RAISE EXCEPTION 'actual_reconciliation_unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_auto_revision_id = p_manual_revision_id OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$' THEN RAISE EXCEPTION 'actual_reconciliation_invalid_argument' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_auto FROM public.series_event_actual_revisions_v1 WHERE id = p_auto_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'actual_reconciliation_auto_source_missing' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_manual FROM public.series_event_actual_revisions_v1 WHERE id = p_manual_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'actual_reconciliation_manual_source_missing' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_event FROM public.tournaments WHERE id = v_auto.event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR NOT public.is_club_owner(v_actor,v_auto.club_id) THEN RAISE EXCEPTION 'actual_reconciliation_forbidden' USING ERRCODE = '42501'; END IF;
  IF v_auto.source_kind NOT IN ('native_tournament_system','auto_capture') OR v_manual.source_kind NOT IN ('owner_manual','legacy_decision_log','import_verified')
    OR v_auto.club_id <> v_manual.club_id OR v_auto.event_id <> v_manual.event_id OR v_auto.outcome_scope <> v_manual.outcome_scope
    OR v_auto.outcome_scope <> 'event_total' OR v_auto.finality IN ('void','conflicting') OR v_manual.finality IN ('void','conflicting') THEN
    RAISE EXCEPTION 'actual_reconciliation_incompatible_sources' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('series-actual-reconcile:' || v_auto.event_id::text || ':' || v_auto.outcome_scope, 0));
  IF EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = v_auto.id)
     OR EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id = v_manual.id) THEN
    RAISE EXCEPTION 'actual_reconciliation_stale_source' USING ERRCODE = '40001';
  END IF;
  v_mode := p_resolution ->> 'mode';
  v_reason := NULLIF(pg_catalog.btrim(COALESCE(p_reason,'')), '');
  IF v_mode = 'matching' THEN
    IF NOT public._series_d2b_exact_keys_v1(p_resolution, ARRAY['mode'])
      OR public._series_d2b_actual_metrics_json_v1(v_auto) <> public._series_d2b_actual_metrics_json_v1(v_manual) THEN
      RAISE EXCEPTION 'actual_reconciliation_not_matching' USING ERRCODE = '22023';
    END IF;
    v_metrics := public._series_d2b_actual_metrics_json_v1(v_auto);
    v_status := 'matching';
  ELSIF v_mode = 'manual' THEN
    IF v_reason IS NULL OR NOT public._series_d2b_resolution_fields_valid_v1(p_resolution,v_auto,v_manual) THEN
      RAISE EXCEPTION 'actual_reconciliation_manual_resolution_invalid' USING ERRCODE = '22023';
    END IF;
    -- Resolution source is reconciliation metadata, never part of D2A actual content identity.
    v_metrics := pg_catalog.jsonb_build_object(
      'entries', (p_resolution -> 'fields' -> 'entries') - 'resolutionSource',
      'uniquePlayers', (p_resolution -> 'fields' -> 'uniquePlayers') - 'resolutionSource',
      'totalBullets', (p_resolution -> 'fields' -> 'totalBullets') - 'resolutionSource',
      'reentries', (p_resolution -> 'fields' -> 'reentries') - 'resolutionSource',
      'registrationRecords', (p_resolution -> 'fields' -> 'registrationRecords') - 'resolutionSource',
      'paidPlaces', (p_resolution -> 'fields' -> 'paidPlaces') - 'resolutionSource',
      'prizePool', (p_resolution -> 'fields' -> 'prizePool') - 'resolutionSource',
      'overlay', (p_resolution -> 'fields' -> 'overlay') - 'resolutionSource'
    );
    v_status := 'manually_reconciled';
  ELSIF v_mode = 'blocked_conflict' THEN
    IF v_reason IS NULL OR NOT public._series_d2b_exact_keys_v1(p_resolution, ARRAY['blockReasons','mode'])
      OR pg_catalog.jsonb_typeof(p_resolution -> 'blockReasons') <> 'array'
      OR pg_catalog.jsonb_array_length(p_resolution -> 'blockReasons') = 0
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_resolution -> 'blockReasons') AS x(value) WHERE pg_catalog.jsonb_typeof(x.value) <> 'string' OR pg_catalog.btrim(x.value #>> '{}') = '') THEN
      RAISE EXCEPTION 'actual_reconciliation_blocked_conflict_invalid' USING ERRCODE = '22023';
    END IF;
    v_metrics := pg_catalog.jsonb_build_object(
      'entries',jsonb_build_object('availability','conflicting','value',NULL),'uniquePlayers',jsonb_build_object('availability','conflicting','value',NULL),
      'totalBullets',jsonb_build_object('availability','conflicting','value',NULL),'reentries',jsonb_build_object('availability','conflicting','value',NULL),
      'registrationRecords',jsonb_build_object('availability','conflicting','value',NULL),'paidPlaces',jsonb_build_object('availability','conflicting','value',NULL),
      'prizePool',jsonb_build_object('availability','conflicting','amountMinor',NULL,'currency',NULL,'scale',NULL),'overlay',jsonb_build_object('availability','conflicting','amountMinor',NULL,'currency',NULL,'scale',NULL)
    );
    v_status := 'blocked_conflict';
  ELSE RAISE EXCEPTION 'actual_reconciliation_mode_invalid' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_previous FROM public.series_event_actual_revisions_v1 a
  WHERE a.event_id=v_auto.event_id AND a.club_id=v_auto.club_id AND a.outcome_scope='event_total' AND a.source_kind='reconciled'
    AND NOT EXISTS (SELECT 1 FROM public.series_event_actual_revisions_v1 c WHERE c.supersedes_revision_id=a.id)
  FOR UPDATE;
  v_resolution_hash := public._series_sha256_jsonb_v1(p_resolution);
  IF FOUND AND v_previous.reconciles_auto_revision_id=v_auto.id AND v_previous.reconciles_manual_revision_id=v_manual.id
    AND EXISTS(SELECT 1 FROM public.series_event_actual_reconciliations_v1 r WHERE r.revision_id=v_previous.id AND r.resolution_hash=v_resolution_hash) THEN
    RETURN jsonb_build_object('version','series-decision-event-state-v1','state','idempotent','revision',public._series_d2b_safe_actual_json_v1(v_previous));
  END IF;
  IF v_auto.source_timestamp_state='exact' AND v_manual.source_timestamp_state='exact' THEN v_source_time_state := 'exact'; v_source_time := GREATEST(v_auto.source_timestamp,v_manual.source_timestamp); ELSE v_source_time_state := 'not_reported'; v_source_time := NULL; END IF;
  IF v_status='blocked_conflict' THEN v_finality := 'conflicting'; ELSIF v_previous.id IS NOT NULL THEN v_finality := 'corrected'; ELSIF v_auto.finality IN ('final','corrected') AND v_manual.finality IN ('final','corrected') THEN v_finality := 'final'; ELSE v_finality := 'provisional'; END IF;
  v_request_hash := public._series_sha256_jsonb_v1(jsonb_build_object('hashContractVersion','series-canonical-json-v1','requestKind','eventActualReconciliation','autoRevisionId',v_auto.id::text,'manualRevisionId',v_manual.id::text,'resolutionHash',v_resolution_hash,'reason',v_reason));
  SELECT * INTO v_existing FROM public.series_event_actual_revisions_v1 WHERE club_id=v_auto.club_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN IF v_existing.request_hash<>v_request_hash THEN RAISE EXCEPTION 'actual_reconciliation_idempotency_conflict' USING ERRCODE='22023'; END IF; RETURN jsonb_build_object('version','series-decision-event-state-v1','state','idempotent','revision',public._series_d2b_safe_actual_json_v1(v_existing)); END IF;
  v_content := jsonb_build_object(
    'hashContractVersion','series-canonical-json-v1','schemaVersion','series-event-actual-revision-v1','clubId',v_auto.club_id::text,'eventId',v_auto.event_id::text,'scope','event_total','finality',v_finality,
    'sourceKind','reconciled','sourceTimestampState',v_source_time_state,'sourceTimestamp',CASE WHEN v_source_time IS NULL THEN NULL ELSE public._series_canonical_timestamptz_v1(v_source_time) END,
    'capturedAt',public._series_canonical_timestamptz_v1(v_now),'reconciliationStatus',v_status,'metrics',v_metrics,
    'supersedesRevisionId',CASE WHEN v_previous.id IS NULL THEN NULL ELSE v_previous.id::text END,'reconcilesAutoRevisionId',v_auto.id::text,'reconcilesManualRevisionId',v_manual.id::text,'idempotencyKey',p_idempotency_key,'correctionReason',CASE WHEN v_previous.id IS NULL THEN NULL ELSE v_reason END
  );
  INSERT INTO public.series_event_actual_revisions_v1 (
    club_id,event_id,outcome_scope,finality,source_kind,source_timestamp_state,source_timestamp,captured_at,captured_by,reconciliation_status,
    entries_availability,entries_value,unique_players_availability,unique_players_value,total_bullets_availability,total_bullets_value,reentries_availability,reentries_value,registration_records_availability,registration_records_value,paid_places_availability,paid_places_value,
    prize_pool_availability,prize_pool_amount_minor,prize_pool_currency,prize_pool_scale,overlay_availability,overlay_amount_minor,overlay_currency,overlay_scale,
    supersedes_revision_id,reconciles_auto_revision_id,reconciles_manual_revision_id,idempotency_key,request_hash,content_hash,correction_reason
  ) VALUES (
    v_auto.club_id,v_auto.event_id,'event_total',v_finality,'reconciled',v_source_time_state,v_source_time,v_now,v_actor,v_status,
    v_metrics->'entries'->>'availability',CASE WHEN v_metrics->'entries'->>'value' IS NULL THEN NULL ELSE (v_metrics->'entries'->>'value')::bigint END,
    v_metrics->'uniquePlayers'->>'availability',CASE WHEN v_metrics->'uniquePlayers'->>'value' IS NULL THEN NULL ELSE (v_metrics->'uniquePlayers'->>'value')::bigint END,
    v_metrics->'totalBullets'->>'availability',CASE WHEN v_metrics->'totalBullets'->>'value' IS NULL THEN NULL ELSE (v_metrics->'totalBullets'->>'value')::bigint END,
    v_metrics->'reentries'->>'availability',CASE WHEN v_metrics->'reentries'->>'value' IS NULL THEN NULL ELSE (v_metrics->'reentries'->>'value')::bigint END,
    v_metrics->'registrationRecords'->>'availability',CASE WHEN v_metrics->'registrationRecords'->>'value' IS NULL THEN NULL ELSE (v_metrics->'registrationRecords'->>'value')::bigint END,
    v_metrics->'paidPlaces'->>'availability',CASE WHEN v_metrics->'paidPlaces'->>'value' IS NULL THEN NULL ELSE (v_metrics->'paidPlaces'->>'value')::bigint END,
    v_metrics->'prizePool'->>'availability',CASE WHEN v_metrics->'prizePool'->>'amountMinor' IS NULL THEN NULL ELSE (v_metrics->'prizePool'->>'amountMinor')::numeric END,CASE WHEN v_metrics->'prizePool'->>'currency' IS NULL THEN NULL ELSE upper(v_metrics->'prizePool'->>'currency') END,CASE WHEN v_metrics->'prizePool'->>'scale' IS NULL THEN NULL ELSE (v_metrics->'prizePool'->>'scale')::smallint END,
    v_metrics->'overlay'->>'availability',CASE WHEN v_metrics->'overlay'->>'amountMinor' IS NULL THEN NULL ELSE (v_metrics->'overlay'->>'amountMinor')::numeric END,CASE WHEN v_metrics->'overlay'->>'currency' IS NULL THEN NULL ELSE upper(v_metrics->'overlay'->>'currency') END,CASE WHEN v_metrics->'overlay'->>'scale' IS NULL THEN NULL ELSE (v_metrics->'overlay'->>'scale')::smallint END,
    v_previous.id,v_auto.id,v_manual.id,p_idempotency_key,v_request_hash,public._series_sha256_jsonb_v1(v_content),CASE WHEN v_previous.id IS NULL THEN NULL ELSE v_reason END
  ) RETURNING * INTO v_result;
  INSERT INTO public.series_event_actual_reconciliations_v1(revision_id,club_id,event_id,outcome_scope,auto_revision_id,manual_revision_id,resolution,resolution_hash,owner_reason)
  VALUES(v_result.id,v_auto.club_id,v_auto.event_id,'event_total',v_auto.id,v_manual.id,p_resolution,v_resolution_hash,v_reason);
  RETURN jsonb_build_object('version','series-decision-event-state-v1','state',CASE WHEN v_status='blocked_conflict' THEN 'conflict_recorded' ELSE 'created' END,'revision',public._series_d2b_safe_actual_json_v1(v_result));
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Owner-scoped read model. It exposes only bounded metadata and metric aggregates.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.series_get_decision_event_state_v1(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.tournaments%ROWTYPE;
  v_truth jsonb;
  v_packet public.series_decision_packets_v1%ROWTYPE;
  v_actual public.series_event_actual_revisions_v1%ROWTYPE;
  v_snapshot public.series_forecast_snapshots%ROWTYPE;
  v_reasons jsonb := '[]'::jsonb;
  v_eligible boolean := false;
BEGIN
  IF v_actor IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'decision_event_state_unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_event FROM public.tournaments WHERE id=p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_club_owner(v_actor,v_event.club_id) THEN RAISE EXCEPTION 'decision_event_state_forbidden' USING ERRCODE='42501'; END IF;
  v_truth := public._series_d2b_actual_truth_state_v1(p_event_id,'event_total');
  IF v_truth->>'state'='current' THEN SELECT * INTO v_actual FROM public.series_event_actual_revisions_v1 WHERE id=(v_truth->'chosenRevision'->>'revisionId')::uuid; END IF;
  SELECT * INTO v_packet FROM public.series_decision_packets_v1 p
  WHERE p.club_id=v_event.club_id AND p.event_id=p_event_id
    AND NOT EXISTS (SELECT 1 FROM public.series_decision_packets_v1 c WHERE c.supersedes_packet_id=p.id)
  ORDER BY CASE WHEN p.packet_state='frozen' THEN 0 ELSE 1 END, p.as_of_ts DESC, p.id DESC LIMIT 1;
  IF NOT FOUND THEN v_reasons := jsonb_build_array('no_forecast');
  ELSIF v_packet.packet_state<>'frozen' THEN v_reasons := jsonb_build_array('packet_not_frozen');
  ELSIF v_packet.forecast_state='manual_expectation' THEN v_reasons := jsonb_build_array('manual_expectation_only');
  ELSIF v_packet.forecast_snapshot_id IS NULL THEN v_reasons := jsonb_build_array('no_forecast');
  ELSE
    SELECT * INTO v_snapshot FROM public.series_forecast_snapshots WHERE id=v_packet.forecast_snapshot_id;
    IF NOT FOUND THEN v_reasons := jsonb_build_array('no_forecast');
    ELSIF v_packet.forecast_state<>'forecast_identity_eligible' OR v_snapshot.forecast_identity_eligible IS DISTINCT FROM true OR v_snapshot.provenance_completeness IS DISTINCT FROM 'complete' THEN v_reasons := jsonb_build_array('forecast_provenance_incomplete','forecast_not_identity_eligible');
    ELSIF v_snapshot.club_id<>v_packet.club_id OR v_snapshot.event_id<>v_packet.event_id OR v_packet.target_metric<>'entries' THEN v_reasons := jsonb_build_array('target_metric_mismatch');
    ELSIF v_snapshot.forecast_issued_at IS NULL OR v_snapshot.as_of_ts IS NULL OR v_snapshot.forecast_issued_at>v_packet.as_of_ts THEN v_reasons := jsonb_build_array('outcome_precedes_forecast');
    ELSIF v_truth->>'state'='needs_reconciliation' THEN v_reasons := jsonb_build_array('reconciliation_required');
    ELSIF v_truth->>'state'='conflict' AND v_truth->>'reason'='stale_reconciliation' THEN v_reasons := jsonb_build_array('stale_reconciliation');
    ELSIF v_truth->>'state'='conflict' THEN v_reasons := jsonb_build_array('actual_conflict');
    ELSIF v_actual.id IS NULL THEN v_reasons := jsonb_build_array('no_actual_revision');
    ELSIF v_actual.finality NOT IN ('final','corrected') THEN v_reasons := jsonb_build_array('actual_not_final');
    ELSIF v_actual.source_timestamp_state<>'exact' OR v_actual.source_timestamp IS NULL OR v_actual.source_timestamp<=v_packet.as_of_ts THEN v_reasons := jsonb_build_array('outcome_precedes_forecast');
    ELSIF v_actual.entries_availability NOT IN ('present','explicit_zero') THEN v_reasons := jsonb_build_array('actual_metric_missing');
    ELSE v_eligible := true; END IF;
  END IF;
  RETURN jsonb_build_object(
    'version','series-decision-event-state-v1',
    'event',jsonb_build_object('eventId',v_event.id::text,'clubId',v_event.club_id::text,'status',v_event.status,'targetEventTs',CASE WHEN v_event.start_time IS NULL THEN NULL ELSE public._series_canonical_timestamptz_v1(v_event.start_time) END),
    'decisionPackets',COALESCE((SELECT jsonb_agg(jsonb_build_object('packetId',p.id::text,'horizon',p.decision_horizon,'targetMetric',p.target_metric,'packetState',p.packet_state,'asOfTs',public._series_canonical_timestamptz_v1(p.as_of_ts),'sourceCutoff',public._series_canonical_timestamptz_v1(p.source_cutoff),'forecastSnapshotId',CASE WHEN p.forecast_snapshot_id IS NULL THEN NULL ELSE p.forecast_snapshot_id::text END,'forecastState',p.forecast_state,'contentHash',p.content_hash,'frozenAt',CASE WHEN p.frozen_at IS NULL THEN NULL ELSE public._series_canonical_timestamptz_v1(p.frozen_at) END,'supersedesPacketId',CASE WHEN p.supersedes_packet_id IS NULL THEN NULL ELSE p.supersedes_packet_id::text END) ORDER BY p.decision_horizon,p.as_of_ts) FROM public.series_decision_packets_v1 p WHERE p.club_id=v_event.club_id AND p.event_id=p_event_id),'[]'::jsonb),
    'actualTruth',v_truth,
    'scoring',jsonb_build_object('candidatePacketId',CASE WHEN v_packet.id IS NULL THEN NULL ELSE v_packet.id::text END,'candidateActualRevisionId',CASE WHEN v_actual.id IS NULL THEN NULL ELSE v_actual.id::text END,'targetMetric',CASE WHEN v_packet.id IS NULL THEN NULL ELSE v_packet.target_metric END,'eligibility',CASE WHEN v_eligible THEN 'eligible' ELSE 'blocked' END,'blockReasons',CASE WHEN v_eligible THEN '[]'::jsonb ELSE v_reasons END),
    'dataQuality',jsonb_build_object('legacyActualCacheAvailable',EXISTS(SELECT 1 FROM public.series_event_actuals a WHERE a.event_id=p_event_id AND a.club_id=v_event.club_id),'d2aRevisionAvailable',EXISTS(SELECT 1 FROM public.series_event_actual_revisions_v1 a WHERE a.event_id=p_event_id AND a.club_id=v_event.club_id),'unresolvedMismatch',(v_truth->>'state') IN ('needs_reconciliation','conflict'),'missingFields',CASE WHEN v_actual.id IS NULL THEN '[]'::jsonb ELSE (SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_each(public._series_d2b_actual_metrics_json_v1(v_actual)) e(key,value) WHERE e.value->>'availability' NOT IN ('present','explicit_zero')) END,'unsupportedDerivationWarnings',jsonb_build_array('legacy_cache_not_promoted','paid_places_not_derived_from_planned_itm'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public._series_d2b_reject_metadata_mutation_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2b_exact_keys_v1(jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2b_actual_metrics_json_v1(public.series_event_actual_revisions_v1) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2b_safe_actual_json_v1(public.series_event_actual_revisions_v1) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2b_count_resolution_valid_v1(jsonb,text,bigint,text,bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2b_money_resolution_valid_v1(jsonb,text,numeric,text,smallint,text,numeric,text,smallint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2b_resolution_fields_valid_v1(jsonb,public.series_event_actual_revisions_v1,public.series_event_actual_revisions_v1) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._series_d2b_actual_truth_state_v1(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.series_promote_native_event_actual_v1(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.series_reconcile_event_actual_v1(uuid,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.series_get_decision_event_state_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.series_promote_native_event_actual_v1(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.series_reconcile_event_actual_v1(uuid,uuid,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.series_get_decision_event_state_v1(uuid) TO authenticated;

-- Rollback before any D2B runtime row exists: revoke the three public RPCs, then remove D2B-only
-- helpers/tables after an explicit dependency/data audit. After adoption, rollback is forward-only.

COMMIT;
