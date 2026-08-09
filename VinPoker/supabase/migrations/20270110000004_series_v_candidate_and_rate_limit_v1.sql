-- Series V production-readiness contracts (source only).
--
-- Adds an owner-scoped, approved-only schedule candidate source and a durable,
-- idempotent actor+club rate limiter for the Series Intelligence Copilot.
-- This migration does not provision provider secrets, deploy Edge Functions, or
-- enable any feature flag.

CREATE OR REPLACE FUNCTION public._series_v_evidence_manifest_valid_v1(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'array'
    AND pg_catalog.jsonb_array_length(p_value) BETWEEN 1 AND 32
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_value) AS item
      WHERE pg_catalog.jsonb_typeof(item) <> 'object'
        OR (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(item) AS k)
          IS DISTINCT FROM ARRAY['asOf','evidenceId','labelVi','metricIds','privacyState','quality','sourceId']::text[]
        OR COALESCE(item->>'evidenceId', '') !~ '^[a-z][a-z0-9._:-]{0,127}$'
        OR COALESCE(item->>'sourceId', '') !~ '^[a-z][a-z0-9._:-]{0,127}$'
        OR COALESCE(item->>'labelVi', '') = ''
        OR pg_catalog.length(item->>'labelVi') > 512
        OR COALESCE(item->>'asOf', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
        OR COALESCE(item->>'quality', '') NOT IN ('owner_scoped_server_aggregate','public_unverified')
        OR COALESCE(item->>'privacyState', '') <> 'safe'
        OR pg_catalog.jsonb_typeof(item->'metricIds') <> 'array'
        OR pg_catalog.jsonb_array_length(item->'metricIds') > 64
        OR EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(item->'metricIds') AS metric
          WHERE pg_catalog.jsonb_typeof(metric) <> 'string'
             OR pg_catalog.btrim(metric::text, '"') !~ '^[a-z][a-z0-9._:-]{0,127}$'
        )
        OR (
          SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT metric::text)
          FROM pg_catalog.jsonb_array_elements(item->'metricIds') AS metric
        )
    )
    AND (
      SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT item->>'evidenceId')
      FROM pg_catalog.jsonb_array_elements(p_value) AS item
    );
$$;

REVOKE ALL ON FUNCTION public._series_v_evidence_manifest_valid_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.series_schedule_candidates_v1 (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version                      text NOT NULL DEFAULT 'series-schedule-candidate-v1',
  club_id                             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  option_id                           text NOT NULL,
  revision                            integer NOT NULL,
  lifecycle                           text NOT NULL DEFAULT 'draft',
  source_kind                         text NOT NULL,
  label_vi                            text NOT NULL,
  buy_in_vnd                          bigint NOT NULL,
  gtd_vnd                             bigint NOT NULL,
  flights                             integer NOT NULL,
  expected_duration_minutes           integer,
  prize_contribution_per_entry_vnd    bigint,
  structure_state                     text NOT NULL,
  capacity_state                      text NOT NULL DEFAULT 'unknown',
  collision_state                     text NOT NULL DEFAULT 'unknown',
  evidence_manifest                   jsonb NOT NULL,
  source_fingerprint                  text NOT NULL,
  created_by                          uuid NOT NULL DEFAULT auth.uid(),
  created_at                          timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  approved_by                         uuid,
  approved_at                         timestamptz,
  archived_at                         timestamptz,
  supersedes_candidate_id             uuid,

  CONSTRAINT series_v_candidate_schema_chk CHECK (schema_version = 'series-schedule-candidate-v1'),
  CONSTRAINT series_v_candidate_option_chk CHECK (option_id ~ '^[a-z][a-z0-9._:-]{0,127}$'),
  CONSTRAINT series_v_candidate_revision_chk CHECK (revision >= 1),
  CONSTRAINT series_v_candidate_lifecycle_chk CHECK (lifecycle IN ('draft','approved','archived')),
  CONSTRAINT series_v_candidate_source_chk CHECK (source_kind IN ('owner_authored','deterministic_series_engine')),
  CONSTRAINT series_v_candidate_label_chk CHECK (pg_catalog.btrim(label_vi) <> '' AND pg_catalog.length(label_vi) <= 512),
  CONSTRAINT series_v_candidate_money_chk CHECK (
    buy_in_vnd >= 0 AND gtd_vnd >= 0
    AND buy_in_vnd <= 9007199254740991 AND gtd_vnd <= 9007199254740991
    AND (prize_contribution_per_entry_vnd IS NULL OR (
      prize_contribution_per_entry_vnd > 0
      AND prize_contribution_per_entry_vnd <= 9007199254740991
    ))
  ),
  CONSTRAINT series_v_candidate_count_chk CHECK (
    flights BETWEEN 1 AND 1000
    AND (expected_duration_minutes IS NULL OR expected_duration_minutes BETWEEN 1 AND 100000)
  ),
  CONSTRAINT series_v_candidate_states_chk CHECK (
    structure_state IN ('complete','incomplete')
    AND capacity_state IN ('feasible','blocked','unknown')
    AND collision_state IN ('clear','needs_review','blocked','unknown')
  ),
  CONSTRAINT series_v_candidate_evidence_chk CHECK (public._series_v_evidence_manifest_valid_v1(evidence_manifest)),
  CONSTRAINT series_v_candidate_fingerprint_chk CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT series_v_candidate_lifecycle_shape_chk CHECK (
    (lifecycle = 'draft' AND approved_by IS NULL AND approved_at IS NULL AND archived_at IS NULL)
    OR (lifecycle = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND archived_at IS NULL)
    OR (lifecycle = 'archived' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT series_v_candidate_unique_revision UNIQUE (club_id, option_id, revision),
  CONSTRAINT series_v_candidate_identity UNIQUE (id, club_id, option_id),
  CONSTRAINT series_v_candidate_parent_fk FOREIGN KEY (supersedes_candidate_id, club_id, option_id)
    REFERENCES public.series_schedule_candidates_v1(id, club_id, option_id) ON DELETE RESTRICT,
  CONSTRAINT series_v_candidate_not_self_parent CHECK (supersedes_candidate_id IS NULL OR supersedes_candidate_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_series_v_candidate_root
  ON public.series_schedule_candidates_v1(club_id, option_id)
  WHERE supersedes_candidate_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_v_candidate_single_successor
  ON public.series_schedule_candidates_v1(supersedes_candidate_id)
  WHERE supersedes_candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_series_v_candidate_approved
  ON public.series_schedule_candidates_v1(club_id, option_id, revision DESC)
  WHERE lifecycle = 'approved';

ALTER TABLE public.series_schedule_candidates_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.series_schedule_candidates_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.series_schedule_candidates_v1 TO authenticated;

CREATE POLICY series_v_candidate_owner_select ON public.series_schedule_candidates_v1
  FOR SELECT TO authenticated
  USING (public.is_club_owner(auth.uid(), club_id));

CREATE OR REPLACE FUNCTION public._series_v_guard_candidate_history_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'series_v_candidate_delete_forbidden' USING ERRCODE = '55000';
  END IF;
  IF OLD.lifecycle IN ('approved','archived') THEN
    RAISE EXCEPTION 'series_v_candidate_immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.club_id IS DISTINCT FROM OLD.club_id
    OR NEW.option_id IS DISTINCT FROM OLD.option_id
    OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
    OR NEW.supersedes_candidate_id IS DISTINCT FROM OLD.supersedes_candidate_id
  THEN
    RAISE EXCEPTION 'series_v_candidate_identity_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._series_v_guard_candidate_history_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER series_v_candidate_history_guard
  BEFORE UPDATE OR DELETE ON public.series_schedule_candidates_v1
  FOR EACH ROW EXECUTE FUNCTION public._series_v_guard_candidate_history_v1();

CREATE OR REPLACE FUNCTION public.series_approve_schedule_candidate_v1(
  p_club_id uuid,
  p_option_id text,
  p_source_kind text,
  p_label_vi text,
  p_buy_in_vnd bigint,
  p_gtd_vnd bigint,
  p_flights integer,
  p_expected_duration_minutes integer,
  p_prize_contribution_per_entry_vnd bigint,
  p_structure_state text,
  p_capacity_state text,
  p_collision_state text,
  p_evidence_manifest jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_parent public.series_schedule_candidates_v1%ROWTYPE;
  v_result public.series_schedule_candidates_v1%ROWTYPE;
  v_fingerprint text;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR NOT public.is_club_owner(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'series_v_candidate_approval_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source_kind IS DISTINCT FROM 'owner_authored' THEN
    RAISE EXCEPTION 'series_v_candidate_owner_source_required' USING ERRCODE = '22023';
  END IF;
  IF NOT public._series_v_evidence_manifest_valid_v1(p_evidence_manifest)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_evidence_manifest) AS evidence
      WHERE (evidence->>'asOf')::timestamptz > v_now
    )
  THEN
    RAISE EXCEPTION 'series_v_candidate_invalid_evidence' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := public._series_sha256_jsonb_v1(pg_catalog.jsonb_build_object(
    'contractVersion', 'series-schedule-candidate-v1',
    'clubId', p_club_id::text,
    'optionId', p_option_id,
    'sourceKind', p_source_kind,
    'labelVi', p_label_vi,
    'buyInVnd', p_buy_in_vnd,
    'gtdVnd', p_gtd_vnd,
    'flights', p_flights,
    'expectedDurationMinutes', p_expected_duration_minutes,
    'prizeContributionPerEntryVnd', p_prize_contribution_per_entry_vnd,
    'structureState', p_structure_state,
    'capacityState', p_capacity_state,
    'collisionState', p_collision_state,
    'evidenceManifest', p_evidence_manifest
  ));

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('series-v-candidate:' || p_club_id::text || ':' || COALESCE(p_option_id, ''), 0)
  );

  SELECT c.* INTO v_parent
  FROM public.series_schedule_candidates_v1 AS c
  WHERE c.club_id = p_club_id
    AND c.option_id = p_option_id
    AND NOT EXISTS (
      SELECT 1 FROM public.series_schedule_candidates_v1 AS successor
      WHERE successor.supersedes_candidate_id = c.id
        AND successor.lifecycle IN ('approved','archived')
    )
  FOR UPDATE;

  IF FOUND AND v_parent.source_fingerprint = v_fingerprint AND v_parent.lifecycle = 'approved' THEN
    RETURN pg_catalog.jsonb_build_object(
      'version', 'series-schedule-candidate-approval-v1',
      'candidateId', v_parent.id::text,
      'optionId', v_parent.option_id,
      'revision', v_parent.revision,
      'lifecycle', v_parent.lifecycle,
      'sourceFingerprint', v_parent.source_fingerprint
    );
  END IF;

  INSERT INTO public.series_schedule_candidates_v1(
    club_id, option_id, revision, lifecycle, source_kind, label_vi,
    buy_in_vnd, gtd_vnd, flights, expected_duration_minutes,
    prize_contribution_per_entry_vnd, structure_state, capacity_state,
    collision_state, evidence_manifest, source_fingerprint, created_by,
    approved_by, approved_at, supersedes_candidate_id
  ) VALUES (
    p_club_id, p_option_id, COALESCE(v_parent.revision + 1, 1), 'approved', p_source_kind, p_label_vi,
    p_buy_in_vnd, p_gtd_vnd, p_flights, p_expected_duration_minutes,
    p_prize_contribution_per_entry_vnd, p_structure_state, p_capacity_state,
    p_collision_state, p_evidence_manifest, v_fingerprint, v_actor,
    v_actor, v_now, v_parent.id
  ) RETURNING * INTO v_result;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'series-schedule-candidate-approval-v1',
    'candidateId', v_result.id::text,
    'optionId', v_result.option_id,
    'revision', v_result.revision,
    'lifecycle', v_result.lifecycle,
    'sourceFingerprint', v_result.source_fingerprint
  );
END;
$$;

REVOKE ALL ON FUNCTION public.series_approve_schedule_candidate_v1(
  uuid, text, text, text, bigint, bigint, integer, integer, bigint, text, text, text, jsonb
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.series_approve_schedule_candidate_v1(
  uuid, text, text, text, bigint, bigint, integer, integer, bigint, text, text, text, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.series_get_approved_schedule_candidates_v1(
  p_club_id uuid,
  p_option_ids text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_as_of timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_candidates jsonb;
  v_evidence jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR NOT public.is_club_owner(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'series_v_candidate_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_option_ids IS NOT NULL AND (
    pg_catalog.cardinality(p_option_ids) > 12
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_option_ids) AS option_id WHERE option_id !~ '^[a-z][a-z0-9._:-]{0,127}$')
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.unnest(p_option_ids))
      <> (SELECT pg_catalog.count(DISTINCT option_id) FROM pg_catalog.unnest(p_option_ids) AS option_id)
  ) THEN
    RAISE EXCEPTION 'series_v_candidate_invalid_selection' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH current_candidates AS (
      SELECT c.evidence_manifest
      FROM public.series_schedule_candidates_v1 AS c
      WHERE c.club_id = p_club_id
        AND c.lifecycle = 'approved'
        AND (p_option_ids IS NULL OR c.option_id = ANY(p_option_ids))
        AND NOT EXISTS (SELECT 1 FROM public.series_schedule_candidates_v1 AS successor WHERE successor.supersedes_candidate_id = c.id AND successor.lifecycle IN ('approved','archived'))
    )
    SELECT 1
    FROM current_candidates, LATERAL pg_catalog.jsonb_array_elements(evidence_manifest) AS e
    GROUP BY e->>'evidenceId'
    HAVING pg_catalog.count(DISTINCT e::text) > 1
  ) THEN
    RAISE EXCEPTION 'series_v_candidate_evidence_conflict' USING ERRCODE = '22023';
  END IF;

  WITH current_candidates AS (
    SELECT c.*
    FROM public.series_schedule_candidates_v1 AS c
    WHERE c.club_id = p_club_id
      AND c.lifecycle = 'approved'
      AND (p_option_ids IS NULL OR c.option_id = ANY(p_option_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.series_schedule_candidates_v1 AS successor
        WHERE successor.supersedes_candidate_id = c.id
          AND successor.lifecycle IN ('approved','archived')
      )
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'optionId', option_id,
    'labelVi', label_vi,
    'buyIn', pg_catalog.jsonb_build_object('amountMinor', buy_in_vnd::text, 'currency', 'VND', 'scale', 0),
    'gtd', pg_catalog.jsonb_build_object('amountMinor', gtd_vnd::text, 'currency', 'VND', 'scale', 0),
    'flights', flights,
    'expectedDurationMinutes', expected_duration_minutes,
    'requiredField', CASE
      WHEN prize_contribution_per_entry_vnd IS NULL THEN NULL
      ELSE pg_catalog.ceil(gtd_vnd::numeric / prize_contribution_per_entry_vnd::numeric)::bigint
    END,
    'structureState', structure_state,
    'capacityState', capacity_state,
    'collisionState', collision_state,
    'gtdStressState', CASE WHEN prize_contribution_per_entry_vnd IS NULL THEN 'unknown' ELSE 'supported' END,
    'evidenceRefs', (SELECT pg_catalog.jsonb_agg(e->>'evidenceId' ORDER BY e->>'evidenceId') FROM pg_catalog.jsonb_array_elements(evidence_manifest) AS e)
  ) ORDER BY option_id), '[]'::jsonb)
  INTO v_candidates
  FROM current_candidates;

  WITH current_candidates AS (
    SELECT c.evidence_manifest
    FROM public.series_schedule_candidates_v1 AS c
    WHERE c.club_id = p_club_id
      AND c.lifecycle = 'approved'
      AND (p_option_ids IS NULL OR c.option_id = ANY(p_option_ids))
      AND NOT EXISTS (SELECT 1 FROM public.series_schedule_candidates_v1 AS successor WHERE successor.supersedes_candidate_id = c.id AND successor.lifecycle IN ('approved','archived'))
  ), evidence_rows AS (
    SELECT DISTINCT ON (e->>'evidenceId') e
    FROM current_candidates, LATERAL pg_catalog.jsonb_array_elements(evidence_manifest) AS e
    ORDER BY e->>'evidenceId', e::text
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(e ORDER BY e->>'evidenceId'), '[]'::jsonb)
  INTO v_evidence
  FROM evidence_rows;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'series-approved-schedule-candidates-v1',
    'clubId', p_club_id::text,
    'asOf', pg_catalog.to_char(v_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'candidateOptions', v_candidates,
    'evidence', v_evidence,
    'dataGaps', CASE WHEN pg_catalog.jsonb_array_length(v_candidates) = 0 THEN pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'dataGapId', 'gap_approved_schedule_candidates',
      'titleVi', 'Chưa có phương án lịch được duyệt',
      'detailVi', 'V chỉ đánh giá phương án đã được owner duyệt ở nguồn server.',
      'severity', 'critical',
      'blocksRecommendation', true,
      'requiredSourceVi', 'Phương án lịch server-side đã duyệt'
    )) ELSE '[]'::jsonb END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.series_get_approved_schedule_candidates_v1(uuid, text[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.series_get_approved_schedule_candidates_v1(uuid, text[])
  TO authenticated;

CREATE TABLE IF NOT EXISTS public.series_copilot_rate_limit_requests_v1 (
  actor_id       uuid NOT NULL,
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  request_id     uuid NOT NULL,
  policy_version text NOT NULL DEFAULT 'series-v-rate-policy-v1',
  allowed        boolean NOT NULL,
  retry_after_seconds integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  PRIMARY KEY (actor_id, club_id, request_id),
  CONSTRAINT series_v_rate_policy_chk CHECK (policy_version = 'series-v-rate-policy-v1'),
  CONSTRAINT series_v_rate_retry_chk CHECK (retry_after_seconds BETWEEN 0 AND 3600),
  CONSTRAINT series_v_rate_expiry_chk CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_series_v_rate_expiry
  ON public.series_copilot_rate_limit_requests_v1(expires_at);
CREATE INDEX IF NOT EXISTS idx_series_v_rate_actor_club
  ON public.series_copilot_rate_limit_requests_v1(actor_id, club_id, created_at DESC)
  WHERE allowed IS TRUE;

ALTER TABLE public.series_copilot_rate_limit_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.series_copilot_rate_limit_requests_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.series_consume_copilot_rate_limit_v1(
  p_club_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing public.series_copilot_rate_limit_requests_v1%ROWTYPE;
  v_short_count integer;
  v_long_count integer;
  v_allowed boolean;
  v_retry integer := 0;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR p_request_id IS NULL
    OR NOT public.is_club_owner(v_actor, p_club_id)
  THEN
    RAISE EXCEPTION 'series_v_rate_limit_forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('series-v-rate:' || v_actor::text || ':' || p_club_id::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.series_copilot_rate_limit_requests_v1
  WHERE actor_id = v_actor AND club_id = p_club_id AND request_id = p_request_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'version', v_existing.policy_version,
      'allowed', v_existing.allowed,
      'retryAfterSeconds', v_existing.retry_after_seconds,
      'limitScope', 'actor_club_global'
    );
  END IF;

  DELETE FROM public.series_copilot_rate_limit_requests_v1
  WHERE expires_at <= v_now;

  SELECT
    pg_catalog.count(*) FILTER (WHERE created_at > v_now - INTERVAL '60 seconds'),
    pg_catalog.count(*) FILTER (WHERE created_at > v_now - INTERVAL '1 hour')
  INTO v_short_count, v_long_count
  FROM public.series_copilot_rate_limit_requests_v1
  WHERE actor_id = v_actor AND club_id = p_club_id AND allowed IS TRUE;

  v_allowed := v_short_count < 5 AND v_long_count < 30;
  IF NOT v_allowed THEN
    IF v_short_count >= 5 THEN
      SELECT GREATEST(1, pg_catalog.ceil(EXTRACT(EPOCH FROM (MIN(created_at) + INTERVAL '60 seconds' - v_now)))::integer)
      INTO v_retry
      FROM public.series_copilot_rate_limit_requests_v1
      WHERE actor_id = v_actor AND club_id = p_club_id AND allowed IS TRUE
        AND created_at > v_now - INTERVAL '60 seconds';
    ELSE
      SELECT GREATEST(1, pg_catalog.ceil(EXTRACT(EPOCH FROM (MIN(created_at) + INTERVAL '1 hour' - v_now)))::integer)
      INTO v_retry
      FROM public.series_copilot_rate_limit_requests_v1
      WHERE actor_id = v_actor AND club_id = p_club_id AND allowed IS TRUE
        AND created_at > v_now - INTERVAL '1 hour';
    END IF;
  END IF;

  IF v_allowed THEN
    INSERT INTO public.series_copilot_rate_limit_requests_v1(
      actor_id, club_id, request_id, allowed, retry_after_seconds, created_at, expires_at
    ) VALUES (
      v_actor, p_club_id, p_request_id, true, 0, v_now, v_now + INTERVAL '1 hour'
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'series-v-rate-policy-v1',
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry,
    'limitScope', 'actor_club_global'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.series_consume_copilot_rate_limit_v1(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.series_consume_copilot_rate_limit_v1(uuid, uuid)
  TO authenticated;

-- ROLLBACK (owner-gated; never run automatically):
-- DROP FUNCTION public.series_consume_copilot_rate_limit_v1(uuid, uuid);
-- DROP TABLE public.series_copilot_rate_limit_requests_v1;
-- DROP FUNCTION public.series_get_approved_schedule_candidates_v1(uuid, text[]);
-- DROP FUNCTION public.series_approve_schedule_candidate_v1(uuid, text, text, text, bigint, bigint, integer, integer, bigint, text, text, text, jsonb);
-- DROP TRIGGER series_v_candidate_history_guard ON public.series_schedule_candidates_v1;
-- DROP FUNCTION public._series_v_guard_candidate_history_v1();
-- DROP TABLE public.series_schedule_candidates_v1;
-- DROP FUNCTION public._series_v_evidence_manifest_valid_v1(jsonb);
