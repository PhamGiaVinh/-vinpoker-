import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSIONED_MIGRATION = /^(\d{14})_.+\.sql$/u;
const SOURCE_READY = "FLOOR_V3_MIGRATION_PROMOTION_SOURCE_READY";
const STATIC_READY = "PROMOTION_STATIC_PASS";

function sha256(path) {
  // Git stores these SQL files with LF; normalize checkout line endings so the
  // promotion manifest has the same digest on Windows and Linux runners.
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function listActiveMigrations(migrationDirectory) {
  const rows = [];
  for (const entry of readdirSync(migrationDirectory, { withFileTypes: true })) {
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
  if (manifest.schemaVersion !== 1) throw new Error("unsupported promotion manifest schema");
  if (!Array.isArray(manifest.floorActiveAllowlist) || !Array.isArray(manifest.heldSources)) {
    throw new Error("promotion manifest must contain floorActiveAllowlist and heldSources");
  }
  return manifest;
}

function evaluatePromotion({
  migrationDirectory,
  archiveDirectory,
  manifestPath,
  appliedVersions = null,
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
      pending: [],
      extraPending: [],
      floorPending: [],
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

  const floorVersions = manifest.floorActiveAllowlist.map((entry) => entry.version);
  if (new Set(floorVersions).size !== floorVersions.length) {
    failures.push("duplicate Floor version in promotion manifest");
  }
  if (floorVersions.some((version, index) => index > 0 && version <= floorVersions[index - 1])) {
    failures.push("Floor allowlist is not in strict migration order");
  }

  for (const expected of manifest.floorActiveAllowlist) {
    const rows = activeByVersion.get(expected.version) ?? [];
    if (rows.length !== 1 || rows[0].filename !== expected.filename) {
      failures.push(`Floor allowlist mismatch for ${expected.version}: expected ${expected.filename}`);
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
    const archivePath = join(archiveDirectory, held.filename);
    if (!existsSync(archivePath)) {
      failures.push(`held migration archive missing: ${held.filename}`);
    } else if (sha256(archivePath) !== held.sha256) {
      failures.push(`held migration hash drift: ${held.filename}`);
    }
  }

  const expectedFloor = new Set(floorVersions);
  const pending = appliedVersions
    ? active.filter((row) => !appliedVersions.has(row.version)).map((row) => row.version)
    : null;
  const extraPending = pending
    ? pending.filter((version) => !expectedFloor.has(version))
    : [];
  const floorPending = pending
    ? pending.filter((version) => expectedFloor.has(version))
    : [];

  if (appliedVersions) {
    if (extraPending.length > 0) {
      failures.push(`unrelated pending migrations: ${extraPending.join(", ")}`);
    }
    if (floorPending.length !== floorVersions.length || floorPending.some((version, index) => version !== floorVersions[index])) {
      failures.push(`Floor pending set mismatch: expected ${floorVersions.join(", ")}, actual ${floorPending.join(", ")}`);
    }
  }

  let status = SOURCE_READY;
  const hasManifestFailure = failures.some(
    (failure) =>
      !failure.startsWith("unrelated pending migrations:") &&
      !failure.startsWith("Floor pending set mismatch:"),
  );
  if (hasManifestFailure) {
    status = "PROMOTION_MANIFEST_HASH_DRIFT";
  } else if (failures.some((failure) => failure.startsWith("unrelated pending migrations:"))) {
    status = "FLOOR_V3_PROMOTION_BLOCKED_EXTRA_PENDING";
  } else if (failures.some((failure) => failure.startsWith("Floor pending set mismatch:"))) {
    status = "FLOOR_V3_PROMOTION_BLOCKED_LEDGER_UNAVAILABLE";
  } else if (!appliedVersions) {
    status = STATIC_READY;
  }

  return {
    status,
    pass: failures.length === 0,
    failures,
    activeCount: active.length,
    floorVersions,
    pending,
    floorPending,
    extraPending,
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

export { evaluatePromotion, listActiveMigrations, readManifest };

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoRoot = resolve(dirname(scriptPath), "..", "..");
  const args = parseArgs(process.argv.slice(2));
  const migrationDirectory = resolve(args.get("migrations") ?? join(repoRoot, "supabase", "migrations"));
  const archiveDirectory = resolve(args.get("archive") ?? join(repoRoot, "supabase", "migration-archive", "never-apply"));
  const manifestPath = resolve(args.get("manifest") ?? join(archiveDirectory, "floor-v3-migration-promotion.manifest.json"));
  let appliedVersions = null;
  if (args.has("ledger")) {
    try {
      const ledger = JSON.parse(readFileSync(resolve(args.get("ledger")), "utf8"));
      if (!Array.isArray(ledger.appliedVersions)) throw new Error("ledger.appliedVersions must be an array");
      appliedVersions = new Set(ledger.appliedVersions);
    } catch (error) {
      console.error(`FLOOR_V3_PROMOTION_FAIL ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  } else if (!args.has("static")) {
    console.error("FLOOR_V3_PROMOTION_FAIL ledger input is required; use --static only for catalog checks");
    process.exitCode = 1;
  }
  if (process.exitCode !== 1) {
    const result = evaluatePromotion({ migrationDirectory, archiveDirectory, manifestPath, appliedVersions });
    const output = {
      status: result.status,
      activeCount: result.activeCount,
      heldCount: result.heldCount,
      floorVersions: result.floorVersions,
      pending: result.pending,
      floorPending: result.floorPending,
      extraPending: result.extraPending,
      failures: result.failures,
    };
    if (args.has("json")) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`FLOOR_V3_PROMOTION_${result.pass ? "PASS" : "FAIL"} ${result.status}`);
      for (const failure of result.failures) console.error(`FLOOR_V3_PROMOTION_FAIL ${failure}`);
    }
    process.exitCode = result.pass ? 0 : 1;
  }
}
