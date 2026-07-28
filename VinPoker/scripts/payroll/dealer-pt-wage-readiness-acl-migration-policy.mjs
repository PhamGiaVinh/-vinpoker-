import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const BASELINE_MIGRATION_VERSION = "20270105000001";
export const V2_MIGRATION_VERSION = "20270106000001";
export const MIGRATION_VERSION = "20270106000002";
export const MIGRATION_BASENAME = `${MIGRATION_VERSION}_dealer_pt_wage_readiness_acl.sql`;
export const MIGRATION_PATH = `supabase/migrations/${MIGRATION_BASENAME}`;
export const MIGRATION_NAME = `${MIGRATION_VERSION}_dealer_pt_wage_readiness_acl`;
export const MIGRATION_SHA256 = "d57b53ce40b45b74d27adeea99349a2700e1fcbf687ca2c566a8591f8e87dee4";

const SUPERSEDED_VERSIONS = new Set(["20270105000002", "20270105000003"]);

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
  for (const entry of entries) byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), entry.file]);
  return { entries, byVersion };
}

export function sourcePolicyProblems(vinPokerRoot) {
  const problems = [];
  const { byVersion } = migrationInventory(vinPokerRoot);
  const candidates = byVersion.get(MIGRATION_VERSION) ?? [];
  if (candidates.length !== 1 || candidates[0] !== MIGRATION_BASENAME) {
    problems.push("candidate migration selector is not unique");
  }
  const source = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  if (sha256(normalizeLineEndings(source)) !== MIGRATION_SHA256) problems.push("candidate migration checksum mismatch");
  if (!/\bbegin\s*;/iu.test(source) || !/commit\s*;\s*$/iu.test(source)) {
    problems.push("candidate migration is not transaction-wrapped");
  }
  if (/schema_migrations|dealer_pt_wage_payments|dealer_attendance|future_club_enabled\s*=/iu.test(source)) {
    problems.push("candidate migration exceeds readiness ACL repair scope");
  }
  for (const expected of [
    "revoke all on function public.assert_dealer_pt_wage_global_activation_ready(timestamptz)",
    "from public, anon, authenticated, service_role",
    "dealer PT wage readiness helper ACL repair did not converge",
  ]) {
    if (!source.includes(expected)) problems.push(`candidate migration misses ${expected}`);
  }
  for (const version of [V2_MIGRATION_VERSION, MIGRATION_VERSION]) {
    if ((byVersion.get(version) ?? []).length !== 1) problems.push(`source migration version collision: ${version}`);
  }
  return problems;
}

export function historyEntryMatchesCandidate(entry) {
  return entry?.version === MIGRATION_VERSION && entry?.name === MIGRATION_NAME;
}

export function createMigrationRequest(sql) {
  return { query: sql, name: MIGRATION_NAME };
}

export function historyProblems(history) {
  const problems = [];
  const candidateEntries = history.filter((entry) => entry?.version === MIGRATION_VERSION);
  if (candidateEntries.length > 1) problems.push("repair migration version is duplicated in ledger history");
  if (candidateEntries.length === 1 && !historyEntryMatchesCandidate(candidateEntries[0])) {
    problems.push("repair migration version is registered with an unexpected name");
  }
  if (!history.some((entry) => entry?.version === BASELINE_MIGRATION_VERSION)) {
    problems.push("required payroll baseline migration is absent from migration history");
  }
  for (const entry of history) {
    if (SUPERSEDED_VERSIONS.has(entry?.version)) problems.push(`superseded migration is registered: ${entry.version}`);
  }
  return problems;
}

// The management migration endpoint historically executed the reviewed v2 SQL
// without adding its version to schema_migrations. The live v2 catalog contract
// is therefore the authoritative dependency proof for this ACL-only repair;
// history remains diagnostic evidence and never gets repaired or backfilled here.
export function historyEvidence(history) {
  return {
    baseline_ledger_present: history.some((entry) => entry?.version === BASELINE_MIGRATION_VERSION),
    v2_ledger_present: history.some((entry) => entry?.version === V2_MIGRATION_VERSION),
    repair_ledger_present: history.some(historyEntryMatchesCandidate),
  };
}
