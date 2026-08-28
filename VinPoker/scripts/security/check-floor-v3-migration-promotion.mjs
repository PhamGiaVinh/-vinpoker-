import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSIONED_MIGRATION = /^(\d{14})_.+\.sql$/u;
const SOURCE_READY = "FLOOR_V3_MIGRATION_PROMOTION_SOURCE_READY";
const STATIC_READY = "PROMOTION_STATIC_PASS";
const CLI_BLOCKED = "FLOOR_V3_PROMOTION_BLOCKED_SUPABASE_CLI";
const ACTUAL_EXTRA_PUSH = "FLOOR_V3_PROMOTION_BLOCKED_ACTUAL_EXTRA_PUSH";
const HISTORY_SYNC_BLOCKED = "FLOOR_V3_PROMOTION_BLOCKED_HISTORY_SYNC";

function sha256(path) {
  // Git stores these SQL files with LF; normalize checkout line endings so the
  // promotion manifest has the same digest on Windows and Linux runners.
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function listActiveMigrations(migrationDirectory) {
  const rows = [];
  for (const entry of readdirSync(migrationDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(VERSIONED_MIGRATION);
    if (!match) continue;
    rows.push({
      version: match[1],
      filename: entry.name,
      path: join(migrationDirectory, entry.name),
      sha256: sha256(join(migrationDirectory, entry.name)),
    });
  }
  return rows.sort((left, right) => left.version.localeCompare(right.version));
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1)
    throw new Error("unsupported promotion manifest schema");
  if (
    !Array.isArray(manifest.floorActiveAllowlist) ||
    !Array.isArray(manifest.heldSources)
  ) {
    throw new Error(
      "promotion manifest must contain floorActiveAllowlist and heldSources",
    );
  }
  return manifest;
}

function normalizePushPlanEntry(entry) {
  if (typeof entry === "string") {
    const filename = entry.split(/[\\/]/u).at(-1);
    const match = filename?.match(VERSIONED_MIGRATION);
    return match ? { version: match[1], filename } : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const rawFilename = entry.filename ?? entry.name ?? entry.path;
  if (typeof rawFilename !== "string") return null;
  const filename = rawFilename.split(/[\\/]/u).at(-1);
  const match = filename?.match(VERSIONED_MIGRATION);
  if (!match) return null;
  const version = typeof entry.version === "string" ? entry.version : match[1];
  return version === match[1] ? { version, filename } : null;
}

function readPushPlanReceipt(pushPlanPath) {
  const receipt = JSON.parse(readFileSync(pushPlanPath, "utf8"));
  if (receipt.commandMode !== "dry-run") {
    throw new Error("push-plan receipt commandMode must be dry-run");
  }
  if (receipt.includeAll !== false) {
    throw new Error("push-plan receipt must have includeAll=false");
  }
  if (
    typeof receipt.targetProjectRef !== "string" ||
    receipt.targetProjectRef.length === 0
  ) {
    throw new Error("push-plan receipt targetProjectRef is required");
  }
  if (!Array.isArray(receipt.plannedMigrations)) {
    throw new Error("push-plan receipt must contain plannedMigrations[]");
  }
  const plan = receipt.plannedMigrations.map(normalizePushPlanEntry);
  if (plan.some((entry) => !entry))
    throw new Error("push-plan receipt contains an invalid migration entry");
  return { ...receipt, plannedMigrations: plan };
}

function classifyMigrationLineage({
  sourceVersion,
  sourceFilename,
  ledgerEntries = [],
  schemaEffects = "UNKNOWN",
}) {
  const exact = ledgerEntries.find((entry) => entry?.version === sourceVersion);
  if (exact) {
    return {
      classification: "CANONICAL_APPLIED",
      ledgerVersion: exact.version,
      ledgerName: exact.name ?? null,
    };
  }
  const alias = ledgerEntries.find(
    (entry) =>
      entry?.name === sourceFilename && entry?.version !== sourceVersion,
  );
  if (alias) {
    return {
      classification: "ALIAS_APPLIED",
      ledgerVersion: alias.version,
      ledgerName: alias.name ?? sourceFilename,
    };
  }
  if (schemaEffects === "PARTIAL")
    return {
      classification: "PARTIAL_STATE",
      ledgerVersion: null,
      ledgerName: null,
    };
  if (schemaEffects === "PRESENT") {
    return {
      classification: "SCHEMA_EFFECT_PRESENT_LEDGER_PROVENANCE_UNKNOWN",
      ledgerVersion: null,
      ledgerName: null,
    };
  }
  return {
    classification: "NOT_APPLIED",
    ledgerVersion: null,
    ledgerName: null,
  };
}

function evaluatePromotion({
  migrationDirectory,
  archiveDirectory,
  manifestPath,
  appliedVersions = null,
  pushPlan = null,
}) {
  const failures = [];
  let manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (error) {
    return {
      status: "PROMOTION_MANIFEST_INVALID",
      pass: false,
      failures: [error instanceof Error ? error.message : String(error)],
      activeCount: 0,
      heldCount: 0,
      floorVersions: [],
      historicalLedgerGaps: [],
      actualDefaultPushPlan: null,
    };
  }

  const active = listActiveMigrations(migrationDirectory);
  const activeByFilename = new Map(active.map((row) => [row.filename, row]));
  const activeByVersion = new Map();
  for (const row of active) {
    const rows = activeByVersion.get(row.version) ?? [];
    rows.push(row);
    activeByVersion.set(row.version, rows);
  }

  const floorVersions = manifest.floorActiveAllowlist.map(
    (entry) => entry.version,
  );
  if (new Set(floorVersions).size !== floorVersions.length) {
    failures.push("duplicate Floor version in promotion manifest");
  }
  if (
    floorVersions.some(
      (version, index) => index > 0 && version <= floorVersions[index - 1],
    )
  ) {
    failures.push("Floor allowlist is not in strict migration order");
  }

  for (const expected of manifest.floorActiveAllowlist) {
    const rows = activeByVersion.get(expected.version) ?? [];
    if (rows.length !== 1 || rows[0].filename !== expected.filename) {
      failures.push(
        `Floor allowlist mismatch for ${expected.version}: expected ${expected.filename}`,
      );
      continue;
    }
    if (rows[0].sha256 !== expected.sha256) {
      failures.push(`Floor migration hash drift: ${expected.filename}`);
    }
  }

  for (const held of manifest.heldSources) {
    if (activeByFilename.has(held.filename)) {
      failures.push(`held migration is active: ${held.filename}`);
    }
    if (
      !held.lineageEvidence ||
      typeof held.lineageEvidence.provenance !== "string"
    ) {
      failures.push(
        `held migration lineage evidence missing: ${held.filename}`,
      );
    }
    if (
      typeof held.classification !== "string" ||
      /UNAPPLIED/u.test(held.classification)
    ) {
      failures.push(
        `held migration has obsolete unapplied classification: ${held.filename}`,
      );
    }
    const archivePath = join(archiveDirectory, held.filename);
    if (!existsSync(archivePath)) {
      failures.push(`held migration archive missing: ${held.filename}`);
    } else if (sha256(archivePath) !== held.sha256) {
      failures.push(`held migration hash drift: ${held.filename}`);
    }
  }

  const expectedFloorFilenames = manifest.floorActiveAllowlist.map(
    (entry) => entry.filename,
  );
  const historicalLedgerGaps = appliedVersions
    ? active
        .filter((row) => !appliedVersions.has(row.version))
        .map((row) => ({
          version: row.version,
          filename: row.filename,
        }))
    : null;

  let actualDefaultPushPlan = null;
  if (pushPlan) {
    if (
      manifest.targetProjectRef &&
      pushPlan.targetProjectRef !== manifest.targetProjectRef
    ) {
      failures.push(
        `push-plan target project mismatch: expected ${manifest.targetProjectRef}`,
      );
    }
    const plannedMigrations = Array.isArray(pushPlan)
      ? pushPlan.map(normalizePushPlanEntry)
      : pushPlan.plannedMigrations?.map(normalizePushPlanEntry);
    if (!plannedMigrations || plannedMigrations.some((entry) => !entry)) {
      failures.push("invalid default db push dry-run plan");
    } else {
      actualDefaultPushPlan = plannedMigrations;
      const actualFilenames = plannedMigrations.map((entry) => entry.filename);
      const extra = actualFilenames.filter(
        (filename) => !expectedFloorFilenames.includes(filename),
      );
      const missing = expectedFloorFilenames.filter(
        (filename) => !actualFilenames.includes(filename),
      );
      if (extra.length > 0) {
        failures.push(
          `actual default push includes unrelated migrations: ${extra.join(", ")}`,
        );
      } else if (
        missing.length > 0 ||
        actualFilenames.some(
          (filename, index) => filename !== expectedFloorFilenames[index],
        )
      ) {
        failures.push(
          `actual default push plan mismatch: expected ${expectedFloorFilenames.join(", ")}, actual ${actualFilenames.join(", ")}`,
        );
      }
    }
  }

  const hasManifestFailure = failures.some(
    (failure) =>
      !failure.startsWith(
        "actual default push includes unrelated migrations:",
      ) && !failure.startsWith("actual default push plan mismatch:"),
  );
  let status = SOURCE_READY;
  if (hasManifestFailure) {
    status = "PROMOTION_MANIFEST_HASH_DRIFT";
  } else if (
    failures.some((failure) =>
      failure.startsWith("actual default push includes unrelated migrations:"),
    )
  ) {
    status = ACTUAL_EXTRA_PUSH;
  } else if (
    failures.some((failure) =>
      failure.startsWith("actual default push plan mismatch:"),
    )
  ) {
    status = HISTORY_SYNC_BLOCKED;
  } else if (!pushPlan) {
    status = STATIC_READY;
  }

  return {
    status,
    pass: failures.length === 0,
    failures,
    activeCount: active.length,
    floorVersions,
    pending: historicalLedgerGaps?.map((row) => row.version) ?? null,
    historicalLedgerGaps,
    actualDefaultPushPlan,
    heldCount: manifest.heldSources.length,
    manifest,
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "static" || key === "json") args.set(key, true);
    else args.set(key, argv[++index]);
  }
  return args;
}

export {
  classifyMigrationLineage,
  evaluatePromotion,
  listActiveMigrations,
  normalizePushPlanEntry,
  readManifest,
  readPushPlanReceipt,
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoRoot = resolve(dirname(scriptPath), "..", "..");
  const args = parseArgs(process.argv.slice(2));
  const migrationDirectory = resolve(
    args.get("migrations") ?? join(repoRoot, "supabase", "migrations"),
  );
  const archiveDirectory = resolve(
    args.get("archive") ??
      join(repoRoot, "supabase", "migration-archive", "never-apply"),
  );
  const manifestPath = resolve(
    args.get("manifest") ??
      join(archiveDirectory, "floor-v3-migration-promotion.manifest.json"),
  );
  let appliedVersions = null;
  let pushPlan = null;
  if (args.has("ledger")) {
    try {
      const ledger = JSON.parse(
        readFileSync(resolve(args.get("ledger")), "utf8"),
      );
      if (Array.isArray(ledger.appliedMigrations)) {
        appliedVersions = new Set(
          ledger.appliedMigrations
            .map((entry) => entry.version)
            .filter(Boolean),
        );
      } else if (Array.isArray(ledger.appliedVersions)) {
        appliedVersions = new Set(ledger.appliedVersions);
      } else {
        throw new Error(
          "ledger.appliedVersions or ledger.appliedMigrations is required",
        );
      }
    } catch (error) {
      console.error(
        `FLOOR_V3_PROMOTION_FAIL ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  } else if (!args.has("static")) {
    console.error(
      "FLOOR_V3_PROMOTION_FAIL ledger input is required; use --static only for catalog checks",
    );
    process.exitCode = 1;
  }
  if (args.has("push-plan")) {
    try {
      pushPlan = readPushPlanReceipt(resolve(args.get("push-plan")));
    } catch (error) {
      console.error(
        `FLOOR_V3_PROMOTION_FAIL ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
  if (process.exitCode !== 1) {
    const result = evaluatePromotion({
      migrationDirectory,
      archiveDirectory,
      manifestPath,
      appliedVersions,
      pushPlan,
    });
    if (!args.has("static") && !pushPlan) {
      result.status = CLI_BLOCKED;
      result.pass = false;
      result.failures.push(
        "authoritative default db push --dry-run receipt is required",
      );
    }
    const output = {
      status: result.status,
      activeCount: result.activeCount,
      heldCount: result.heldCount,
      floorVersions: result.floorVersions,
      historicalLedgerGaps: result.historicalLedgerGaps,
      actualDefaultPushPlan: result.actualDefaultPushPlan,
      failures: result.failures,
    };
    if (args.has("json")) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(
        `FLOOR_V3_PROMOTION_${result.pass ? "PASS" : "FAIL"} ${result.status}`,
      );
      for (const failure of result.failures)
        console.error(`FLOOR_V3_PROMOTION_FAIL ${failure}`);
    }
    process.exitCode = result.pass ? 0 : 1;
  }
}
