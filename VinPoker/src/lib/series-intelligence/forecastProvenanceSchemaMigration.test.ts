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

const valid64 = "a".repeat(64);
const valid64b = "b".repeat(64);

type Row = {
  forecastIssuedAt?: string | null;
  asOfTs?: string | null;
  provenanceKind?: "engine" | "manual_override" | "manual" | "legacy" | null;
  provenanceCompleteness?: "complete" | "missing_code_sha" | "legacy" | "manual" | null;
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

  if (row.provenanceKind === "manual") {
    const manualMustBeEmpty = [
      row.predictorId,
      row.calibrationPoolId,
      row.targetInputHash,
      row.trainingDataHash,
      row.inputContentHash,
      row.forecastInstanceId,
      row.derivedFromInputHash,
      row.engineVersion,
      row.featureSchemaVersion,
      row.codeSha,
      row.modelConfigHash,
      row.trialCount,
      row.selectionProtocolId,
    ];
    if (!manualMustBeEmpty.every((value) => value == null)) return false;
    if (row.forecastIdentityEligible === true) return false;
    if (row.provenanceCompleteness != null && row.provenanceCompleteness !== "manual") return false;
  }

  if (row.provenanceKind === "manual_override") {
    if (row.derivedFromInputHash == null) return false;
    if (row.forecastIdentityEligible === true) return false;
  }

  if (row.provenanceKind === "engine" && row.derivedFromInputHash != null) return false;

  if (row.forecastIdentityEligible === true) {
    return (
      row.provenanceKind === "engine" &&
      row.provenanceCompleteness === "complete" &&
      row.engineVersion != null &&
      row.featureSchemaVersion != null &&
      row.codeSha != null &&
      row.codeSha !== "unknown" &&
      row.modelConfigHash != null &&
      row.trialCount != null &&
      row.trialCount >= 1 &&
      row.selectionProtocolId != null &&
      row.predictorId != null &&
      row.calibrationPoolId != null &&
      row.targetInputHash != null &&
      row.trainingDataHash != null &&
      row.inputContentHash != null &&
      row.forecastInstanceId != null &&
      row.derivedFromInputHash == null
    );
  }

  return true;
}

const completeEngineRow = (): Row => ({
  provenanceKind: "engine",
  provenanceCompleteness: "complete",
  forecastIdentityEligible: true,
  engineVersion: "turnout-forecast-v1",
  featureSchemaVersion: "series-feature-schema-v1",
  codeSha: "abc1234",
  modelConfigHash: valid64,
  trialCount: 1,
  selectionProtocolId: "direct",
  predictorId: valid64,
  calibrationPoolId: valid64,
  targetInputHash: valid64,
  trainingDataHash: valid64,
  inputContentHash: valid64,
  forecastInstanceId: valid64b,
});

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

  it("encodes the expected B2 check constraints and partial indexes", () => {
    for (const name of [
      "sfs_prov_kind_chk",
      "sfs_prov_completeness_chk",
      "sfs_prov_hashes_chk",
      "sfs_prov_code_sha_chk",
      "sfs_prov_selection_protocol_chk",
      "sfs_prov_trial_count_chk",
      "sfs_prov_timing_chk",
      "sfs_prov_manual_identity_chk",
      "sfs_prov_manual_override_chk",
      "sfs_prov_engine_lineage_chk",
      "sfs_prov_identity_eligible_chk",
    ]) {
      expect(SQL).toContain(name);
    }

    for (const column of HASH_COLUMNS) {
      expect(NORMALIZED_SQL).toContain(`${column} is null or ${column} ~ '^[0-9a-f]{64}$'`);
    }
    expect(NORMALIZED_SQL).toContain("code_sha is null or code_sha = 'unknown' or code_sha ~ '^[0-9a-f]{7,64}$'");
    expect(NORMALIZED_SQL).toContain("selection_protocol_id is null or selection_protocol_id ~ '^[a-z][a-z0-9._-]{0,63}$'");
    expect(NORMALIZED_SQL).toContain("trial_count is null or trial_count >= 1");
    expect(NORMALIZED_SQL).toContain("as_of_ts is null or forecast_issued_at is null or as_of_ts <= forecast_issued_at");
    expect(NORMALIZED_SQL).toContain("create unique index if not exists idx_sfs_forecast_instance_id_unique");
    expect(NORMALIZED_SQL).toContain("where forecast_instance_id is not null");
    expect(NORMALIZED_SQL).toContain("create index if not exists idx_sfs_calibration_pool_id");
    expect(NORMALIZED_SQL).toContain("where calibration_pool_id is not null");
  });

  it("keeps legacy and sparse rows valid while rejecting invalid hash/timing/trial examples", () => {
    expect(satisfiesMigrationChecks({})).toBe(true);
    expect(satisfiesMigrationChecks({ predictorId: valid64 })).toBe(true);
    expect(satisfiesMigrationChecks({ predictorId: "A".repeat(64) })).toBe(false);
    expect(satisfiesMigrationChecks({ predictorId: "a".repeat(63) })).toBe(false);
    expect(satisfiesMigrationChecks({ trialCount: 1 })).toBe(true);
    expect(satisfiesMigrationChecks({ trialCount: 0 })).toBe(false);
    expect(satisfiesMigrationChecks({ trialCount: -1 })).toBe(false);
    expect(satisfiesMigrationChecks({ trialCount: 1.5 })).toBe(false);
    expect(satisfiesMigrationChecks({
      asOfTs: "2026-02-11T00:00:00Z",
      forecastIssuedAt: "2026-02-10T00:00:00Z",
    })).toBe(false);
  });

  it("matches manual, manual_override, engine lineage, and identity-eligible behavior", () => {
    expect(satisfiesMigrationChecks({ provenanceKind: "manual", provenanceCompleteness: "manual" })).toBe(true);
    expect(satisfiesMigrationChecks({ provenanceKind: "manual", predictorId: valid64 })).toBe(false);
    expect(satisfiesMigrationChecks({ provenanceKind: "manual", forecastIdentityEligible: true })).toBe(false);

    expect(satisfiesMigrationChecks({
      provenanceKind: "manual_override",
      derivedFromInputHash: valid64,
      forecastIdentityEligible: false,
    })).toBe(true);
    expect(satisfiesMigrationChecks({ provenanceKind: "manual_override" })).toBe(false);
    expect(satisfiesMigrationChecks({
      provenanceKind: "manual_override",
      derivedFromInputHash: valid64,
      forecastIdentityEligible: true,
    })).toBe(false);

    expect(satisfiesMigrationChecks({ provenanceKind: "engine", derivedFromInputHash: valid64 })).toBe(false);
    expect(satisfiesMigrationChecks(completeEngineRow())).toBe(true);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), codeSha: "unknown" })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), calibrationPoolId: null })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), trialCount: 0 })).toBe(false);
    expect(satisfiesMigrationChecks({ ...completeEngineRow(), provenanceCompleteness: "legacy" })).toBe(false);
    expect(satisfiesMigrationChecks({
      ...completeEngineRow(),
      forecastIdentityEligible: false,
      provenanceCompleteness: "missing_code_sha",
    })).toBe(true);
  });
});
