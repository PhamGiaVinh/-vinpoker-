#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
export const CONFIRMATION = "REPAIR_DEALER_PAYROLL_DELIVERY_CONTRACT_20270113000008";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 90_000;
export const REPAIR_MIGRATION = Object.freeze({
  version: "20270113000008",
  name: "20270113000008_dealer_payroll_statement_telegram_delivery_contract_repair",
  path: "supabase/migrations/20270113000008_dealer_payroll_statement_telegram_delivery_contract_repair.sql",
  sha256: "7de847754cd68436ced5d641db1cbbdd9ec5c1ae305852582b778c40a853c77c",
});
export const RETIRED_MIGRATION_NAMES = Object.freeze([
  "20270113000000_dealer_payroll_statement_pdf_storage",
  "20270113000001_dealer_payroll_statement_ft_ui_contract",
  "20270113000004_dealer_payroll_statement_telegram_delivery",
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultVinPokerRoot = resolve(scriptDirectory, "..", "..");
const log = (...values) => console.log("[payroll-delivery-repair]", ...values);

// Catalog-only evidence. It returns schema facts, ACL booleans and aggregate
// row counts. It never returns identifiers, payroll values, SQL bodies or PII.
export const CATALOG_SQL = `with expected as (
  select
    to_regclass('public.dealer_payroll_statement_delivery_rollout') as rollout_table,
    to_regclass('public.dealer_payroll_delivery_operations') as operations_table,
    to_regclass('public.dealer_payroll_delivery_targets') as targets_table,
    to_regprocedure('public._dealer_payroll_statement_delivery_allowed(uuid)') as allowed_oid,
    to_regprocedure('public._assert_dealer_payroll_statement_delivery_rollout(uuid)') as assert_oid,
    to_regprocedure('public.get_dealer_payroll_statement_delivery_rollout(uuid)') as rollout_oid,
    to_regprocedure('public._refresh_dealer_payroll_delivery_operation(uuid)') as refresh_oid,
    to_regprocedure('public.create_dealer_payroll_statement_delivery_operation(uuid,uuid,uuid)') as create_oid,
    to_regprocedure('public.get_dealer_payroll_statement_delivery_operation(uuid)') as get_oid,
    to_regprocedure('public.claim_dealer_payroll_statement_delivery_target(uuid)') as claim_oid,
    to_regprocedure('public.complete_dealer_payroll_statement_delivery_target(uuid,uuid,text,text)') as complete_oid,
    to_regprocedure('public.fail_dealer_payroll_statement_delivery_target(uuid,uuid,text,text,integer)') as fail_oid
), counts as (
  select
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_dealer_payroll_statement_delivery_allowed') as allowed_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_assert_dealer_payroll_statement_delivery_rollout') as assert_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_dealer_payroll_statement_delivery_rollout') as rollout_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_refresh_dealer_payroll_delivery_operation') as refresh_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_dealer_payroll_statement_delivery_operation') as create_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_dealer_payroll_statement_delivery_operation') as get_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_dealer_payroll_statement_delivery_target') as claim_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_dealer_payroll_statement_delivery_target') as complete_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fail_dealer_payroll_statement_delivery_target') as fail_overloads
), dependencies as (
  select
    to_regclass('public.dealer_payroll_statements') is not null as statements_ready,
    to_regclass('public.dealer_payroll_delivery_attempts') is not null as attempts_ready,
    to_regclass('public.dealer_payroll_statement_rollout') is not null as statement_rollout_ready,
    to_regclass('public.payroll_periods') is not null as periods_ready,
    to_regclass('public.dealers') is not null as dealers_ready,
    to_regclass('public.payroll_audit_log') is not null as audit_ready,
    to_regclass('public.payment_records') is not null as full_time_payments_ready,
    to_regclass('public.dealer_pt_wage_payments') is not null as part_time_payments_ready,
    to_regprocedure('public._dealer_payroll_statement_rollout_allowed(uuid)') is not null as statement_allowed_ready,
    to_regprocedure('public._assert_dealer_payroll_statement_actor(uuid)') is not null as actor_ready,
    to_regprocedure('public._assert_dealer_payroll_statement_finalizer(uuid)') is not null as finalizer_ready
)
select
  d.*,
  e.rollout_table is not null as rollout_table_exists,
  e.operations_table is not null as operations_table_exists,
  e.targets_table is not null as targets_table_exists,
  to_regclass('public.dealer_payroll_delivery_operations_club_period_idx') is not null as operations_period_index_exists,
  to_regclass('public.dealer_payroll_delivery_operations_active_club_period_uq') is not null as operations_active_index_exists,
  to_regclass('public.dealer_payroll_delivery_targets_active_statement_channel_uq') is not null as targets_active_index_exists,
  to_regclass('public.dealer_payroll_delivery_targets_operation_state_idx') is not null as targets_state_index_exists,
  to_regclass('public.dealer_payroll_delivery_attempts_target_uq') is not null as attempts_target_index_exists,
  exists(select 1 from pg_attribute where attrelid=to_regclass('public.dealer_payroll_delivery_attempts') and attname='operation_id' and not attisdropped) as attempts_operation_id_exists,
  exists(select 1 from pg_attribute where attrelid=to_regclass('public.dealer_payroll_delivery_attempts') and attname='target_id' and not attisdropped) as attempts_target_id_exists,
  e.allowed_oid is not null as allowed_exists,
  e.assert_oid is not null as assert_exists,
  e.rollout_oid is not null as rollout_exists,
  e.refresh_oid is not null as refresh_exists,
  e.create_oid is not null as create_exists,
  e.get_oid is not null as get_exists,
  e.claim_oid is not null as claim_exists,
  e.complete_oid is not null as complete_exists,
  e.fail_oid is not null as fail_exists,
  c.*,
  coalesce((select relrowsecurity and relforcerowsecurity from pg_class where oid=e.rollout_table), false) as rollout_rls_forced,
  coalesce((select relrowsecurity and relforcerowsecurity from pg_class where oid=e.operations_table), false) as operations_rls_forced,
  coalesce((select relrowsecurity and relforcerowsecurity from pg_class where oid=e.targets_table), false) as targets_rls_forced,
  coalesce(has_function_privilege('authenticated', e.rollout_oid, 'EXECUTE'), false) as rollout_authenticated_execute,
  coalesce(has_function_privilege('anon', e.rollout_oid, 'EXECUTE'), false) as rollout_anon_execute,
  coalesce(has_function_privilege('authenticated', e.create_oid, 'EXECUTE'), false) as create_authenticated_execute,
  coalesce(has_function_privilege('anon', e.create_oid, 'EXECUTE'), false) as create_anon_execute,
  coalesce(has_function_privilege('authenticated', e.get_oid, 'EXECUTE'), false) as get_authenticated_execute,
  coalesce(has_function_privilege('anon', e.get_oid, 'EXECUTE'), false) as get_anon_execute,
  coalesce(has_function_privilege('service_role', e.assert_oid, 'EXECUTE'), false) as assert_service_execute,
  coalesce(has_function_privilege('service_role', e.claim_oid, 'EXECUTE'), false) as claim_service_execute,
  coalesce(has_function_privilege('authenticated', e.claim_oid, 'EXECUTE'), false) as claim_authenticated_execute,
  coalesce(has_function_privilege('service_role', e.complete_oid, 'EXECUTE'), false) as complete_service_execute,
  coalesce(has_function_privilege('authenticated', e.complete_oid, 'EXECUTE'), false) as complete_authenticated_execute,
  coalesce(has_function_privilege('service_role', e.fail_oid, 'EXECUTE'), false) as fail_service_execute,
  coalesce(has_function_privilege('authenticated', e.fail_oid, 'EXECUTE'), false) as fail_authenticated_execute,
  not coalesce(has_table_privilege('authenticated', e.rollout_table, 'SELECT,INSERT,UPDATE,DELETE'), true)
    and not coalesce(has_table_privilege('authenticated', e.operations_table, 'SELECT,INSERT,UPDATE,DELETE'), true)
    and not coalesce(has_table_privilege('authenticated', e.targets_table, 'SELECT,INSERT,UPDATE,DELETE'), true)
    as tables_authenticated_denied,
  not coalesce(has_table_privilege('anon', e.rollout_table, 'SELECT,INSERT,UPDATE,DELETE'), true)
    and not coalesce(has_table_privilege('anon', e.operations_table, 'SELECT,INSERT,UPDATE,DELETE'), true)
    and not coalesce(has_table_privilege('anon', e.targets_table, 'SELECT,INSERT,UPDATE,DELETE'), true)
    as tables_anon_denied,
  coalesce(has_table_privilege('service_role', e.rollout_table, 'SELECT,UPDATE'), false)
    and coalesce(has_table_privilege('service_role', e.operations_table, 'SELECT,INSERT,UPDATE'), false)
    and coalesce(has_table_privilege('service_role', e.targets_table, 'SELECT,INSERT,UPDATE'), false)
    as tables_service_worker_access
from expected e cross join counts c cross join dependencies d;`;

export const PARENT_GATE_SQL = `select
  count(*) as row_count,
  count(*) filter (where master_enabled) as master_count,
  count(*) filter (where all_clubs_enabled) as all_clubs_count,
  count(*) filter (where allowed_club_ids = array['${HSOP_CLUB_ID}']::uuid[]) as hsop_only_count
from public.dealer_payroll_statement_rollout;`;

export const DELIVERY_GATE_SQL = `select
  count(*) as row_count,
  count(*) filter (where master_enabled) as master_count,
  count(*) filter (where all_clubs_enabled) as all_clubs_count,
  count(*) filter (where allowed_club_ids = array['${HSOP_CLUB_ID}']::uuid[]) as hsop_only_count,
  count(*) filter (where cardinality(allowed_club_ids) = 0) as empty_allowlist_count
from public.dealer_payroll_statement_delivery_rollout;`;

export const AGGREGATES_SQL = `select
  (select count(*) from public.dealer_payroll_statements) as statement_rows,
  (select count(*) from public.dealer_payroll_statements where pdf_status = 'ready') as pdf_ready_rows,
  (select count(*) from public.dealer_payroll_delivery_attempts) as delivery_attempt_rows,
  (select count(*) from public.payment_records) as full_time_payment_rows,
  (select count(*) from public.dealer_pt_wage_payments) as part_time_payment_rows;`;

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function integer(value) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function sourceRootFromArgv(argv) {
  const index = argv.indexOf("--source-root");
  if (index < 0) return defaultVinPokerRoot;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--source-root requires an explicit directory");
  return resolve(value);
}

export function sourceProblems(sourceRoot) {
  const problems = [];
  const path = resolve(sourceRoot, REPAIR_MIGRATION.path);
  let sql;
  try {
    sql = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return ["repair migration source file missing"];
  }
  const hash = createHash("sha256").update(sql).digest("hex");
  if (hash !== REPAIR_MIGRATION.sha256) problems.push("repair migration checksum mismatch");
  if (/schema_migrations/i.test(sql)) problems.push("repair migration touches schema_migrations");
  if (!/\bbegin\s*;/i.test(sql) || !/commit;\s*$/i.test(sql)) problems.push("repair migration is not transaction wrapped");
  if (!sql.includes("PAYROLL_DELIVERY_PARTIAL_DRIFT")) problems.push("repair migration has no partial-drift guard");
  if (/update\s+public\.dealer_payroll_statement_rollout/i.test(sql)) problems.push("repair migration changes parent rollout");
  return problems;
}

function safeProviderCode(payload) {
  for (const candidate of [payload?.code, payload?.error_code, payload?.errorCode]) {
    if (typeof candidate === "string" && /^[A-Z0-9_]{3,32}$/.test(candidate.trim())) return candidate.trim();
  }
  return "UNKNOWN";
}

async function request({ projectRef, token, path, method, body, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("MANAGEMENT_API_OUTCOME_UNKNOWN");
  }
  if (!response.ok) {
    let providerCode = "UNKNOWN";
    try { providerCode = safeProviderCode(await response.json()); } catch { /* sanitized */ }
    throw new Error(`MANAGEMENT_API_${method}_${response.status}_${providerCode}`);
  }
  return response.status === 204 ? null : response.json();
}

async function readOnly(credentials, query, fetchImpl) {
  return firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query },
    fetchImpl,
  }));
}

export async function listMigrationHistory(credentials, fetchImpl = fetch) {
  const result = await request({ ...credentials, path: "/database/migrations", method: "GET", fetchImpl });
  if (!Array.isArray(result)) throw new Error("MIGRATION_HISTORY_INVALID_PAYLOAD");
  return result.map((entry) => ({ version: String(entry?.version ?? ""), name: String(entry?.name ?? "") }));
}

export function safeCatalog(state) {
  const output = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    output[key] = key.endsWith("_overloads") ? integer(value) : value === true;
  }
  return output;
}

export function safeCounts(state) {
  return Object.fromEntries(Object.entries(state ?? {}).map(([key, value]) => [key, integer(value)]));
}

const DEPENDENCIES = [
  "statements_ready", "attempts_ready", "statement_rollout_ready", "periods_ready", "dealers_ready",
  "audit_ready", "full_time_payments_ready", "part_time_payments_ready",
  "statement_allowed_ready", "actor_ready", "finalizer_ready",
];
const OBJECTS = [
  "rollout_table_exists", "operations_table_exists", "targets_table_exists",
  "operations_period_index_exists", "operations_active_index_exists", "targets_active_index_exists",
  "targets_state_index_exists", "attempts_target_index_exists", "attempts_operation_id_exists", "attempts_target_id_exists",
  "allowed_exists", "assert_exists", "rollout_exists", "refresh_exists", "create_exists", "get_exists",
  "claim_exists", "complete_exists", "fail_exists",
];

export function catalogClass(state) {
  const present = OBJECTS.filter((key) => state?.[key] === true).length;
  if (present === 0) return "absent";
  if (present !== OBJECTS.length) return "partial";
  return contractProblems(state).length === 0 ? "complete" : "partial";
}

export function dependencyProblems(state) {
  return DEPENDENCIES.filter((key) => state?.[key] !== true).map((key) => `${key} is not true`);
}

export function contractProblems(state) {
  const problems = [];
  for (const key of [...OBJECTS, "rollout_rls_forced", "operations_rls_forced", "targets_rls_forced"]) {
    if (state?.[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of [
    "rollout_authenticated_execute", "create_authenticated_execute", "get_authenticated_execute",
    "assert_service_execute", "claim_service_execute", "complete_service_execute", "fail_service_execute",
    "tables_authenticated_denied", "tables_anon_denied", "tables_service_worker_access",
  ]) if (state?.[key] !== true) problems.push(`${key} is not true`);
  for (const key of [
    "rollout_anon_execute", "create_anon_execute", "get_anon_execute",
    "claim_authenticated_execute", "complete_authenticated_execute", "fail_authenticated_execute",
  ]) if (state?.[key] !== false) problems.push(`${key} is not false`);
  for (const key of [
    "allowed_overloads", "assert_overloads", "rollout_overloads", "refresh_overloads", "create_overloads",
    "get_overloads", "claim_overloads", "complete_overloads", "fail_overloads",
  ]) if (integer(state?.[key]) !== 1) problems.push(`${key} expected 1`);
  return problems;
}

export function parentGateProblems(state) {
  const safe = safeCounts(state);
  const problems = [];
  if (safe.row_count !== 1) problems.push("parent rollout row count expected 1");
  if (safe.master_count !== 1) problems.push("parent rollout master must remain enabled");
  if (safe.all_clubs_count !== 0) problems.push("parent rollout all-clubs must remain disabled");
  if (safe.hsop_only_count !== 1) problems.push("parent rollout must remain HSOP-only");
  return problems;
}

export function deliveryGateClass(state) {
  const safe = safeCounts(state);
  if (safe.row_count !== 1 || safe.all_clubs_count !== 0) return "unexpected";
  if (safe.master_count === 0 && safe.empty_allowlist_count === 1 && safe.hsop_only_count === 0) return "dark";
  if (safe.master_count === 1 && safe.empty_allowlist_count === 0 && safe.hsop_only_count === 1) return "hsop";
  return "unexpected";
}

export function historyDiagnostics(history) {
  return RETIRED_MIGRATION_NAMES.map((name) => ({ name, matches: history.filter((entry) => entry.name === name).length }));
}

export function repairDecision({ catalog, history, parentGate }) {
  const dependencies = dependencyProblems(catalog);
  if (dependencies.length) return { action: "block", reason: "dependency_unavailable", problems: dependencies };
  const parentProblems = parentGateProblems(parentGate);
  if (parentProblems.length) return { action: "block", reason: "parent_gate_drift", problems: parentProblems };
  const matching = history.filter((entry) => entry.name === REPAIR_MIGRATION.name);
  if (matching.length > 1) return { action: "block", reason: "repair_history_duplicate", problems: ["repair migration name is duplicated"] };
  const state = catalogClass(catalog);
  if (state === "partial") return { action: "block", reason: "partial_catalog_drift", problems: contractProblems(catalog) };
  if (matching.length === 1 && state === "absent") {
    return { action: "block", reason: "repair_tracked_but_absent", problems: ["repair name exists but contract is absent"] };
  }
  if (matching.length === 0 && state === "complete") {
    return { action: "block", reason: "untracked_complete_contract", problems: ["complete contract has no repair migration name"] };
  }
  if (matching.length === 1 && state === "complete") return { action: "skip", reason: "repair_already_verified" };
  return { action: "apply", reason: "exact_absent_contract" };
}

export async function readEvidence(credentials, fetchImpl = fetch) {
  const catalog = await readOnly(credentials, CATALOG_SQL, fetchImpl);
  const parentGate = await readOnly(credentials, PARENT_GATE_SQL, fetchImpl);
  const aggregates = await readOnly(credentials, AGGREGATES_SQL, fetchImpl);
  const history = await listMigrationHistory(credentials, fetchImpl);
  let deliveryGate = null;
  if (catalogClass(catalog) === "complete") deliveryGate = await readOnly(credentials, DELIVERY_GATE_SQL, fetchImpl);
  return { catalog, parentGate, aggregates, history, deliveryGate };
}

async function applyRepair(credentials, sql, fetchImpl) {
  return request({
    ...credentials,
    path: "/database/migrations",
    method: "POST",
    body: { query: sql, name: REPAIR_MIGRATION.name },
    fetchImpl,
  });
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const apply = argv.includes("--repair");
  const preflight = argv.includes("--preflight");
  if (apply === preflight) throw new Error("Choose exactly one of --preflight or --repair");
  const sourceRoot = sourceRootFromArgv(argv);
  const sourceIssues = sourceProblems(sourceRoot);
  if (sourceIssues.length) throw new Error(`SOURCE_POLICY_FAILED: ${sourceIssues.join("; ")}`);
  if (!env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PROJECT_REF !== PROJECT_REF) {
    throw new Error("INVALID_SUPABASE_CREDENTIAL_CONTEXT");
  }
  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const before = await readEvidence(credentials, fetchImpl);
  log("CATALOG_PRE", JSON.stringify(safeCatalog(before.catalog)));
  log("PARENT_GATE_PRE", JSON.stringify(safeCounts(before.parentGate)));
  log("AGGREGATES_PRE", JSON.stringify(safeCounts(before.aggregates)));
  log("HISTORY_DIAGNOSTICS", JSON.stringify(historyDiagnostics(before.history)));
  const decision = repairDecision(before);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") throw new Error(`PAYROLL_DELIVERY_REPAIR_BLOCKED: ${decision.reason}; ${decision.problems.join("; ")}`);
  if (preflight || decision.action === "skip") return { applied: false, before, after: before, decision };
  if (env.CONFIRM_PAYROLL_DELIVERY_REPAIR !== CONFIRMATION) throw new Error("EXACT_REPAIR_CONFIRMATION_MISSING");

  const sql = readFileSync(resolve(sourceRoot, REPAIR_MIGRATION.path), "utf8");
  let acknowledgement = "confirmed";
  try {
    await applyRepair(credentials, sql, fetchImpl);
  } catch {
    acknowledgement = "readback_required";
  }

  const after = await readEvidence(credentials, fetchImpl);
  const afterDecision = repairDecision(after);
  if (catalogClass(after.catalog) !== "complete"
      || after.history.filter((entry) => entry.name === REPAIR_MIGRATION.name).length !== 1
      || parentGateProblems(after.parentGate).length
      || JSON.stringify(safeCounts(after.aggregates)) !== JSON.stringify(safeCounts(before.aggregates))
      || deliveryGateClass(after.deliveryGate) !== "dark") {
    throw new Error(`APPLY_OUTCOME_UNKNOWN_OR_POSTCHECK_FAILED: ${afterDecision.reason}`);
  }
  log("CATALOG_POST", JSON.stringify(safeCatalog(after.catalog)));
  log("DELIVERY_GATE_POST", JSON.stringify(safeCounts(after.deliveryGate)));
  log("AGGREGATES_POST", JSON.stringify(safeCounts(after.aggregates)));
  log("REPAIR_AND_VERIFY_PASS", acknowledgement);
  return { applied: true, before, after, decision, acknowledgement };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[payroll-delivery-repair] FAIL", error.message);
    process.exitCode = 1;
  });
}
