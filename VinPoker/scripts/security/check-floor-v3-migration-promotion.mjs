import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSIONED_MIGRATION = /^(\d{14})_.+\.sql$/u;
const CLI_VISIBLE_NON_VERSIONED_MIGRATION = /^\d+_.+\.sql$/u;
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

function readReconciliationManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.kind !== "floor-v3-catalog-reconciliation") {
    throw new Error("unsupported Floor V3 reconciliation manifest schema");
  }
  for (const field of [
    "remoteLedgerVersions",
    "remoteHistoryReceipts",
    "historicalSources",
    "pendingSources",
    "floorActiveAllowlist",
  ]) {
    if (!Array.isArray(manifest[field])) {
      throw new Error(`reconciliation manifest must contain ${field}[]`);
    }
  }
  if (!/^\d{14}$/u.test(manifest.registeredProductionHead ?? "")) {
    throw new Error("reconciliation manifest registeredProductionHead is required");
  }
  return manifest;
}

function isCommentOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/--[^\r\n]*/gu, "")
    .trim().length === 0;
}

function reconciliationPath(root, value) {
  return value && resolve(value).startsWith(resolve(root))
    ? resolve(value)
    : resolve(root, value);
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
  reconciliationManifestPath = null,
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
  for (const entry of readdirSync(migrationDirectory, { withFileTypes: true })) {
    if (entry.isFile() && CLI_VISIBLE_NON_VERSIONED_MIGRATION.test(entry.name) && !VERSIONED_MIGRATION.test(entry.name)) {
      failures.push(`CLI-visible non-versioned migration remains active: ${entry.name}`);
    }
  }
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

  if (reconciliationManifestPath) {
    try {
      const reconciliation = readReconciliationManifest(reconciliationManifestPath);
      const reconciliationRoot = resolve(
        dirname(reconciliationManifestPath),
        "..",
        "..",
      );
      const remoteVersions = new Set(
        reconciliation.remoteLedgerVersions.map((entry) => entry.version),
      );
      const floorAllowlist = new Set(expectedFloorFilenames);
      const receiptByVersion = new Map();
      for (const receipt of reconciliation.remoteHistoryReceipts) {
        if (receiptByVersion.has(receipt.remoteVersion)) {
          failures.push(`duplicate remote history receipt: ${receipt.remoteVersion}`);
        }
        receiptByVersion.set(receipt.remoteVersion, receipt);
        const activeReceipt = activeByFilename.get(receipt.receiptFilename);
        if (!activeReceipt || activeReceipt.version !== receipt.remoteVersion) {
          failures.push(`remote history receipt is not active at its ledger version: ${receipt.receiptFilename}`);
        } else {
          const source = readFileSync(activeReceipt.path, "utf8");
          if (!isCommentOnly(source)) {
            failures.push(`remote history receipt is not comment-only: ${receipt.receiptFilename}`);
          }
          if (sha256(activeReceipt.path) !== receipt.receiptSha256) {
            failures.push(`remote history receipt hash drift: ${receipt.receiptFilename}`);
          }
        }
        if (!remoteVersions.has(receipt.remoteVersion)) {
          failures.push(`remote history receipt lacks remote ledger evidence: ${receipt.remoteVersion}`);
        }
      }

      for (const source of reconciliation.historicalSources) {
        if (activeByFilename.has(source.filename)) {
          failures.push(`historical migration remains replayable: ${source.filename}`);
        }
        const archivePath = reconciliationPath(reconciliationRoot, source.archivePath);
        if (!existsSync(archivePath)) {
          failures.push(`historical archive missing: ${source.filename}`);
        } else if (sha256(archivePath) !== source.sha256) {
          failures.push(`historical archive hash drift: ${source.filename}`);
        }
      }

      for (const pending of reconciliation.pendingSources) {
        if (activeByFilename.has(pending.filename) || activeByVersion.has(pending.version)) {
          failures.push(`pending migration is active: ${pending.filename}`);
        }
        const pendingPath = reconciliationPath(reconciliationRoot, pending.pendingPath);
        if (!existsSync(pendingPath)) {
          failures.push(`pending migration source missing: ${pending.filename}`);
        } else if (sha256(pendingPath) !== pending.sha256) {
          failures.push(`pending migration hash drift: ${pending.filename}`);
        }
      }
      for (const historical of reconciliation.nonVersionedSources ?? []) {
        if (existsSync(join(migrationDirectory, historical.filename))) {
          failures.push(`CLI-visible historical helper remains active: ${historical.filename}`);
        }
      }

      const head = reconciliation.registeredProductionHead;
      for (const row of active) {
        if (floorAllowlist.has(row.filename)) continue;
        if (!remoteVersions.has(row.version)) {
          failures.push(
            row.version < head
              ? `replayable historical migration not reconciled: ${row.filename}`
              : `unexpected active migration outside Floor allowlist: ${row.filename}`,
          );
        }
      }
      const expectedRemoteOnly = reconciliation.remoteLedgerVersions.filter(
        (entry) => !active.some((row) => row.version === entry.version && !row.filename.includes("_remote_history_receipt.sql")),
      );
      for (const entry of expectedRemoteOnly) {
        const receipt = receiptByVersion.get(entry.version);
        if (!receipt) failures.push(`missing remote history receipt: ${entry.version}`);
      }
      if (reconciliation.counts?.historicalSources !== reconciliation.historicalSources.length) {
        failures.push("reconciliation historical source count mismatch");
      }
    } catch (error) {
      failures.push(
        `reconciliation manifest invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
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
  readReconciliationManifest,
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
  const reconciliationManifestPath = resolve(
    args.get("reconciliation") ??
      join(repoRoot, "supabase", "migration-archive", "floor-v3-catalog-reconciliation.manifest.json"),
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
      reconciliationManifestPath: existsSync(reconciliationManifestPath)
        ? reconciliationManifestPath
        : null,
    });
    if (args.has("static") && !existsSync(reconciliationManifestPath)) {
      result.pass = false;
      result.failures.push("reconciliation manifest is required for static catalog checks");
      result.status = "FLOOR_V3_PROMOTION_RECONCILIATION_FAIL";
    }
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
