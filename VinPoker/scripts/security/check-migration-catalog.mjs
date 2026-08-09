import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_FILE_PATTERN = /^(\d{14})_.+\.sql$/u;
const CREDENTIAL_LIKE_JWT_LITERAL = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u;
const DIRECT_PRODUCTION_FUNCTION_TARGET = /https:\/\/orlesggcjamwuknxwcpk\.supabase\.co\/functions\/v1\//u;
const SAFE_BOOTSTRAP_MIGRATIONS = new Set([
  "20260516123400_push_notification_dispatch.sql",
  "20260525000001_schedule_enforce_break_balance.sql",
  "20260607191545_fix_notify_dealer_ready_v2_auth.sql",
  "20260609000018_notify_dealer_ready_v2.sql",
  "20260701000013_deadlock_recovery_schema.sql",
  "20261115000000_sepay_reconcile.sql",
]);
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
  [
    "20260428144425_53b3e896-323b-45b5-82e3-921bdaccaa91.sql",
    "credential-bearing production cron belongs in migration-archive/removed-sensitive",
  ],
  [
    "20260530000004_pg_cron_auto_swing.sql",
    "credential-bearing production cron belongs in migration-archive/removed-sensitive",
  ],
  [
    "20260603000002_fix_cron_schedule.sql",
    "credential-bearing production cron belongs in migration-archive/removed-sensitive",
  ],
  [
    "20260607192552_fix_backup_cron_hardcoded_auth.sql",
    "credential-bearing production cron belongs in migration-archive/removed-sensitive",
  ],
  [
    "20260607191236_schedule_run_dealer_ready_backup_cron.sql",
    "production-targeted scheduler belongs in migration-archive/removed-sensitive",
  ],
  [
    "20260607203059_schedule_process_pre_announce_jobs_cron.sql",
    "credential-bearing production cron belongs in migration-archive/removed-sensitive",
  ],
  [
    "20261101000003_schedule_marketing_dispatch.sql",
    "credential-bearing production cron belongs in migration-archive/removed-sensitive",
  ],
  [
    "20261101000008_schedule_marketing_autocontent.sql",
    "credential-bearing production cron belongs in migration-archive/removed-sensitive",
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

    const source = readFileSync(resolve(migrationDirectory, entry.name), "utf8");
    if (CREDENTIAL_LIKE_JWT_LITERAL.test(source)) {
      invalidFiles.push(`credential-like JWT literal in active migration ${entry.name}`);
    }
    const sourceWithoutLineComments = source.replace(/--[^\r\n]*/gu, "");
    if (DIRECT_PRODUCTION_FUNCTION_TARGET.test(sourceWithoutLineComments)) {
      invalidFiles.push(`direct production function target in active migration ${entry.name}`);
    }
    if (SAFE_BOOTSTRAP_MIGRATIONS.has(entry.name) && /\bnet\.http_post\b/u.test(source)) {
      invalidFiles.push(`unsafe HTTP side effect in contained bootstrap migration ${entry.name}`);
    }
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
