-- Series Intelligence B2-PR2: nullable forecast provenance storage.
-- SOURCE-ONLY migration. Do not apply to production without owner DB review.
-- Scope: additive columns, nullable by default, no backfill, no app wiring, no generated types.

ALTER TABLE public.series_forecast_snapshots
  ADD COLUMN IF NOT EXISTS forecast_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS as_of_ts timestamptz,
  ADD COLUMN IF NOT EXISTS target_event_ts timestamptz,
  ADD COLUMN IF NOT EXISTS provenance_kind text,
  ADD COLUMN IF NOT EXISTS provenance_completeness text,
  ADD COLUMN IF NOT EXISTS forecast_identity_eligible boolean,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS feature_schema_version text,
  ADD COLUMN IF NOT EXISTS code_sha text,
  ADD COLUMN IF NOT EXISTS model_config_hash text,
  ADD COLUMN IF NOT EXISTS trial_count integer,
  ADD COLUMN IF NOT EXISTS selection_protocol_id text,
  ADD COLUMN IF NOT EXISTS predictor_id text,
  ADD COLUMN IF NOT EXISTS calibration_pool_id text,
  ADD COLUMN IF NOT EXISTS target_input_hash text,
  ADD COLUMN IF NOT EXISTS training_data_hash text,
  ADD COLUMN IF NOT EXISTS input_content_hash text,
  ADD COLUMN IF NOT EXISTS forecast_instance_id text,
  ADD COLUMN IF NOT EXISTS derived_from_input_hash text;

COMMENT ON COLUMN public.series_forecast_snapshots.forecast_issued_at IS
  'B2 provenance: instant when this forecast snapshot was issued.';
COMMENT ON COLUMN public.series_forecast_snapshots.as_of_ts IS
  'B2 provenance: latest observable input instant used by the forecast.';
COMMENT ON COLUMN public.series_forecast_snapshots.target_event_ts IS
  'B2 provenance: target event instant the forecast predicts.';
COMMENT ON COLUMN public.series_forecast_snapshots.provenance_kind IS
  'B2 provenance kind: engine, manual_override, or manual.';
COMMENT ON COLUMN public.series_forecast_snapshots.provenance_completeness IS
  'B2 provenance completeness: complete, missing_code_sha, legacy, or manual.';
COMMENT ON COLUMN public.series_forecast_snapshots.forecast_identity_eligible IS
  'B2 identity eligibility only; final calibration eligibility also depends on post-event B3 actual revision.';
COMMENT ON COLUMN public.series_forecast_snapshots.forecast_instance_id IS
  'B2 64-hex identity for one issued forecast instance; unique when present.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_kind_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_kind_chk
      CHECK (provenance_kind IS NULL OR provenance_kind IN ('engine', 'manual_override', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_completeness_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_completeness_chk
      CHECK (
        provenance_completeness IS NULL
        OR provenance_completeness IN ('complete', 'missing_code_sha', 'legacy', 'manual')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_hashes_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_hashes_chk
      CHECK (
        (model_config_hash IS NULL OR model_config_hash ~ '^[0-9a-f]{64}$')
        AND (predictor_id IS NULL OR predictor_id ~ '^[0-9a-f]{64}$')
        AND (calibration_pool_id IS NULL OR calibration_pool_id ~ '^[0-9a-f]{64}$')
        AND (target_input_hash IS NULL OR target_input_hash ~ '^[0-9a-f]{64}$')
        AND (training_data_hash IS NULL OR training_data_hash ~ '^[0-9a-f]{64}$')
        AND (input_content_hash IS NULL OR input_content_hash ~ '^[0-9a-f]{64}$')
        AND (forecast_instance_id IS NULL OR forecast_instance_id ~ '^[0-9a-f]{64}$')
        AND (derived_from_input_hash IS NULL OR derived_from_input_hash ~ '^[0-9a-f]{64}$')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_code_sha_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_code_sha_chk
      CHECK (code_sha IS NULL OR code_sha = 'unknown' OR code_sha ~ '^[0-9a-f]{7,64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_selection_protocol_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_selection_protocol_chk
      CHECK (selection_protocol_id IS NULL OR selection_protocol_id ~ '^[a-z][a-z0-9._-]{0,63}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_trial_count_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_trial_count_chk
      CHECK (trial_count IS NULL OR trial_count >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_timing_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_timing_chk
      CHECK (as_of_ts IS NULL OR forecast_issued_at IS NULL OR as_of_ts <= forecast_issued_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_legacy_shape_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_legacy_shape_chk
      CHECK (
        provenance_kind IS NOT NULL
        OR (
          (provenance_completeness IS NULL OR provenance_completeness = 'legacy')
          AND forecast_identity_eligible IS NOT TRUE
          AND forecast_issued_at IS NULL
          AND as_of_ts IS NULL
          AND target_event_ts IS NULL
          AND engine_version IS NULL
          AND feature_schema_version IS NULL
          AND code_sha IS NULL
          AND model_config_hash IS NULL
          AND trial_count IS NULL
          AND selection_protocol_id IS NULL
          AND predictor_id IS NULL
          AND calibration_pool_id IS NULL
          AND target_input_hash IS NULL
          AND training_data_hash IS NULL
          AND input_content_hash IS NULL
          AND forecast_instance_id IS NULL
          AND derived_from_input_hash IS NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_manual_shape_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_manual_shape_chk
      CHECK (
        provenance_kind IS DISTINCT FROM 'manual'
        OR (
          forecast_issued_at IS NOT NULL
          AND as_of_ts IS NOT NULL
          AND target_event_ts IS NOT NULL
          AND provenance_completeness IS NOT DISTINCT FROM 'manual'
          AND forecast_identity_eligible IS FALSE
          AND engine_version IS NULL
          AND feature_schema_version IS NULL
          AND code_sha IS NULL
          AND model_config_hash IS NULL
          AND trial_count IS NULL
          AND selection_protocol_id IS NULL
          AND predictor_id IS NULL
          AND calibration_pool_id IS NULL
          AND target_input_hash IS NULL
          AND training_data_hash IS NULL
          AND input_content_hash IS NULL
          AND forecast_instance_id IS NULL
          AND derived_from_input_hash IS NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_engine_common_shape_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_engine_common_shape_chk
      CHECK (
        (provenance_kind IS DISTINCT FROM 'engine' AND provenance_kind IS DISTINCT FROM 'manual_override')
        OR (
          forecast_issued_at IS NOT NULL
          AND as_of_ts IS NOT NULL
          AND target_event_ts IS NOT NULL
          AND (provenance_completeness IN ('complete', 'missing_code_sha')) IS TRUE
          AND engine_version IS NOT NULL
          AND btrim(engine_version) <> ''
          AND feature_schema_version IS NOT NULL
          AND btrim(feature_schema_version) <> ''
          AND code_sha IS NOT NULL
          AND model_config_hash IS NOT NULL
          AND trial_count IS NOT NULL
          AND selection_protocol_id IS NOT NULL
          AND predictor_id IS NOT NULL
          AND calibration_pool_id IS NOT NULL
          AND target_input_hash IS NOT NULL
          AND training_data_hash IS NOT NULL
          AND input_content_hash IS NOT NULL
          AND forecast_instance_id IS NOT NULL
          AND forecast_identity_eligible IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_code_sha_completeness_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_code_sha_completeness_chk
      CHECK (
        (provenance_kind IS DISTINCT FROM 'engine' AND provenance_kind IS DISTINCT FROM 'manual_override')
        OR (
          (
            provenance_completeness = 'missing_code_sha'
            AND code_sha = 'unknown'
          )
          OR (
            provenance_completeness = 'complete'
            AND code_sha ~ '^[0-9a-f]{7,64}$'
            AND code_sha <> 'unknown'
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_engine_shape_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_engine_shape_chk
      CHECK (
        provenance_kind IS DISTINCT FROM 'engine'
        OR (
          derived_from_input_hash IS NULL
          AND forecast_identity_eligible IS NOT DISTINCT FROM (provenance_completeness = 'complete')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_manual_override_shape_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_manual_override_shape_chk
      CHECK (
        provenance_kind IS DISTINCT FROM 'manual_override'
        OR (
          derived_from_input_hash IS NOT NULL
          AND forecast_identity_eligible IS FALSE
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.series_forecast_snapshots'::regclass
      AND conname = 'sfs_prov_identity_eligible_chk'
  ) THEN
    ALTER TABLE public.series_forecast_snapshots
      ADD CONSTRAINT sfs_prov_identity_eligible_chk
      CHECK (
        forecast_identity_eligible IS DISTINCT FROM TRUE
        OR (
          provenance_kind IS NOT DISTINCT FROM 'engine'
          AND provenance_completeness IS NOT DISTINCT FROM 'complete'
          AND forecast_issued_at IS NOT NULL
          AND as_of_ts IS NOT NULL
          AND target_event_ts IS NOT NULL
          AND engine_version IS NOT NULL
          AND btrim(engine_version) <> ''
          AND feature_schema_version IS NOT NULL
          AND btrim(feature_schema_version) <> ''
          AND code_sha IS NOT NULL
          AND code_sha <> 'unknown'
          AND model_config_hash IS NOT NULL
          AND trial_count IS NOT NULL
          AND selection_protocol_id IS NOT NULL
          AND predictor_id IS NOT NULL
          AND calibration_pool_id IS NOT NULL
          AND target_input_hash IS NOT NULL
          AND training_data_hash IS NOT NULL
          AND input_content_hash IS NOT NULL
          AND forecast_instance_id IS NOT NULL
          AND derived_from_input_hash IS NULL
        )
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sfs_forecast_instance_id_unique
  ON public.series_forecast_snapshots(forecast_instance_id)
  WHERE forecast_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sfs_calibration_pool_id
  ON public.series_forecast_snapshots(calibration_pool_id)
  WHERE calibration_pool_id IS NOT NULL;
