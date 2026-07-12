import type { ForecastProvenance } from "./forecastProvenance";
import { isEngineProvenance } from "./forecastProvenance";
import type { ForecastSnapshotInsert } from "./captureTypes";

export type ForecastProvenanceSnapshotColumns = Pick<
  ForecastSnapshotInsert,
  | "forecast_issued_at"
  | "as_of_ts"
  | "target_event_ts"
  | "provenance_kind"
  | "provenance_completeness"
  | "forecast_identity_eligible"
  | "engine_version"
  | "feature_schema_version"
  | "code_sha"
  | "model_config_hash"
  | "trial_count"
  | "selection_protocol_id"
  | "predictor_id"
  | "calibration_pool_id"
  | "target_input_hash"
  | "training_data_hash"
  | "input_content_hash"
  | "forecast_instance_id"
  | "derived_from_input_hash"
>;

/** Flatten the pure B2 union into the exact nullable snapshot columns. */
export function toForecastProvenanceSnapshotColumns(
  provenance: ForecastProvenance,
): ForecastProvenanceSnapshotColumns {
  const engine = isEngineProvenance(provenance) ? provenance : null;

  return {
    forecast_issued_at: provenance.timing.forecastIssuedAt,
    as_of_ts: provenance.timing.asOfTs,
    target_event_ts: provenance.timing.targetEventTs,
    provenance_kind: provenance.kind,
    provenance_completeness: provenance.completeness,
    forecast_identity_eligible: provenance.forecastIdentityEligible,
    engine_version: engine?.predictor.engineVersion ?? null,
    feature_schema_version: engine?.predictor.featureSchemaVersion ?? null,
    code_sha: engine?.predictor.codeSha ?? null,
    model_config_hash: engine?.predictor.modelConfigHash ?? null,
    trial_count: engine?.predictor.trialCount ?? null,
    selection_protocol_id: engine?.predictor.selectionProtocolId ?? null,
    predictor_id: engine?.input.predictorId ?? null,
    calibration_pool_id: engine?.input.calibrationPoolId ?? null,
    target_input_hash: engine?.input.targetInputHash ?? null,
    training_data_hash: engine?.input.trainingDataHash ?? null,
    input_content_hash: engine?.input.inputContentHash ?? null,
    forecast_instance_id: engine?.input.forecastInstanceId ?? null,
    derived_from_input_hash: provenance.derivedFromInputHash,
  };
}
