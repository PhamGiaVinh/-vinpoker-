import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findMigrationCatalogProblems } from "./check-migration-catalog.mjs";

const MIGRATION_PATTERN = /^(\d{14})_(.+)\.sql$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export function normalizeSql(source) {
  return source.replace(/\r\n?/gu, "\n");
}

export function normalizedSqlSha256(source) {
  return createHash("sha256").update(normalizeSql(source), "utf8").digest("hex");
}

export function canonicalManifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function readMigrationRows(directories) {
  const rows = [];
  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(MIGRATION_PATTERN);
      if (!match) continue;
      const source = readFileSync(join(directory, entry.name), "utf8");
      rows.push({
        version: match[1],
        semanticName: match[2],
        filename: entry.name,
        path: join(directory, entry.name),
        normalizedSqlSha256: normalizedSqlSha256(source),
      });
    }
  }
  return rows.sort((left, right) =>
    left.version.localeCompare(right.version) || left.path.localeCompare(right.path));
}

export function findMigrationControlProblems({ manifest, rows, manifestText = null }) {
  const problems = [];
  if (manifest.schemaVersion !== 1 || manifest.kind !== "vinpoker-migration-control") {
    problems.push("unsupported migration control manifest schema");
    return problems;
  }
  if (manifestText !== null && normalizeSql(manifestText) !== canonicalManifestText(manifest)) {
    problems.push("manifest serialization is not deterministic canonical JSON");
  }

  const receipts = new Map();
  for (const receipt of manifest.productionReceipts ?? []) {
    if (receipts.has(receipt.version)) {
      problems.push(`duplicate production receipt ${receipt.version}`);
      continue;
    }
    if (!MIGRATION_PATTERN.test(`${receipt.version}_${receipt.semanticName}.sql`)
        || !SHA256_PATTERN.test(receipt.normalizedSqlSha256)) {
      problems.push(`invalid production receipt identity ${receipt.version}`);
      continue;
    }
    receipts.set(receipt.version, receipt);
  }

  const reservations = new Map();
  for (const reservation of manifest.reservations ?? []) {
    const expectedFilename = `${reservation.newVersion}_${reservation.semanticName}.sql`;
    if (reservation.filename !== expectedFilename) {
      problems.push(`reservation filename/semantic disagreement ${reservation.newVersion}`);
    }
    if (!SOURCE_SHA_PATTERN.test(reservation.sourceSha ?? "")) {
      problems.push(`reservation source SHA invalid ${reservation.newVersion}`);
    }
    if (reservation.normalizedSqlSha256 !== null
        && !SHA256_PATTERN.test(reservation.normalizedSqlSha256)) {
      problems.push(`reservation SQL hash invalid ${reservation.newVersion}`);
    }
    const previous = reservations.get(reservation.newVersion);
    if (previous) {
      problems.push(
        `branch reservation collision ${reservation.newVersion}: `
        + `${previous.ownerSession}/${previous.semanticName} vs `
        + `${reservation.ownerSession}/${reservation.semanticName}`,
      );
    } else {
      reservations.set(reservation.newVersion, reservation);
    }
  }

  const knownSourceCollisions = new Map();
  for (const collision of manifest.knownSourceCollisions ?? []) {
    knownSourceCollisions.set(collision.version, [...collision.identities].sort().join(","));
  }

  const knownVersions = new Set([...receipts.keys(), ...reservations.keys()]);
  for (const reservation of reservations.values()) {
    for (const dependency of reservation.dependencies ?? []) {
      if (!knownVersions.has(dependency)) {
        problems.push(`missing dependency ${dependency} for ${reservation.newVersion}`);
      }
      if (dependency >= reservation.newVersion) {
        problems.push(`dependency is not a predecessor ${dependency} -> ${reservation.newVersion}`);
      }
    }
  }

  const rowsByVersion = new Map();
  for (const row of rows) {
    const sameVersion = rowsByVersion.get(row.version) ?? [];
    sameVersion.push(row);
    rowsByVersion.set(row.version, sameVersion);
  }
  for (const [version, sameVersion] of rowsByVersion) {
    const identities = new Set(sameVersion.map(
      (row) => `${row.semanticName}:${row.normalizedSqlSha256}`,
    ));
    const identityKey = [...identities].sort().join(",");
    if (identities.size > 1 && knownSourceCollisions.get(version) !== identityKey) {
      problems.push(`same version has different semantic name or normalized SQL ${version}`);
    }
    const receipt = receipts.get(version);
    if (receipt) {
      for (const row of sameVersion) {
        if (row.semanticName !== receipt.semanticName
            || row.normalizedSqlSha256 !== receipt.normalizedSqlSha256) {
          problems.push(`production semantic collision ${version}: ${row.filename}`);
        }
      }
    }
    const reservation = reservations.get(version);
    if (reservation) {
      for (const row of sameVersion) {
        if (row.filename !== reservation.filename
            || row.semanticName !== reservation.semanticName) {
          problems.push(`reserved semantic collision ${version}: ${row.filename}`);
        } else if (reservation.normalizedSqlSha256 === null) {
          problems.push(`reserved migration requires bound normalized SQL hash ${row.filename}`);
        } else if (row.normalizedSqlSha256 !== reservation.normalizedSqlSha256) {
          problems.push(`reserved migration normalized SQL drift ${row.filename}`);
        }
      }
    }
  }

  for (const reservation of reservations.values()) {
    const present = rowsByVersion.get(reservation.newVersion) ?? [];
    if (reservation.state === "SOURCE_BOUND" && present.length === 0) {
      problems.push(`source-bound reservation is missing ${reservation.filename}`);
    }
    if (reservation.state === "RESERVED_NO_SQL" && present.length > 0) {
      problems.push(`unbound reservation unexpectedly has SQL ${reservation.filename}`);
    }
  }

  if ((manifest.protectedApplyOrder ?? []).join(",")
      !== [...reservations.keys()].sort().join(",")) {
    problems.push("protected apply order must list every reservation exactly once in version order");
  }
  if (manifest.safety?.daybreakEnabled !== false) {
    problems.push("Daybreak must remain disabled");
  }
  for (const gate of ["dbApply", "edgeDeploy", "frontendDeploy", "flagActivation", "ledgerRepair"]) {
    if (manifest.safety?.[gate] !== false) problems.push(`safety gate must remain false ${gate}`);
  }
  return [...new Set(problems)].sort();
}

export function runMigrationControlCheck({ manifestPath, directories }) {
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const reconciliationPath = resolve(dirname(manifestPath), "../migration-archive/floor-v3-catalog-reconciliation.manifest.json");
  const voicePath = resolve(dirname(manifestPath), "../migration-archive/tracker-voice-release-chain.manifest.json");
  const rows = readMigrationRows(directories);
  const receiptPaths = new Set();
  const reconciliationProblems = [];
  if (existsSync(reconciliationPath)) {
    const catalogProblems = findMigrationCatalogProblems(directories[0], reconciliationPath, voicePath);
    reconciliationProblems.push(...catalogProblems.map((problem) => `receipt catalog invalid: ${problem}`));
    if (catalogProblems.length === 0) {
      const reconciliation = JSON.parse(readFileSync(reconciliationPath, "utf8"));
      for (const receipt of reconciliation.remoteHistoryReceipts) {
        receiptPaths.add(resolve(directories[0], receipt.receiptFilename));
      }
    }
  } else if (rows.some((row) => row.semanticName === "remote_history_receipt")) {
    reconciliationProblems.push("remote history receipts require validated catalog evidence");
  }
  // Verified comment-only lineage is metadata, not executable SQL with a new semantic identity.
  // Catalog checks above validate bytes, live names and preserved source before excluding it.
  const problems = [...reconciliationProblems, ...findMigrationControlProblems({
    manifest,
    rows: rows.filter((row) => !receiptPaths.has(resolve(row.path))),
    manifestText,
  })];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`MIGRATION_CONTROL_FAIL ${problem}`);
    return 1;
  }
  console.log(`MIGRATION_CONTROL_PASS ${manifest.reservations.length} reservations`);
  return 0;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), "../..");
  process.exitCode = runMigrationControlCheck({
    manifestPath: resolve(root, "supabase/migration-control/manifest.json"),
    directories: [
      resolve(root, "supabase/migrations"),
      resolve(root, "supabase/pending-migrations"),
    ],
  });
}
