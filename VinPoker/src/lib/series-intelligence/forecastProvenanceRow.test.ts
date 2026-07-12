import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";
import type { ForecastProvenance } from "./forecastProvenance";
import { toForecastProvenanceSnapshotColumns } from "./forecastProvenanceRow";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const timing = {
  forecastIssuedAt: "2026-02-10T03:00:00.000Z",
  asOfTs: "2026-02-10T02:00:00.000Z",
  targetEventTs: "2026-02-15T12:00:00.000Z",
};

const manual: ForecastProvenance = {
  kind: "manual",
  predictor: null,
  input: null,
  timing,
  completeness: "manual",
  forecastIdentityEligible: false,
  derivedFromInputHash: null,
};

const engine: ForecastProvenance = {
  kind: "engine",
  predictor: {
    engineVersion: "engine-v1",
    featureSchemaVersion: "schema-v1",
    codeSha: "abc1234",
    modelConfigHash: hashA,
    trialCount: 1,
    selectionProtocolId: "direct-1",
  },
  input: {
    predictorId: hashA,
    calibrationPoolId: hashB,
    targetInputHash: hashA,
    trainingDataHash: hashB,
    inputContentHash: hashA,
    forecastInstanceId: hashB,
  },
  timing,
  completeness: "complete",
  forecastIdentityEligible: true,
  derivedFromInputHash: null,
};

const override: ForecastProvenance = {
  ...engine,
  kind: "manual_override",
  forecastIdentityEligible: false,
  derivedFromInputHash: hashA,
};

describe("forecast provenance snapshot row mapping", () => {
  it("keeps the wiring feature off by default", () => {
    expect(FEATURES.seriesForecastProvenance).toBe(false);
  });

  it("maps manual provenance to the exact null engine shape", () => {
    expect(toForecastProvenanceSnapshotColumns(manual)).toEqual({
      forecast_issued_at: timing.forecastIssuedAt,
      as_of_ts: timing.asOfTs,
      target_event_ts: timing.targetEventTs,
      provenance_kind: "manual",
      provenance_completeness: "manual",
      forecast_identity_eligible: false,
      engine_version: null,
      feature_schema_version: null,
      code_sha: null,
      model_config_hash: null,
      trial_count: null,
      selection_protocol_id: null,
      predictor_id: null,
      calibration_pool_id: null,
      target_input_hash: null,
      training_data_hash: null,
      input_content_hash: null,
      forecast_instance_id: null,
      derived_from_input_hash: null,
    });
  });

  it("preserves complete engine identity and eligibility", () => {
    const row = toForecastProvenanceSnapshotColumns(engine);
    expect(row).toMatchObject({
      provenance_kind: "engine",
      provenance_completeness: "complete",
      forecast_identity_eligible: true,
      engine_version: "engine-v1",
      feature_schema_version: "schema-v1",
      code_sha: "abc1234",
      predictor_id: hashA,
      calibration_pool_id: hashB,
      forecast_instance_id: hashB,
      derived_from_input_hash: null,
    });
  });

  it("keeps full engine identity on manual overrides while retaining derived lineage", () => {
    const row = toForecastProvenanceSnapshotColumns(override);
    expect(row).toMatchObject({
      provenance_kind: "manual_override",
      provenance_completeness: "complete",
      forecast_identity_eligible: false,
      predictor_id: hashA,
      input_content_hash: hashA,
      derived_from_input_hash: hashA,
    });
  });

  it("keeps payload and surface gated when the flag is off", () => {
    const dialog = readFileSync(resolve(process.cwd(), "src/components/series-intelligence/capture/dialogs/ForecastDialog.tsx"), "utf8");
    const panel = readFileSync(resolve(process.cwd(), "src/components/series-intelligence/capture/EventLoopPanel.tsx"), "utf8");
    expect(dialog).toContain("if (FEATURES.seriesForecastProvenance)");
    expect(panel).toContain("FEATURES.seriesForecastProvenance && <ForecastProvenanceCard snapshot={s} />");
  });
});
