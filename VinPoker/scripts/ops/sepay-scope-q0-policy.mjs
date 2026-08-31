import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const CENTER_CLUB_ID = "22222222-2222-2222-2222-222222222222";
export const ROYAL_CLUB_ID = "11111111-1111-1111-1111-111111111111";
export const EXPECTED_ACCOUNT_FINGERPRINT = "871af98b5a5d";
export const MIGRATION_VERSION = "20270114000000";
export const MIGRATION_NAME = "20270114000000_ops_quant_data_health_q0";
export const MIGRATION_PATH = `supabase/pending-migrations/${MIGRATION_NAME}.sql`;
export const MIGRATION_SHA256 = "f696545d3fb17e0099e958980ab176a6c2c53b71c8e70639203381ed61c91457";

export function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sourcePolicyProblems(vinPokerRoot) {
  const problems = [];
  const migrationPath = resolve(vinPokerRoot, MIGRATION_PATH);
  const flagsPath = resolve(vinPokerRoot, "src/lib/featureFlags.ts");
  if (!existsSync(migrationPath)) return ["Q0 migration source is missing"];
  if (!existsSync(flagsPath)) return ["feature flag source is missing"];

  const migration = readFileSync(migrationPath, "utf8");
  const flags = readFileSync(flagsPath, "utf8");
  if (sha256(normalizeLineEndings(migration)) !== MIGRATION_SHA256) problems.push("Q0 migration checksum mismatch");
  if (!/^BEGIN;/mu.test(migration) || !/COMMIT;\s*$/u.test(migration)) problems.push("Q0 migration is not transaction wrapped");
  if (!/opsQuantDataHealthQ0:\s*false/u.test(flags)) problems.push("Q0 source flag must remain false during DB apply");
  for (const expected of [
    "CREATE OR REPLACE FUNCTION public.resolve_sepay_account_club_v1",
    "CREATE OR REPLACE FUNCTION public.get_ops_registration_pace_q0",
    "CREATE OR REPLACE FUNCTION public.get_ops_sepay_read_state_q0",
    "REVOKE ALL ON FUNCTION public.resolve_sepay_account_club_v1(text) FROM PUBLIC, anon, authenticated, service_role",
  ]) if (!migration.includes(expected)) problems.push(`Q0 migration misses ${expected}`);
  if (/\b(?:insert|update|delete|truncate)\b[\s\S]*?public\.bank_transactions/iu.test(migration)) {
    problems.push("Q0 migration writes bank transactions");
  }
  return problems;
}

export function historyProblems(history) {
  const entries = history.filter((entry) => entry?.version === MIGRATION_VERSION);
  if (entries.length > 1) return ["Q0 migration ledger entry is duplicated"];
  if (entries.length === 1 && entries[0].name !== MIGRATION_NAME) return ["Q0 migration version has an unexpected ledger name"];
  return [];
}
