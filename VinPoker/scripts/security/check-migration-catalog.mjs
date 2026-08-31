import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_FILE_PATTERN = /^(\d{14})_.+\.sql$/u;
const CLI_VISIBLE_NON_VERSIONED_MIGRATION = /^\d+_.+\.sql$/u;
const CREDENTIAL_LIKE_JWT_LITERAL =
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u;
const DIRECT_PRODUCTION_FUNCTION_TARGET =
  /https:\/\/orlesggcjamwuknxwcpk\.supabase\.co\/functions\/v1\//u;
const MANAGED_REALTIME_OWNERSHIP_DDL =
  /\b(?:ALTER\s+TABLE\s+realtime\.[A-Za-z_][A-Za-z0-9_]*\s+(?:ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY|(?:CREATE|DROP|ALTER)\s+POLICY\b[\s\S]{0,512}?\bON\s+realtime\.[A-Za-z_][A-Za-z0-9_]*)/iu;
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
    "20270113000000_dealer_payroll_statement_pdf_storage.sql",
    "historical Payroll source is preserved; inspect live lineage before any delta migration",
  ],
  [
    "20270113000001_dealer_payroll_statement_ft_ui_contract.sql",
    "Payroll migration has alias history; do not replay the archived source",
  ],
  [
    "20270113000004_dealer_payroll_statement_telegram_delivery.sql",
    "Payroll/Telegram migration has alias history; do not replay the archived source",
  ],
  [
    "20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql",
    "replay-unsafe managed Realtime DDL belongs in migration-archive/removed-sensitive",
  ],
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
    "20270113000004_floor_table_control_v3_contract_hardening.sql",
    "duplicate-version Floor contract belongs in migration-archive/never-apply",
  ],
  [
    "20270113000003_floor_table_control_v3_server_contract.sql",
    "failed-before-ledger Floor V3 contract belongs in migration-archive/never-apply",
  ],
  [
    "20270113000005_floor_table_control_v3_contract_hardening.sql",
    "never-applied superseded Floor V3 hardening belongs in migration-archive/never-apply",
  ],
  [
    "20270113000006_floor_table_control_v3_roster_read_contract.sql",
    "never-applied superseded Floor V3 roster contract belongs in migration-archive/never-apply",
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

function readReconciliationManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.kind !== "floor-v3-catalog-reconciliation") {
    throw new Error("unsupported Floor V3 reconciliation manifest schema");
  }
  return manifest;
}

function isCommentOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/--[^\r\n]*/gu, "")
    .trim().length === 0;
}

export function findMigrationCatalogProblems(
  migrationDirectory,
  reconciliationManifestPath = null,
) {
  const versions = new Map();
  const invalidFiles = [];
  const activeRows = [];

  for (const entry of readdirSync(migrationDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;

    if (
      CLI_VISIBLE_NON_VERSIONED_MIGRATION.test(entry.name) &&
      !MIGRATION_FILE_PATTERN.test(entry.name)
    ) {
      invalidFiles.push(
        `CLI-visible non-versioned migration remains active ${entry.name}`,
      );
      continue;
    }

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
    if (reason)
      invalidFiles.push(`forbidden active migration ${entry.name}: ${reason}`);

    const source = readFileSync(
      resolve(migrationDirectory, entry.name),
      "utf8",
    );
    activeRows.push({
      version,
      filename: entry.name,
      source,
    });
    if (CREDENTIAL_LIKE_JWT_LITERAL.test(source)) {
      invalidFiles.push(
        `credential-like JWT literal in active migration ${entry.name}`,
      );
    }
    const sourceWithoutLineComments = source.replace(/--[^\r\n]*/gu, "");
    if (DIRECT_PRODUCTION_FUNCTION_TARGET.test(sourceWithoutLineComments)) {
      invalidFiles.push(
        `direct production function target in active migration ${entry.name}`,
      );
    }
    if (MANAGED_REALTIME_OWNERSHIP_DDL.test(sourceWithoutLineComments)) {
      invalidFiles.push(
        `managed Realtime ownership DDL in active migration ${entry.name}`,
      );
    }
    if (
      SAFE_BOOTSTRAP_MIGRATIONS.has(entry.name) &&
      /\bnet\.http_post\b/u.test(source)
    ) {
      invalidFiles.push(
        `unsafe HTTP side effect in contained bootstrap migration ${entry.name}`,
      );
    }
  }

  for (const [version, files] of [...versions.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (files.length > 1) {
      invalidFiles.push(
        `duplicate migration version ${version}: ${files.sort().join(", ")}`,
      );
    }
  }

  if (reconciliationManifestPath) {
    if (!existsSync(reconciliationManifestPath)) {
      invalidFiles.push("Floor V3 reconciliation manifest is missing");
    } else {
      try {
        const reconciliation = readReconciliationManifest(
          reconciliationManifestPath,
        );
        const remoteVersions = new Set(
          reconciliation.remoteLedgerVersions.map((entry) => entry.version),
        );
        const floorFiles = new Set(
          reconciliation.floorActiveAllowlist.map((entry) => entry.filename),
        );
        const activeByFilename = new Set(activeRows.map((row) => row.filename));
        const activeByVersion = new Set(activeRows.map((row) => row.version));

        for (const historical of reconciliation.historicalSources) {
          if (activeByFilename.has(historical.filename)) {
            invalidFiles.push(
              `historical migration remains replayable ${historical.filename}`,
            );
          }
        }
        for (const pending of reconciliation.pendingSources) {
          if (activeByFilename.has(pending.filename) || activeByVersion.has(pending.version)) {
            invalidFiles.push(`pending migration is active ${pending.filename}`);
          }
        }
        const receiptVersions = new Set();
        for (const receipt of reconciliation.remoteHistoryReceipts) {
          if (receiptVersions.has(receipt.remoteVersion)) {
            invalidFiles.push(`duplicate remote history receipt ${receipt.remoteVersion}`);
          }
          receiptVersions.add(receipt.remoteVersion);
          const row = activeRows.find((candidate) => candidate.filename === receipt.receiptFilename);
          if (!row || row.version !== receipt.remoteVersion) {
            invalidFiles.push(`remote history receipt is not active at ledger version ${receipt.receiptFilename}`);
          } else if (!isCommentOnly(row.source)) {
            invalidFiles.push(`remote history receipt is not comment-only ${receipt.receiptFilename}`);
          }
          if (!remoteVersions.has(receipt.remoteVersion)) {
            invalidFiles.push(`remote history receipt lacks remote ledger evidence ${receipt.remoteVersion}`);
          }
        }
        const head = reconciliation.registeredProductionHead;
        for (const row of activeRows) {
          if (floorFiles.has(row.filename) || remoteVersions.has(row.version)) continue;
          invalidFiles.push(
            row.version < head
              ? `replayable historical migration not reconciled ${row.filename}`
              : `unexpected active migration outside Floor allowlist ${row.filename}`,
          );
        }
        for (const remote of reconciliation.remoteLedgerVersions) {
          const hasCanonical = activeRows.some(
            (row) => row.version === remote.version && !row.filename.includes("_remote_history_receipt.sql"),
          );
          if (!hasCanonical && !receiptVersions.has(remote.version)) {
            invalidFiles.push(`missing remote history receipt ${remote.version}`);
          }
        }
      } catch (error) {
        invalidFiles.push(
          `Floor V3 reconciliation manifest invalid ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return invalidFiles.sort();
}

export function runMigrationCatalogCheck(
  migrationDirectory,
  reconciliationManifestPath = null,
) {
  const problems = findMigrationCatalogProblems(
    migrationDirectory,
    reconciliationManifestPath,
  );
  if (problems.length > 0) {
    for (const problem of problems)
      console.error(`MIGRATION_CATALOG_FAIL ${problem}`);
    return 1;
  }

  console.log("MIGRATION_CATALOG_PASS unique versioned migration filenames");
  return 0;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const defaultDirectory = resolve(
    dirname(scriptPath),
    "../../supabase/migrations",
  );
  const migrationDirectory = process.argv[2]
    ? resolve(process.argv[2])
    : defaultDirectory;
  const reconciliationManifestPath = resolve(
    dirname(scriptPath),
    "../../supabase/migration-archive/floor-v3-catalog-reconciliation.manifest.json",
  );
  process.exitCode = runMigrationCatalogCheck(
    migrationDirectory,
    reconciliationManifestPath,
  );
}
