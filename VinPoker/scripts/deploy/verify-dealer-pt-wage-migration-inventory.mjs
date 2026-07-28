import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const targetVersions = ["20270106000001"];
const immutableHistoricalMigrations = new Map([
  [
    "20270105000002_dealer_pt_wage_global_continuous_accrual.sql",
    "0f8362ec045d9d1881f408f8eaee999099a5f80f00fcfd9be40207a0d6cf2dff",
  ],
  [
    "20270105000003_dealer_pt_wage_rate_history.sql",
    "d7a0055a126fc5091574c092733602e291c805262be78a65718f1ead5b76c2ea",
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
  const normalizedSource = readFileSync(resolve(migrationsDirectory, name), "utf8").replaceAll("\r\n", "\n");
  const actualChecksum = createHash("sha256").update(normalizedSource).digest("hex");
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
