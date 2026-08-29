import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const CONFIRMATION = "APPLY_DEALER_SWING_PHONE_COMPLETION_20270102000000_20270102000001";

export const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: "20270102000000",
    basename: "20270102000000_operator_dealer_checkin.sql",
    name: "20270102000000_operator_dealer_checkin",
    sha256: "f52650f8ecd0752cff96d1e166b655024cfef55671a5cf0f32a8f7f92084b9d4",
    required: [
      "public.dealer_swing_phone_rollout",
      "public.get_dealer_swing_phone_rollout",
      "public.operator_check_in_dealers",
    ],
  }),
  Object.freeze({
    version: "20270102000001",
    basename: "20270102000001_close_dealer_tables_cas.sql",
    name: "20270102000001_close_dealer_tables_cas",
    sha256: "03169a01e613c32a97d304fb65644727a8c43834d54fa748c38a1aef4331130b",
    required: [
      "public.dealer_phone_close_requests",
      "public.close_dealer_tables",
      "public.dealer_phone_reconcile_room_state",
    ],
  }),
]);

export function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function migrationPath(migration) {
  return `supabase/migration-archive/superseded/remote-alias/${migration.basename}`;
}

function resolvedMigrationPath(vinPokerRoot, migration) {
  const archivedPath = resolve(vinPokerRoot, migrationPath(migration));
  const activePath = resolve(vinPokerRoot, "supabase/migrations", migration.basename);
  if (existsSync(archivedPath) && existsSync(activePath)) {
    throw new Error(`${migration.version} has both archived and active sources`);
  }
  return existsSync(archivedPath) ? archivedPath : activePath;
}

export function sourcePolicyProblems(vinPokerRoot) {
  const problems = [];

  for (const migration of MIGRATIONS) {
    const sourcePath = resolvedMigrationPath(vinPokerRoot, migration);
    if (!existsSync(sourcePath)) {
      problems.push(`${migration.version} does not resolve to its exact migration file`);
      continue;
    }

    const source = readFileSync(sourcePath, "utf8");
    if (sha256(normalizeLineEndings(source)) !== migration.sha256) {
      problems.push(`${migration.version} checksum mismatch`);
    }
    if (/schema_migrations/i.test(source)) {
      problems.push(`${migration.version} touches schema_migrations`);
    }
    for (const required of migration.required) {
      if (!source.includes(required)) problems.push(`${migration.version} misses ${required}`);
    }
  }

  return problems;
}

export function createMigrationRequest(migration, sql) {
  return { query: sql, name: migration.name };
}

export function historyEntryMatches(entry, migration) {
  return entry?.name === migration.name && /^\d+$/.test(String(entry?.version ?? ""));
}
