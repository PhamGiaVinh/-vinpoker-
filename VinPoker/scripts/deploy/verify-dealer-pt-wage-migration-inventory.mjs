import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const archivedTargetVersions = ["20270106000001", "20270106000002", "20270112000000"];
const immutableHistoricalMigrations = new Map([
  [
    "supabase/migration-archive/never-apply/20270105000002_dealer_pt_wage_global_continuous_accrual.sql",
    "0f8362ec045d9d1881f408f8eaee999099a5f80f00fcfd9be40207a0d6cf2dff",
  ],
  [
    "supabase/migration-archive/never-apply/20270105000003_dealer_pt_wage_rate_history.sql",
    "d7a0055a126fc5091574c092733602e291c805262be78a65718f1ead5b76c2ea",
  ],
  [
    "supabase/migration-archive/superseded/remote-alias/20270106000001_dealer_pt_wage_global_continuous_accrual_v2.sql",
    "e1625874e61d943715ae62ebe4ab24ee647dfd95ad9f4f2872be2cd5948e261b",
  ],
  [
    "supabase/migration-archive/superseded/remote-alias/20270106000002_dealer_pt_wage_readiness_acl.sql",
    "d57b53ce40b45b74d27adeea99349a2700e1fcbf687ca2c566a8591f8e87dee4",
  ],
  [
    "supabase/migration-archive/historical-never-replay/20270112000000_dealer_payroll_statements_v1.sql",
    "c0b76c158aea9dcf4c060c1b306efdf59457cfdd150707e4474f72b7401b9c8f",
  ],
]);

const entries = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
  .sort();
const byVersion = new Map();
for (const name of entries) {
  const version = name.slice(0, 14);
  byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
}

for (const version of archivedTargetVersions) {
  const files = byVersion.get(version) ?? [];
  if (files.length !== 0) {
    throw new Error(`PAYROLL_MIGRATION_VERSION_COLLISION:${version}:${files.join(",")}`);
  }
}

for (const [path, expectedChecksum] of immutableHistoricalMigrations) {
  let normalizedSource;
  try {
    normalizedSource = readFileSync(resolve(repositoryRoot, path), "utf8").replaceAll("\r\n", "\n");
  } catch {
    throw new Error(`PAYROLL_HISTORICAL_MIGRATION_MISSING:${path}`);
  }
  const actualChecksum = createHash("sha256").update(normalizedSource).digest("hex");
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`PAYROLL_HISTORICAL_MIGRATION_MUTATED:${path}`);
  }
}

const collisions = [...byVersion.entries()]
  .filter(([, files]) => files.length > 1)
  .map(([version, files]) => `${version}:${files.join(",")}`);

if (collisions.length > 0) {
  throw new Error(`MIGRATION_CATALOG_VERSION_COLLISION:${collisions.join("|")}`);
}

console.log(JSON.stringify({
  migration_count: entries.length,
  existing_timestamp_collision_count: 0,
  payroll_versions_unique: true,
  archived_payroll_versions_active_count: 0,
  historical_migrations_immutable: true,
}));
