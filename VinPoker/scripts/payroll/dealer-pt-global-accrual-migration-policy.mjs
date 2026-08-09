import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const MIGRATION_VERSION = "20270106000001";
export const MIGRATION_BASENAME =
  `${MIGRATION_VERSION}_dealer_pt_wage_global_continuous_accrual_v2.sql`;
export const MIGRATION_PATH = `supabase/migrations/${MIGRATION_BASENAME}`;
export const MIGRATION_NAME = `${MIGRATION_VERSION}_dealer_pt_wage_global_continuous_accrual_v2`;
// The apply runner hashes normalized LF source so the exact migration identity
// is stable between Windows authoring and the Linux protected runner.
export const MIGRATION_SHA256 = "e1625874e61d943715ae62ebe4ab24ee647dfd95ad9f4f2872be2cd5948e261b";

export const BASELINE_MIGRATION_NAME = "20270105000001_dealer_pt_standby_accrual_policy";
export const BASELINE_MIGRATION_VERSION = "20270105000001";
export const NEVER_APPLY = Object.freeze([
  "supabase/migration-archive/never-apply/20270105000002_dealer_pt_wage_global_continuous_accrual.sql",
  "supabase/migration-archive/never-apply/20270105000003_dealer_pt_wage_rate_history.sql",
]);

const IMMUTABLE_HISTORICAL_SHA256 = new Map([
  [
    "supabase/migration-archive/never-apply/20270105000002_dealer_pt_wage_global_continuous_accrual.sql",
    "0f8362ec045d9d1881f408f8eaee999099a5f80f00fcfd9be40207a0d6cf2dff",
  ],
  [
    "supabase/migration-archive/never-apply/20270105000003_dealer_pt_wage_rate_history.sql",
    "d7a0055a126fc5091574c092733602e291c805262be78a65718f1ead5b76c2ea",
  ],
]);

export function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function migrationInventory(vinPokerRoot) {
  const directory = resolve(vinPokerRoot, "supabase/migrations");
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{14}_.+\.sql$/u.test(entry.name))
    .map((entry) => ({ version: entry.name.slice(0, 14), file: entry.name }))
    .sort((left, right) => left.file.localeCompare(right.file));
  const byVersion = new Map();
  for (const entry of entries) {
    byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), entry.file]);
  }
  return { entries, byVersion };
}

export function selectedMigrationProblems(vinPokerRoot) {
  const problems = [];
  const { byVersion } = migrationInventory(vinPokerRoot);
  const candidates = byVersion.get(MIGRATION_VERSION) ?? [];
  if (candidates.length !== 1 || candidates[0] !== MIGRATION_BASENAME) {
    problems.push("candidate migration selector is not unique");
  }

  const source = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  if (sha256(normalizeLineEndings(source)) !== MIGRATION_SHA256) {
    problems.push("candidate migration checksum mismatch");
  }
  if (!/\bbegin\s*;/i.test(source) || !/commit\s*;\s*$/i.test(source)) {
    problems.push("candidate migration is not transaction-wrapped");
  }
  if (/schema_migrations/i.test(source)) problems.push("candidate migration touches schema_migrations");
  for (const expected of [
    "public.dealer_pt_wage_accrual_global_policy",
    "public.dealer_pt_wage_rate_history",
    "public.assert_dealer_pt_wage_global_activation_ready",
    "public.set_all_approved_dealer_pt_wage_accrual",
    "accrual_policy_snapshot",
    "trg_capture_dealer_pt_wage_rate_history",
    "future_club_enabled       boolean not null default false",
  ]) {
    if (!source.includes(expected)) problems.push(`candidate migration misses ${expected}`);
  }
  return problems;
}

export function historicalMigrationProblems(vinPokerRoot) {
  const problems = [];
  for (const [path, expected] of IMMUTABLE_HISTORICAL_SHA256) {
    const source = readFileSync(resolve(vinPokerRoot, path), "utf8");
    if (sha256(normalizeLineEndings(source)) !== expected) {
      problems.push(`historical migration checksum mismatch: ${path}`);
    }
  }
  return problems;
}

export function sourcePolicyProblems(vinPokerRoot) {
  return [...selectedMigrationProblems(vinPokerRoot), ...historicalMigrationProblems(vinPokerRoot)];
}

export function createMigrationRequest(sql) {
  return { query: sql, name: MIGRATION_NAME };
}

export function historyEntryMatchesCandidate(entry) {
  return entry?.name === MIGRATION_NAME && /^\d+$/u.test(String(entry?.version ?? ""));
}
