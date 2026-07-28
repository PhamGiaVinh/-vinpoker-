import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const targetVersions = ["20270106000001"];
const immutableHistoricalMigrations = new Map([
  [
    "20270105000002_dealer_pt_wage_global_continuous_accrual.sql",
    "ed13fffb7adacd6a7298faafa1cf764c999617c67a5a75d6cc2b242580e5ebe1",
  ],
  [
    "20270105000003_dealer_pt_wage_rate_history.sql",
    "f8fc8a0476000f8817bfc2616885974034cfeb70ef9530336b419c4267eb74b2",
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

for (const version of targetVersions) {
  const files = byVersion.get(version) ?? [];
  if (files.length !== 1) {
    throw new Error(`PAYROLL_MIGRATION_VERSION_COLLISION:${version}:${files.join(",") || "missing"}`);
  }
}

for (const [name, expectedChecksum] of immutableHistoricalMigrations) {
  const actualChecksum = createHash("sha256").update(readFileSync(resolve(migrationsDirectory, name))).digest("hex");
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`PAYROLL_HISTORICAL_MIGRATION_MUTATED:${name}`);
  }
}

const collisions = [...byVersion.entries()]
  .filter(([, files]) => files.length > 1)
  .map(([version, files]) => `${version}:${files.join(",")}`);

console.log(JSON.stringify({
  migration_count: entries.length,
  existing_timestamp_collision_count: collisions.length,
  payroll_versions_unique: true,
  historical_migrations_immutable: true,
}));
