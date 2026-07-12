import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../../..");
const MIGRATIONS_DIR = join(APP_ROOT, "supabase", "migrations");
const MIGRATION_FILE = "20261239000000_series_forecast_provenance_schema.sql";
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_FILE);
const SQL = readFileSync(MIGRATION_PATH, "utf8");
const NORMALIZED_SQL = SQL.replace(/\s+/g, " ").toLowerCase();

const REQUIRED_COLUMNS: Record<string, string> = {
  forecast_issued_at: "timestamptz",
  as_of_ts: "timestamptz",
  target_event_ts: "timestamptz",
  provenance_kind: "text",
  provenance_completeness: "text",
  forecast_identity_eligible: "boolean",
  engine_version: "text",
  feature_schema_version: "text",
  code_sha: "text",
  model_config_hash: "text",
  trial_count: "integer",
  selection_protocol_id: "text",
  predictor_id: "text",
  calibration_pool_id: "text",
  target_input_hash: "text",
  training_data_hash: "text",
  input_content_hash: "text",
  forecast_instance_id: "text",
  derived_from_input_hash: "text",
};

const HASH_COLUMNS = [
  "model_config_hash",
  "predictor_id",
  "calibration_pool_id",
  "target_input_hash",
  "training_data_hash",
  "input_content_hash",
  "forecast_instance_id",
  "derived_from_input_hash",
];

const ENGINE_REQUIRED_COLUMNS = [
  "forecast_issued_at",
  "as_of_ts",
  "target_event_ts",
  "engine_version",
  "feature_schema_version",
  "code_sha",
  "model_config_hash",
  "trial_count",
  "selection_protocol_id",
  "predictor_id",
  "calibration_pool_id",
  "target_input_hash",
  "training_data_hash",
  "input_content_hash",
  "forecast_instance_id",
  "forecast_identity_eligible",
];

const EMPTY_PROVENANCE_COLUMNS = [
  "forecast_issued_at",
  "as_of_ts",
  "target_event_ts",
  "engine_version",
  "feature_schema_version",
  "code_sha",
  "model_config_hash",
  "trial_count",
  "selection_protocol_id",
  "predictor_id",
  "calibration_pool_id",
  "target_input_hash",
  "training_data_hash",
  "input_content_hash",
  "forecast_instance_id",
  "derived_from_input_hash",
];

const valid64 = "a".repeat(64);
const valid64b = "b".repeat(64);
const valid64c = "c".repeat(64);
const issued = "2026-02-10T03:00:00Z";
const asOf = "2026-02-10T02:00:00Z";
const targetTs = "2026-02-15T12:00:00Z";

type Row = {
  forecastIssuedAt?: string | null;
  asOfTs?: string | null;
  targetEventTs?: string | null;
  provenanceKind?: "engine" | "manual_override" | "manual" | string | null;
  provenanceCompleteness?: "complete" | "missing_code_sha" | "legacy" | "manual" | string | null;
  forecastIdentityEligible?: boolean | null;
  engineVersion?: string | null;
  featureSchemaVersion?: string | null;
  codeSha?: string | null;
  modelConfigHash?: string | null;
  trialCount?: number | null;
  selectionProtocolId?: string | null;
  predictorId?: string | null;
  calibrationPoolId?: string | null;
  targetInputHash?: string | null;
  trainingDataHash?: string | null;
  inputContentHash?: string | null;
  forecastInstanceId?: string | null;
  derivedFromInputHash?: string | null;
};

const isHash = (value: string | null | undefined) => value == null || /^[0-9a-f]{64}$/.test(value);
const isCodeSha = (value: string | null | undefined) =>
  value == null || value === "unknown" || /^[0-9a-f]{7,64}$/.test(value);
const isSelectionProtocol = (value: string | null | undefined) =>
  value == null || /^[a-z][a-z0-9._-]{0,63}$/.test(value);
const presentText = (value: string | null | undefined) => value != null && value.trim() !== "";
const present = (value: unknown) => value != null;

function satisfiesMigrationChecks(row: Row): boolean {
  if (row.provenanceKind != null && !["engine", "manual_override", "manual"].includes(row.provenanceKind)) return false;
  if (
    row.provenanceCompleteness != null &&
    !["complete", "missing_code_sha", "legacy", "manual"].includes(row.provenanceCompleteness)
  ) return false;
  if (
    ![
      row.modelConfigHash,
      row.predictorId,
      row.calibrationPoolId,
      row.targetInputHash,
      row.trainingDataHash,
      row.inputContentHash,
      row.forecastInstanceId,
      row.derivedFromInputHash,
    ].every(isHash)
  ) return false;
  if (!isCodeSha(row.codeSha)) return false;
  if (!isSelectionProtocol(row.selectionProtocolId)) return false;
  if (row.trialCount != null && (!Number.isInteger(row.trialCount) || row.trialCount < 1)) return false;
  if (row.asOfTs != null && row.forecastIssuedAt != null && Date.parse(row.asOfTs) > Date.parse(row.forecastIssuedAt)) {
    return false;
  }

  const emptyIdentityValues = [
    row.forecastIssuedAt,
    row.asOfTs,
    row.targetEventTs,
    row.engineVersion,
    row.featureSchemaVersion,
    row.codeSha,
    row.modelConfigHash,
    row.trialCount,
    row.selectionProtocolId,
    row.predictorId,
    row.calibrationPoolId,
    row.targetInputHash,
    row.trainingDataHash,
    row.inputContentHash,
    row.forecastInstanceId,
    row.derivedFromInputHash,
  ];

  if (row.provenanceKind == null) {
    if (!(row.provenanceCompleteness == null || row.provenanceCompleteness === "legacy")) return false;
    if (row.forecastIdentityEligible === true) return false;
    return emptyIdentityValues.every((value) => value == null);
  }

  if (row.provenanceKind === "manual") {
    const manualIdentityValues = [
      row.engineVersion,
      row.featureSchemaVersion,
      row.codeSha,
      row.modelConfigHash,
      row.trialCount,
      row.selectionProtocolId,
      row.predictorId,
      row.calibrationPoolId,
      row.targetInputHash,
      row.trainingDataHash,
      row.inputContentHash,
      row.forecastInstanceId,
      row.derivedFromInputHash,
    ];
    return (
      present(row.forecastIssuedAt) &&
      present(row.asOfTs) &&
      present(row.targetEventTs) &&
      row.provenanceCompleteness === "manual" &&
      row.forecastIdentityEligible === false &&
      manualIdentityValues.every((value) => value == null)
    );
  }

  const engineCommon =
    present(row.forecastIssuedAt) &&
    present(row.asOfTs) &&
    present(row.targetEventTs) &&
    (row.provenanceCompleteness === "complete" || row.provenanceCompleteness === "missing_code_sha") &&
    presentText(row.engineVersion) &&
    presentText(row.featureSchemaVersion) &&
    present(row.codeSha) &&
    present(row.modelConfigHash) &&
    present(row.trialCount) &&
    present(row.selectionProtocolId) &&
    present(row.predictorId) &&
    present(row.calibrationPoolId) &&
    present(row.targetInputHash) &&
    present(row.trainingDataHash) &&
    present(row.inputContentHash) &&
    present(row.forecastInstanceId) &&
    present(row.forecastIdentityEligible);
  if (!engineCommon) return false;

  const codeShaPairing =
    (row.provenanceCompleteness === "missing_code_sha" && row.codeSha === "unknown") ||
    (row.provenanceCompleteness === "complete" && /^[0-9a-f]{7,64}$/.test(row.codeSha ?? "") && row.codeSha !== "unknown");
  if (!codeShaPairing) return false;

  if (row.provenanceKind === "engine") {
    return row.derivedFromInputHash == null && row.forecastIdentityEligible === (row.provenanceCompleteness === "complete");
  }

  if (row.provenanceKind === "manual_override") {
    return row.derivedFromInputHash != null && row.forecastIdentityEligible === false;
  }

  return false;
}

const manualRow = (): Row => ({
  forecastIssuedAt: issued,
  asOfTs: asOf,
  targetEventTs: targetTs,
  provenanceKind: "manual",
  provenanceCompleteness: "manual",
  forecastIdentityEligible: false,
});

const completeEngineRow = (): Row => ({
  forecastIssuedAt: issued,
  asOfTs: asOf,
  targetEventTs: targetTs,
  provenanceKind: "engine",
  provenanceCompleteness: "complete",
  forecastIdentityEligible: true,
  engineVersion: "turnout-forecast-v1",
  featureSchemaVersion: "series-feature-schema-v1",
  codeSha: "abc1234",
  modelConfigHash: valid64,
  trialCount: 1,
  selectionProtocolId: "direct-1",
  predictorId: valid64,
  calibrationPoolId: valid64,
  targetInputHash: valid64,
  trainingDataHash: valid64,
  inputContentHash: valid64,
  forecastInstanceId: valid64b,
});

const missingCodeEngineRow = (): Row => ({
  ...completeEngineRow(),
  provenanceCompleteness: "missing_code_sha",
  forecastIdentityEligible: false,
  codeSha: "unknown",
});

const completeOverrideRow = (): Row => ({
  ...completeEngineRow(),
  provenanceKind: "manual_override",
  forecastIdentityEligible: false,
  derivedFromInputHash: valid64c,
});

const missingCodeOverrideRow = (): Row => ({
  ...completeOverrideRow(),
  provenanceCompleteness: "missing_code_sha",
  codeSha: "unknown",
});

const without = (row: Row, key: keyof Row): Row => ({ ...row, [key]: null });
const expectSqlContains = (...fragments: string[]) => {
  for (const fragment of fragments) {
    expect(NORMALIZED_SQL).toContain(fragment);
  }
};

describe("B2-PR2 forecast provenance schema migration", () => {
  it("uses a unique migration version", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{14}_.+\.sql$/.test(name));
    expect(files).toContain(MIGRATION_FILE);
    expect(files.filter((name) => name.startsWith("20261239000000_"))).toEqual([MIGRATION_FILE]);
  });

  it("adds only nullable source columns with no fake defaults", () => {
    for (const [column, type] of Object.entries(REQUIRED_COLUMNS)) {
      const declaration = new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\s+${type}\\b`, "i");
      expect(SQL).toMatch(declaration);

      const columnLine = SQL.split(/\r?\n/).find((line) => line.includes(` ${column} `));
      expect(columnLine).toBeDefined();
      expect(columnLine?.toLowerCase()).not.toContain("not null");
      expect(columnLine?.toLowerCase()).not.toContain(" default ");
    }
  });

  it("has no forward rewrite, backfill, destructive DDL, RPC, Edge, or type regeneration", () => {
    expect(NORMALIZED_SQL).not.toMatch(/\bupdate\s+public\.series_forecast_snapshots\b/);
    expect(NORMALIZED_SQL).not.toMatch(/\binsert\s+into\s+public\.series_forecast_snapshots\b/);
    expect(NORMALIZED_SQL).not.toMatch(/\bdelete\s+from\s+public\.series_forecast_snapshots\b/);
    expect(NORMALIZED_SQL).not.toMatch(/\bdrop\b/);
    expect(NORMALIZED_SQL).not.toMatch(/\bcreate\s+(or\s+replace\s+)?function\b/);
    expect(NORMALIZED_SQL).not.toMatch(/\balter\s+column\b.*\bset\s+default\b/);
  });

  it("statically locks the SQL shape predicates for every discriminator branch", () => {
    expectSqlContains(
      "sfs_prov_kind_chk",
      "sfs_prov_completeness_chk",
      "sfs_prov_hashes_chk",
      "sfs_prov_code_sha_chk",
      "sfs_prov_selection_protocol_chk",
      "sfs_prov_trial_count_chk",
      "sfs_prov_timing_chk",
      "sfs_prov_legacy_shape_chk",
      "sfs_prov_manual_shape_chk",
      "sfs_prov_engine_common_shape_chk",
      "sfs_prov_code_sha_completeness_chk",
      "sfs_prov_engine_shape_chk",
      "sfs_prov_manual_override_shape_chk",
      "sfs_prov_identity_eligible_chk",
    );

    expectSqlContains(
      "provenance_kind is not null or",
      "provenance_completeness is null or provenance_completeness = 'legacy'",
      "forecast_identity_eligible is not true",
      "provenance_kind is distinct from 'manual'",
      "provenance_completeness is not distinct from 'manual'",
      "forecast_identity_eligible is false",
      "(provenance_kind is distinct from 'engine' and provenance_kind is distinct from 'manual_override')",
      "(provenance_completeness in ('complete', 'missing_code_sha')) is true",
      "btrim(engine_version) <> ''",
      "btrim(feature_schema_version) <> ''",
      "provenance_completeness = 'missing_code_sha' and code_sha = 'unknown'",
      "provenance_completeness = 'complete' and code_sha ~ '^[0-9a-f]{7,64}$' and code_sha <> 'unknown'",
      "forecast_identity_eligible is not distinct from (provenance_completeness = 'complete')",
      "derived_from_input_hash is not null and forecast_identity_eligible is false",
      "provenance_kind is not distinct from 'engine'",
      "provenance_completeness is not distinct from 'complete'",
    );

    for (const column of HASH_COLUMNS) {
      expect(NORMALIZED_SQL).toContain(`${column} is null or ${column} ~ '^[0-9a-f]{64}$'`);
    }
    for (const column of EMPTY_PROVENANCE_COLUMNS) {
      expect(NORMALIZED_SQL).toContain(`${column} is null`);
    }
    for (const column of ENGINE_REQUIRED_COLUMNS) {
      expect(NORMALIZED_SQL).toContain(`${column} is not null`);
    }
  });

  it("keeps the structural indexes narrow and partial", () => {
    expectSqlContains(
      "create unique index if not exists idx_sfs_forecast_instance_id_unique",
      "where forecast_instance_id is not null",
      "create index if not exists idx_sfs_calibration_pool_id",
      "where calibration_pool_id is not null",
    );
  });

  it("mirrors positive examples without claiming PostgreSQL execution", () => {
    expect(satisfiesMigrationChecks({})).toBe(true);
    expect(satisfiesMigrationChecks({ provenanceCompleteness: "legacy" })).toBe(true);
    expect(satisfiesMigrationChecks({ provenanceCompleteness: "legacy", forecastIdentityEligible: false })).toBe(true);
    expect(satisfiesMigrationChecks(manualRow())).toBe(true);
    expect(satisfiesMigrationChecks(completeEngineRow())).toBe(true);
    expect(satisfiesMigrationChecks(missingCodeEngineRow())).toBe(true);
    expect(satisfiesMigrationChecks(completeOverrideRow())).toBe(true);
    expect(satisfiesMigrationChecks(missingCodeOverrideRow())).toBe(true);
  });

  it("mirrors negative examples for the SQL discriminator contract", () => {
    expect(satisfiesMigrationChecks(without(manualRow(), "forecastIssuedAt"))).toBe(false);
    expect(satisfiesMigrationChecks({ ...manualRow(), forecastIdentityEligible: null })).toBe(false);
    expect(satisfiesMigrationChecks({ provenanceKind: "engine" })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), provenanceCompleteness: "legacy" })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), provenanceCompleteness: "manual" })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), engineVersion: "   " })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), featureSchemaVersion: "" })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), codeSha: "unknown" })).toBe(false);
    expect(satisfiesMigrationChecks({ ...missingCodeEngineRow(), codeSha: "abc1234" })).toBe(false);
    expect(satisfiesMigrationChecks({ provenanceKind: "manual_override", derivedFromInputHash: valid64 })).toBe(false);
    expect(satisfiesMigrationChecks(without(completeOverrideRow(), "predictorId"))).toBe(false);
    expect(satisfiesMigrationChecks({ predictorId: valid64 })).toBe(false);
    for (const field of ["forecastIssuedAt", "asOfTs", "targetEventTs"] as const) {
      expect(satisfiesMigrationChecks(without(completeEngineRow(), field))).toBe(false);
    }
  });

  it("mirrors primitive validation examples for hashes, trial count, timing, and lineage", () => {
    expect(satisfiesMigrationChecks({ provenanceCompleteness: "legacy", predictorId: "A".repeat(64) })).toBe(false);
    expect(satisfiesMigrationChecks({ provenanceCompleteness: "legacy", predictorId: "a".repeat(63) })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), trialCount: 0 })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), trialCount: -1 })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), trialCount: 1.5 })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), asOfTs: "2026-02-11T00:00:00Z" })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), derivedFromInputHash: valid64 })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeOverrideRow(), forecastIdentityEligible: true })).toBe(false);
  });
});
