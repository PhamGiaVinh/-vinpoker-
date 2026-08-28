import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  classifyMigrationLineage,
  evaluatePromotion,
  normalizePushPlanEntry,
  readPushPlanReceipt,
} from "../../scripts/security/check-floor-v3-migration-promotion.mjs";

const FLOOR = [
  ["20270113000002", "20270113000002_floor.sql", "floor two"],
  ["20270113000003", "20270113000003_floor.sql", "floor three"],
  ["20270113000005", "20270113000005_floor.sql", "floor five"],
  ["20270113000006", "20270113000006_floor.sql", "floor six"],
];
const HELD = [
  ["20270113000000", "20270113000000_payroll.sql", "payroll zero"],
  ["20270113000001", "20270113000001_payroll.sql", "payroll one"],
  ["20270113000004", "20270113000004_payroll_telegram.sql", "payroll telegram"],
];

function hash(source) {
  return createHash("sha256").update(source).digest("hex");
}

function fixture({ extra = [], activeHeld = [], mutateHeld = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-floor-v3-promotion-"));
  const migrations = join(root, "migrations");
  const archive = join(root, "archive");
  mkdirSync(migrations);
  mkdirSync(archive);

  const floorActiveAllowlist = FLOOR.map(
    ([version, filename, source], index) => {
      writeFileSync(join(migrations, filename), source, "utf8");
      return {
        version,
        filename,
        sha256: hash(source),
        dependencies: index === 0 ? [] : [FLOOR[index - 1][0]],
      };
    },
  );
  const heldSources = HELD.map(([originalVersion, filename, source]) => {
    const archiveSource =
      mutateHeld && originalVersion === HELD[0][0] ? `${source} drift` : source;
    writeFileSync(join(archive, filename), archiveSource, "utf8");
    return {
      originalVersion,
      filename,
      originalPath: `supabase/migrations/${filename}`,
      archivePath: `supabase/migration-archive/never-apply/${filename}`,
      sha256: hash(source),
      domain: filename.includes("telegram") ? "payroll-telegram" : "payroll",
      reason: "fixture lineage evidence",
      classification:
        originalVersion === HELD[0][0]
          ? "DO_NOT_REPLAY_REMOTE_EQUIVALENT_SCHEMA_PROVENANCE_UNKNOWN"
          : "ALIAS_APPLIED_DO_NOT_REPLAY_HISTORICAL_SOURCE_PRESERVED",
      replacementStatus: "ACTUAL_DELTA_ONLY",
      restoreCondition: "inspect live contract first",
      lineageEvidence: {
        exactLedgerVersion: null,
        aliasLedgerVersion:
          originalVersion === HELD[0][0] ? null : `alias-${originalVersion}`,
        schemaEffects: "PRESENT_WITH_READ_ONLY_EVIDENCE",
        provenance:
          originalVersion === HELD[0][0] ? "UNKNOWN" : "ALIAS_APPLIED",
      },
    };
  });
  for (const [, filename, source] of activeHeld)
    writeFileSync(join(migrations, filename), source, "utf8");
  for (const [, filename, source] of extra)
    writeFileSync(join(migrations, filename), source, "utf8");

  const manifestPath = join(root, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      promotion: "floor-v3",
      targetProjectRef: "orlesggcjamwuknxwcpk",
      floorActiveAllowlist,
      heldSources,
    }),
    "utf8",
  );
  return { root, migrations, archive, manifestPath };
}

function runFixture(options, appliedVersions, pushPlan = null) {
  const paths = fixture(options);
  try {
    return evaluatePromotion({
      migrationDirectory: paths.migrations,
      archiveDirectory: paths.archive,
      manifestPath: paths.manifestPath,
      appliedVersions: appliedVersions ? new Set(appliedVersions) : null,
      pushPlan,
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
}

function runReconciliationFixture({ activeHistorical = false, activePending = false } = {}) {
  const paths = fixture({});
  const historicalFilename = "20260605000001_legacy.sql";
  const historicalSource = "-- preserved historical source\n";
  const historicalArchive = join(paths.archive, historicalFilename);
  writeFileSync(historicalArchive, historicalSource, "utf8");
  if (activeHistorical)
    writeFileSync(join(paths.migrations, historicalFilename), historicalSource, "utf8");

  const pendingFilename = "20270113000007_pending.sql";
  const pendingSource = "-- pending owner-gated source\n";
  const pendingDirectory = join(paths.root, "pending");
  mkdirSync(pendingDirectory);
  const pendingPath = join(pendingDirectory, pendingFilename);
  writeFileSync(pendingPath, pendingSource, "utf8");
  if (activePending)
    writeFileSync(join(paths.migrations, pendingFilename), pendingSource, "utf8");

  const remoteVersion = "20260428144425";
  const remoteReceiptFilename = `${remoteVersion}_remote_history_receipt.sql`;
  const remoteReceiptSource = `-- remote history receipt\n-- version ${remoteVersion}\n`;
  writeFileSync(join(paths.migrations, remoteReceiptFilename), remoteReceiptSource, "utf8");
  const reconciliationPath = join(paths.root, "reconciliation.json");
  writeFileSync(
    reconciliationPath,
    JSON.stringify({
      schemaVersion: 1,
      kind: "floor-v3-catalog-reconciliation",
      registeredProductionHead: "20270112000008",
      remoteLedgerVersions: [{ version: remoteVersion, name: "legacy-remote" }],
      remoteHistoryReceipts: [{
        remoteVersion,
        remoteName: "legacy-remote",
        receiptFilename: remoteReceiptFilename,
        receiptSha256: hash(remoteReceiptSource),
      }],
      historicalSources: [{
        originalVersion: "20260605000001",
        filename: historicalFilename,
        archivePath: historicalArchive,
        sha256: hash(historicalSource),
      }],
      pendingSources: [{
        version: "20270113000007",
        filename: pendingFilename,
        pendingPath,
        sha256: hash(pendingSource),
      }],
      floorActiveAllowlist: FLOOR.map(([version, filename]) => ({ version, filename })),
      counts: { historicalSources: 1 },
    }),
    "utf8",
  );
  try {
    return evaluatePromotion({
      migrationDirectory: paths.migrations,
      archiveDirectory: paths.archive,
      manifestPath: paths.manifestPath,
      reconciliationManifestPath: reconciliationPath,
      pushPlan: exactPlan,
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
}

const exactPlan = {
  commandMode: "dry-run",
  includeAll: false,
  targetProjectRef: "orlesggcjamwuknxwcpk",
  plannedMigrations: FLOOR.map(([version, filename]) => ({
    version,
    filename,
  })),
};

test("historical ledger gaps are diagnostic, not executable pending migrations", () => {
  const result = runFixture({}, ["20270101000000"], exactPlan);
  assert.equal(result.pass, true);
  assert.equal(result.status, "FLOOR_V3_MIGRATION_PROMOTION_SOURCE_READY");
  assert.equal(result.historicalLedgerGaps.length, 4);
  assert.deepEqual(
    result.actualDefaultPushPlan.map(({ filename }) => filename),
    FLOOR.map(([, filename]) => filename),
  );
});

test("requires an authoritative default push dry-run receipt for remote readiness", () => {
  const result = runFixture({}, ["20270101000000"]);
  assert.equal(result.pass, true);
  assert.equal(result.status, "PROMOTION_STATIC_PASS");
  assert.equal(result.actualDefaultPushPlan, null);
});

test("fails closed when the dry-run contains an unrelated migration", () => {
  const result = runFixture({}, [], {
    ...exactPlan,
    plannedMigrations: [
      ...exactPlan.plannedMigrations,
      { version: "20270113000007", filename: "20270113000007_unrelated.sql" },
    ],
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, "FLOOR_V3_PROMOTION_BLOCKED_ACTUAL_EXTRA_PUSH");
  assert.match(
    result.failures.join("\n"),
    /actual default push includes unrelated migrations/,
  );
});

test("fails closed when the dry-run is missing or out of order", () => {
  const result = runFixture({}, [], {
    ...exactPlan,
    plannedMigrations: exactPlan.plannedMigrations.slice(1),
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, "FLOOR_V3_PROMOTION_BLOCKED_HISTORY_SYNC");
});

test("fails closed instead of replaying a held Payroll source", () => {
  const result = runFixture({ activeHeld: [HELD[0]] }, [], exactPlan);
  assert.equal(result.pass, false);
  assert.equal(result.status, "PROMOTION_MANIFEST_HASH_DRIFT");
  assert.match(result.failures.join("\n"), /held migration is active/);
});

test("detects archival hash drift before any deployment can be planned", () => {
  const result = runFixture({ mutateHeld: true }, [], exactPlan);
  assert.equal(result.pass, false);
  assert.equal(result.status, "PROMOTION_MANIFEST_HASH_DRIFT");
  assert.match(result.failures.join("\n"), /held migration hash drift/);
});

test("normalizes a CLI path entry to its safe basename", () => {
  assert.deepEqual(
    normalizePushPlanEntry("supabase/migrations/20270113000002_floor.sql"),
    {
      version: "20270113000002",
      filename: "20270113000002_floor.sql",
    },
  );
});

test("rejects non-dry-run or include-all receipts", () => {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-floor-v3-receipt-"));
  const path = join(root, "receipt.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({ ...exactPlan, includeAll: true }),
      "utf8",
    );
    assert.throws(() => readPushPlanReceipt(path), /includeAll=false/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifies canonical, alias, schema-only and absent lineage separately", () => {
  assert.equal(
    classifyMigrationLineage({
      sourceVersion: "20270113000001",
      sourceFilename: "20270113000001_payroll.sql",
      ledgerEntries: [
        { version: "20270113000001", name: "20270113000001_payroll.sql" },
      ],
    }).classification,
    "CANONICAL_APPLIED",
  );
  assert.equal(
    classifyMigrationLineage({
      sourceVersion: "20270113000001",
      sourceFilename: "20270113000001_payroll.sql",
      ledgerEntries: [
        { version: "20260827181742", name: "20270113000001_payroll.sql" },
      ],
    }).classification,
    "ALIAS_APPLIED",
  );
  assert.equal(
    classifyMigrationLineage({
      sourceVersion: "20270113000000",
      sourceFilename: "20270113000000_payroll.sql",
      schemaEffects: "PRESENT",
    }).classification,
    "SCHEMA_EFFECT_PRESENT_LEDGER_PROVENANCE_UNKNOWN",
  );
  assert.equal(
    classifyMigrationLineage({
      sourceVersion: "20270113000002",
      sourceFilename: "20270113000002_floor.sql",
    }).classification,
    "NOT_APPLIED",
  );
});

test("fails when a historical migration remains replayable", () => {
  const result = runReconciliationFixture({ activeHistorical: true });
  assert.equal(result.pass, false);
  assert.match(result.failures.join("\n"), /historical migration remains replayable/);
});

test("accepts a comment-only remote history receipt with ledger evidence", () => {
  const result = runReconciliationFixture();
  assert.equal(result.pass, true);
});

test("fails when an unrelated pending migration is active", () => {
  const result = runReconciliationFixture({ activePending: true });
  assert.equal(result.pass, false);
  assert.match(result.failures.join("\n"), /pending migration is active/);
});
