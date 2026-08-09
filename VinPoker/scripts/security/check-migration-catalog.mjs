import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_FILE_PATTERN = /^(\d{14})_.+\.sql$/u;
const FORBIDDEN_ACTIVE_MIGRATION_FILENAMES = new Map([
  [
    "20270104000005_dealer_shortage_alert_lifecycle.sql",
    "superseded shortage-alert migration belongs in migration-archive/never-apply",
  ],
  [
    "20270105000002_dealer_pt_wage_global_continuous_accrual.sql",
    "superseded payroll migration belongs in migration-archive/never-apply",
  ],
  [
    "20270105000003_dealer_pt_wage_rate_history.sql",
    "superseded payroll migration belongs in migration-archive/never-apply",
  ],
]);

export function findMigrationCatalogProblems(migrationDirectory) {
  const versions = new Map();
  const invalidFiles = [];

  for (const entry of readdirSync(migrationDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;

    const match = entry.name.match(MIGRATION_FILE_PATTERN);
    if (!match) {
      // Supabase ignores non-versioned SQL helpers. They are not part of the
      // ordered migration catalog and are deliberately left to their callers.
      continue;
    }

    const version = match[1];
    const files = versions.get(version) ?? [];
    files.push(entry.name);
    versions.set(version, files);

    const reason = FORBIDDEN_ACTIVE_MIGRATION_FILENAMES.get(entry.name);
    if (reason) invalidFiles.push(`forbidden active migration ${entry.name}: ${reason}`);
  }

  for (const [version, files] of [...versions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (files.length > 1) {
      invalidFiles.push(`duplicate migration version ${version}: ${files.sort().join(", ")}`);
    }
  }

  return invalidFiles.sort();
}

export function runMigrationCatalogCheck(migrationDirectory) {
  const problems = findMigrationCatalogProblems(migrationDirectory);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`MIGRATION_CATALOG_FAIL ${problem}`);
    return 1;
  }

  console.log("MIGRATION_CATALOG_PASS unique versioned migration filenames");
  return 0;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const defaultDirectory = resolve(dirname(scriptPath), "../../supabase/migrations");
  const migrationDirectory = process.argv[2] ? resolve(process.argv[2]) : defaultDirectory;
  process.exitCode = runMigrationCatalogCheck(migrationDirectory);
}
