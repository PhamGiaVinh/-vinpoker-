import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const targetVersions = ["20270105000002", "20270105000003"];

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

const collisions = [...byVersion.entries()]
  .filter(([, files]) => files.length > 1)
  .map(([version, files]) => `${version}:${files.join(",")}`);

console.log(JSON.stringify({
  migration_count: entries.length,
  existing_timestamp_collision_count: collisions.length,
  payroll_versions_unique: true,
}));
