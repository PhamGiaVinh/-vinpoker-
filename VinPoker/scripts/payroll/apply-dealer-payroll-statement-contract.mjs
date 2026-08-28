#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const CONFIRMATION = "LEGACY_PAYROLL_STATEMENT_APPLY_RETIRED";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 90_000;

export const MIGRATIONS = Object.freeze([
  {
    version: "20270113000000",
    name: "20270113000000_dealer_payroll_statement_pdf_storage",
    path: "supabase/migration-archive/never-apply/20270113000000_dealer_payroll_statement_pdf_storage.sql",
    sha256: "e5a35741cdf313c13f2be0fed4b9d2fa9a49439c334eba7f81ec2e69af29fe2b",
  },
  {
    version: "20270113000001",
    name: "20270113000001_dealer_payroll_statement_ft_ui_contract",
    path: "supabase/migration-archive/never-apply/20270113000001_dealer_payroll_statement_ft_ui_contract.sql",
    sha256: "1bbf588918b3c15d084c29b3600d87ddbdcc60379986ac679517bfd39b297848",
  },
  {
    version: "20270113000004",
    name: "20270113000004_dealer_payroll_statement_telegram_delivery",
    path: "supabase/migration-archive/never-apply/20270113000004_dealer_payroll_statement_telegram_delivery.sql",
    sha256: "991428a6a30717e5825757a3102b2558e7e5c0569f9accc1130d4b3d292ca5b2",
  },
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultVinPokerRoot = resolve(scriptDirectory, "..", "..");
const log = (...values) => console.log("[dealer-payroll-statement-apply]", ...values);

// Read-only catalog evidence. It returns booleans, counts, signatures, and ACL
// facts only; no payroll rows, PII, financial values, or SQL bodies.
export const STATE_SQL = `with expected as (
  select
    to_regclass('public.dealer_payroll_statements') as statements_table,
    to_regclass('public.dealer_payroll_statement_lines') as lines_table,
    to_regclass('public.dealer_payroll_statement_rollout') as rollout_table,
    to_regclass('storage.buckets') as buckets_table,
    to_regprocedure('public.mark_dealer_payroll_statement_pdf_rendered(uuid,text,text,text)') as mark_oid,
    to_regprocedure('public.get_dealer_payroll_statement_rollout(uuid)') as rollout_oid,
    to_regprocedure('public.preview_full_time_payroll_statement(uuid,uuid,uuid)') as preview_oid,
    to_regprocedure('public.list_full_time_payroll_statements_for_period(uuid,uuid)') as list_oid,
    to_regprocedure('public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid)') as finalize_oid,
    to_regprocedure('public.claim_dealer_payroll_statement_pdf(uuid,uuid)') as claim_oid,
    to_regprocedure('public.complete_dealer_payroll_statement_pdf(uuid,uuid,text,text)') as complete_oid,
    to_regprocedure('public.fail_dealer_payroll_statement_pdf(uuid,uuid,text)') as fail_oid
), functions as (
  select
    e.*,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='mark_dealer_payroll_statement_pdf_rendered') as mark_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_dealer_payroll_statement_rollout') as rollout_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='preview_full_time_payroll_statement') as preview_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_full_time_payroll_statements_for_period') as list_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='finalize_full_time_payroll_statement') as finalize_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_dealer_payroll_statement_pdf') as claim_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_dealer_payroll_statement_pdf') as complete_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fail_dealer_payroll_statement_pdf') as fail_overloads
  from expected e
), columns as (
  select
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='pdf_hash' and not attisdropped) as pdf_hash,
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='pdf_storage_path' and not attisdropped) as pdf_storage_path,
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='pdf_render_version' and not attisdropped) as pdf_render_version,
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='pdf_rendered_at' and not attisdropped) as pdf_rendered_at,
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='statement_version' and not attisdropped) as statement_version,
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='pdf_status' and not attisdropped) as pdf_status,
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='pdf_generation_request_id' and not attisdropped) as pdf_generation_request_id,
    exists(select 1 from pg_attribute where attrelid='public.dealer_payroll_statements'::regclass and attname='pdf_generation_token' and not attisdropped) as pdf_generation_token
)
select
  f.statements_table is not null as statements_table_exists,
  f.lines_table is not null as lines_table_exists,
  f.rollout_table is not null as rollout_table_exists,
  f.buckets_table is not null as buckets_table_exists,
  coalesce((select not bucket.public from storage.buckets bucket where bucket.id='payroll-statements' limit 1), false) as payroll_bucket_private,
  c.pdf_hash, c.pdf_storage_path, c.pdf_render_version, c.pdf_rendered_at,
  c.statement_version, c.pdf_status, c.pdf_generation_request_id, c.pdf_generation_token,
  f.mark_oid is not null as mark_exists,
  f.rollout_oid is not null as rollout_exists,
  f.preview_oid is not null as preview_exists,
  f.list_oid is not null as list_exists,
  f.finalize_oid is not null as finalize_exists,
  f.claim_oid is not null as claim_exists,
  f.complete_oid is not null as complete_exists,
  f.fail_oid is not null as fail_exists,
  f.mark_overloads, f.rollout_overloads, f.preview_overloads, f.list_overloads,
  f.finalize_overloads, f.claim_overloads, f.complete_overloads, f.fail_overloads,
  coalesce(has_function_privilege('service_role', f.mark_oid, 'EXECUTE'), false) as mark_service_execute,
  coalesce(has_function_privilege('authenticated', f.mark_oid, 'EXECUTE'), false) as mark_authenticated_execute,
  coalesce(has_function_privilege('anon', f.mark_oid, 'EXECUTE'), false) as mark_anon_execute,
  coalesce(has_function_privilege('authenticated', f.rollout_oid, 'EXECUTE'), false) as rollout_authenticated_execute,
  coalesce(has_function_privilege('anon', f.rollout_oid, 'EXECUTE'), false) as rollout_anon_execute,
  coalesce(has_function_privilege('authenticated', f.preview_oid, 'EXECUTE'), false) as preview_authenticated_execute,
  coalesce(has_function_privilege('anon', f.preview_oid, 'EXECUTE'), false) as preview_anon_execute,
  coalesce(has_function_privilege('authenticated', f.list_oid, 'EXECUTE'), false) as list_authenticated_execute,
  coalesce(has_function_privilege('anon', f.list_oid, 'EXECUTE'), false) as list_anon_execute,
  coalesce(has_function_privilege('authenticated', f.finalize_oid, 'EXECUTE'), false) as finalize_authenticated_execute,
  coalesce(has_function_privilege('anon', f.finalize_oid, 'EXECUTE'), false) as finalize_anon_execute,
  coalesce(has_function_privilege('service_role', f.claim_oid, 'EXECUTE'), false) as claim_service_execute,
  coalesce(has_function_privilege('authenticated', f.claim_oid, 'EXECUTE'), false) as claim_authenticated_execute,
  coalesce(has_function_privilege('service_role', f.complete_oid, 'EXECUTE'), false) as complete_service_execute,
  coalesce(has_function_privilege('authenticated', f.complete_oid, 'EXECUTE'), false) as complete_authenticated_execute,
  coalesce(has_function_privilege('service_role', f.fail_oid, 'EXECUTE'), false) as fail_service_execute,
  coalesce(has_function_privilege('authenticated', f.fail_oid, 'EXECUTE'), false) as fail_authenticated_execute,
  coalesce((select relrowsecurity from pg_class where oid=f.rollout_table), false) as rollout_rls_enabled
from functions f cross join columns c;`;

// The rollout relation is intentionally absent before the first migration. Keep
// its row checks in a second query so the pre-migration catalog probe remains valid.
export const ROLLOUT_STATE_SQL = `select
  count(*) as rollout_row_count,
  count(*) filter (where master_enabled) as rollout_master_enabled_count,
  count(*) filter (where all_clubs_enabled) as rollout_all_clubs_enabled_count,
  count(*) filter (where coalesce(array_length(allowed_club_ids, 1), 0) > 0) as rollout_allowlist_count
from public.dealer_payroll_statement_rollout;`;

// This query is only executed once the statement/PDF contract is verified.
// It deliberately contains no payroll values or dealer identifiers.
export const DELIVERY_STATE_SQL = `with expected as (
  select
    to_regclass('public.dealer_payroll_statement_delivery_rollout') as rollout_table,
    to_regclass('public.dealer_payroll_delivery_operations') as operations_table,
    to_regclass('public.dealer_payroll_delivery_targets') as targets_table,
    to_regprocedure('public._assert_dealer_payroll_statement_delivery_rollout(uuid)') as assert_oid,
    to_regprocedure('public.get_dealer_payroll_statement_delivery_rollout(uuid)') as rollout_oid,
    to_regprocedure('public.create_dealer_payroll_statement_delivery_operation(uuid,uuid,uuid)') as create_oid,
    to_regprocedure('public.get_dealer_payroll_statement_delivery_operation(uuid)') as get_oid,
    to_regprocedure('public.claim_dealer_payroll_statement_delivery_target(uuid)') as claim_oid,
    to_regprocedure('public.complete_dealer_payroll_statement_delivery_target(uuid,uuid,text,text)') as complete_oid,
    to_regprocedure('public.fail_dealer_payroll_statement_delivery_target(uuid,uuid,text,text,integer)') as fail_oid
), counts as (
  select
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_assert_dealer_payroll_statement_delivery_rollout') as delivery_assert_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_dealer_payroll_statement_delivery_rollout') as delivery_rollout_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_dealer_payroll_statement_delivery_operation') as delivery_create_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_dealer_payroll_statement_delivery_operation') as delivery_get_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_dealer_payroll_statement_delivery_target') as delivery_claim_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'complete_dealer_payroll_statement_delivery_target') as delivery_complete_overloads,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fail_dealer_payroll_statement_delivery_target') as delivery_fail_overloads
)
select
  e.rollout_table is not null as delivery_rollout_table_exists,
  e.operations_table is not null as delivery_operations_table_exists,
  e.targets_table is not null as delivery_targets_table_exists,
  e.assert_oid is not null as delivery_assert_exists,
  e.rollout_oid is not null as delivery_rollout_exists,
  e.create_oid is not null as delivery_create_exists,
  e.get_oid is not null as delivery_get_exists,
  e.claim_oid is not null as delivery_claim_exists,
  e.complete_oid is not null as delivery_complete_exists,
  e.fail_oid is not null as delivery_fail_exists,
  c.delivery_assert_overloads, c.delivery_rollout_overloads, c.delivery_create_overloads,
  c.delivery_get_overloads, c.delivery_claim_overloads, c.delivery_complete_overloads, c.delivery_fail_overloads,
  coalesce(has_function_privilege('service_role', e.assert_oid, 'EXECUTE'), false) as delivery_assert_service_execute,
  coalesce(has_function_privilege('authenticated', e.assert_oid, 'EXECUTE'), false) as delivery_assert_authenticated_execute,
  coalesce(has_function_privilege('anon', e.assert_oid, 'EXECUTE'), false) as delivery_assert_anon_execute,
  coalesce(has_function_privilege('authenticated', e.rollout_oid, 'EXECUTE'), false) as delivery_rollout_authenticated_execute,
  coalesce(has_function_privilege('anon', e.rollout_oid, 'EXECUTE'), false) as delivery_rollout_anon_execute,
  coalesce(has_function_privilege('authenticated', e.create_oid, 'EXECUTE'), false) as delivery_create_authenticated_execute,
  coalesce(has_function_privilege('anon', e.create_oid, 'EXECUTE'), false) as delivery_create_anon_execute,
  coalesce(has_function_privilege('authenticated', e.get_oid, 'EXECUTE'), false) as delivery_get_authenticated_execute,
  coalesce(has_function_privilege('anon', e.get_oid, 'EXECUTE'), false) as delivery_get_anon_execute,
  coalesce(has_function_privilege('service_role', e.claim_oid, 'EXECUTE'), false) as delivery_claim_service_execute,
  coalesce(has_function_privilege('authenticated', e.claim_oid, 'EXECUTE'), false) as delivery_claim_authenticated_execute,
  coalesce(has_function_privilege('service_role', e.complete_oid, 'EXECUTE'), false) as delivery_complete_service_execute,
  coalesce(has_function_privilege('authenticated', e.complete_oid, 'EXECUTE'), false) as delivery_complete_authenticated_execute,
  coalesce(has_function_privilege('service_role', e.fail_oid, 'EXECUTE'), false) as delivery_fail_service_execute,
  coalesce(has_function_privilege('authenticated', e.fail_oid, 'EXECUTE'), false) as delivery_fail_authenticated_execute,
  coalesce((select relrowsecurity from pg_class where oid = e.rollout_table), false) as delivery_rollout_rls_enabled,
  coalesce((select relrowsecurity from pg_class where oid = e.operations_table), false) as delivery_operations_rls_enabled,
  coalesce((select relrowsecurity from pg_class where oid = e.targets_table), false) as delivery_targets_rls_enabled
from expected e cross join counts c;`;

export const DELIVERY_ROLLOUT_STATE_SQL = `select
  count(*) as delivery_rollout_row_count,
  count(*) filter (where master_enabled) as delivery_rollout_master_enabled_count,
  count(*) filter (where all_clubs_enabled) as delivery_rollout_all_clubs_enabled_count,
  count(*) filter (where coalesce(array_length(allowed_club_ids, 1), 0) > 0) as delivery_rollout_allowlist_count
from public.dealer_payroll_statement_delivery_rollout;`;

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function count(value) {
  return Number(value ?? 0);
}

export function safeState(state) {
  const output = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key.endsWith("_count") || key.endsWith("_overloads")) output[key] = count(value);
    else output[key] = value === true;
  }
  return output;
}

const PDF_COLUMNS = ["pdf_hash", "pdf_storage_path", "pdf_render_version", "pdf_rendered_at"];
const V1_COLUMNS = ["statement_version", "pdf_status", "pdf_generation_request_id", "pdf_generation_token"];
const V1_FUNCTIONS = ["rollout_exists", "preview_exists", "list_exists", "finalize_exists", "claim_exists", "complete_exists", "fail_exists"];

export function preStateProblems(state) {
  const problems = [];
  for (const key of ["statements_table_exists", "lines_table_exists", "buckets_table_exists"]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of ["rollout_table_exists", "mark_exists", ...PDF_COLUMNS, ...V1_COLUMNS, ...V1_FUNCTIONS]) {
    if (state[key] === true) problems.push(`${key} is already present`);
  }
  return problems;
}

export function pdfPostProblems(state) {
  const problems = [];
  for (const key of ["statements_table_exists", "lines_table_exists", "buckets_table_exists", "payroll_bucket_private", "mark_exists", ...PDF_COLUMNS]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of ["mark_authenticated_execute", "mark_anon_execute"]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  if (state.mark_service_execute !== true) problems.push("mark_service_execute is not true");
  if (count(state.mark_overloads) !== 1) problems.push("mark_overloads expected 1");
  return problems;
}

export function finalPostProblems(state) {
  const problems = pdfPostProblems(state);
  for (const key of ["rollout_table_exists", "rollout_rls_enabled", ...V1_COLUMNS, ...V1_FUNCTIONS]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of [
    "rollout_anon_execute", "preview_anon_execute", "list_anon_execute", "finalize_anon_execute",
    "claim_authenticated_execute", "complete_authenticated_execute", "fail_authenticated_execute",
  ]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  for (const key of [
    "rollout_authenticated_execute", "preview_authenticated_execute", "list_authenticated_execute",
    "finalize_authenticated_execute", "claim_service_execute", "complete_service_execute", "fail_service_execute",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const [key, expected] of [
    ["rollout_overloads", 1], ["preview_overloads", 1], ["list_overloads", 1], ["finalize_overloads", 1],
    ["claim_overloads", 1], ["complete_overloads", 1], ["fail_overloads", 1],
    ["rollout_row_count", 1], ["rollout_master_enabled_count", 0], ["rollout_all_clubs_enabled_count", 0],
    ["rollout_allowlist_count", 0],
  ]) if (count(state[key]) !== expected) problems.push(`${key} expected ${expected}`);
  return problems;
}

const DELIVERY_OBJECTS = [
  "delivery_rollout_table_exists", "delivery_operations_table_exists", "delivery_targets_table_exists",
  "delivery_assert_exists", "delivery_rollout_exists", "delivery_create_exists", "delivery_get_exists",
  "delivery_claim_exists", "delivery_complete_exists", "delivery_fail_exists",
];

export function deliveryPreProblems(state) {
  const problems = [];
  for (const key of DELIVERY_OBJECTS) {
    if (state[key] === true) problems.push(`${key} is already present`);
  }
  for (const key of [
    "delivery_assert_overloads", "delivery_rollout_overloads", "delivery_create_overloads",
    "delivery_get_overloads", "delivery_claim_overloads", "delivery_complete_overloads", "delivery_fail_overloads",
  ]) {
    if (count(state[key]) !== 0) problems.push(`${key} expected 0`);
  }
  return problems;
}

export function deliveryPostProblems(state) {
  const problems = [...finalPostProblems(state)];
  for (const key of [
    "delivery_rollout_table_exists", "delivery_operations_table_exists", "delivery_targets_table_exists",
    "delivery_rollout_rls_enabled", "delivery_operations_rls_enabled", "delivery_targets_rls_enabled",
    "delivery_assert_exists", "delivery_rollout_exists", "delivery_create_exists", "delivery_get_exists",
    "delivery_claim_exists", "delivery_complete_exists", "delivery_fail_exists",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of [
    "delivery_assert_authenticated_execute", "delivery_assert_anon_execute",
    "delivery_rollout_anon_execute", "delivery_create_anon_execute", "delivery_get_anon_execute",
    "delivery_claim_authenticated_execute", "delivery_complete_authenticated_execute", "delivery_fail_authenticated_execute",
  ]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  for (const key of [
    "delivery_assert_service_execute", "delivery_rollout_authenticated_execute",
    "delivery_create_authenticated_execute", "delivery_get_authenticated_execute",
    "delivery_claim_service_execute", "delivery_complete_service_execute", "delivery_fail_service_execute",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of [
    "delivery_assert_overloads", "delivery_rollout_overloads", "delivery_create_overloads",
    "delivery_get_overloads", "delivery_claim_overloads", "delivery_complete_overloads", "delivery_fail_overloads",
  ]) if (count(state[key]) !== 1) problems.push(`${key} expected 1`);
  for (const [key, expected] of [
    ["delivery_rollout_row_count", 1], ["delivery_rollout_master_enabled_count", 0],
    ["delivery_rollout_all_clubs_enabled_count", 0], ["delivery_rollout_allowlist_count", 0],
  ]) if (count(state[key]) !== expected) problems.push(`${key} expected ${expected}`);
  return problems;
}

export function stageForState(state) {
  const pre = preStateProblems(state);
  if (pre.length === 0) return "pre";
  if (pdfPostProblems(state).length === 0 && finalPostProblems(state).length > 0) return "pdf_ready";
  if (finalPostProblems(state).length === 0 && deliveryPostProblems(state).length === 0) return "complete";
  if (finalPostProblems(state).length === 0 && deliveryPreProblems(state).length === 0) return "statement_ready";
  return "unknown";
}

export function sourceProblems(sourceRoot) {
  const problems = [];
  for (const migration of MIGRATIONS) {
    const path = resolve(sourceRoot, migration.path);
    let sql;
    try {
      sql = readFileSync(path, "utf8");
    } catch {
      problems.push(`${migration.version} source file missing`);
      continue;
    }
    const normalized = sql.replace(/\r\n/g, "\n");
    const hash = createHash("sha256").update(normalized).digest("hex");
    if (hash !== migration.sha256) problems.push(`${migration.version} checksum mismatch`);
    if (/schema_migrations/i.test(normalized)) problems.push(`${migration.version} touches schema_migrations`);
    if (!/\bbegin\s*;/i.test(normalized) || !/commit;\s*$/i.test(normalized)) problems.push(`${migration.version} is not transaction wrapped`);
    const sqlWithoutComments = normalized.replace(/--[^\n]*/g, "");
    // Delivery migration replaces one named check constraint to extend a closed
    // status enum. It is the only permitted DROP form in this exact runner.
    const withoutApprovedConstraintReplacement = migration.version === "20270113000004"
      ? sqlWithoutComments.replace(
        /alter\s+table\s+public\.dealer_payroll_delivery_attempts\s+drop\s+constraint\s+if\s+exists\s+dealer_payroll_delivery_attempts_status_check\s*;/gi,
        "",
      )
      : sqlWithoutComments;
    if (/\b(drop|truncate)\b/i.test(withoutApprovedConstraintReplacement)) {
      problems.push(`${migration.version} contains destructive DDL`);
    }
  }
  return problems;
}

function sourceRootFromArgv(argv) {
  const index = argv.indexOf("--source-root");
  if (index === -1) return defaultVinPokerRoot;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--source-root requires an explicit directory");
  return resolve(value);
}

function safeProviderCode(payload) {
  const candidates = [payload?.code, payload?.error_code, payload?.errorCode];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (/^[A-Z0-9_]{3,32}$/.test(value)) return value;
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
    throw new Error("Management API network request failed");
  }
  if (!response.ok) {
    let providerCode = "UNKNOWN";
    try {
      providerCode = safeProviderCode(await response.json());
    } catch {
      // Keep the diagnostic sanitized when an error body is not JSON.
    }
    throw new Error(`Management API request failed: ${method} ${path} status ${response.status} provider_code ${providerCode}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function readState(credentials, fetchImpl = fetch) {
  let state = firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: STATE_SQL },
    fetchImpl,
  }));
  if (state?.rollout_table_exists !== true) {
    state = {
      ...state,
      rollout_row_count: 0,
      rollout_master_enabled_count: 0,
      rollout_all_clubs_enabled_count: 0,
      rollout_allowlist_count: 0,
    };
  } else {
    const rollout = firstRow(await request({
      ...credentials,
      path: "/database/query/read-only",
      method: "POST",
      body: { query: ROLLOUT_STATE_SQL },
      fetchImpl,
    }));
    state = { ...state, ...rollout };
  }

  if (finalPostProblems(state).length !== 0) return state;

  const delivery = firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: DELIVERY_STATE_SQL },
    fetchImpl,
  }));
  state = { ...state, ...delivery };
  if (state.delivery_rollout_table_exists !== true) {
    return {
      ...state,
      delivery_rollout_row_count: 0,
      delivery_rollout_master_enabled_count: 0,
      delivery_rollout_all_clubs_enabled_count: 0,
      delivery_rollout_allowlist_count: 0,
    };
  }
  const deliveryRollout = firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: DELIVERY_ROLLOUT_STATE_SQL },
    fetchImpl,
  }));
  return { ...state, ...deliveryRollout };
}

export async function listMigrationHistory(credentials, fetchImpl = fetch) {
  const result = await request({ ...credentials, path: "/database/migrations", method: "GET", fetchImpl });
  if (!Array.isArray(result)) throw new Error("Migration history returned an invalid payload");
  return result.map((entry) => ({ version: String(entry?.version ?? ""), name: String(entry?.name ?? "") }));
}

function historyProblems(history) {
  const problems = [];
  for (const migration of MIGRATIONS) {
    const entries = history.filter((entry) => entry.version === migration.version);
    if (entries.length > 1) problems.push(`${migration.version} is duplicated in ledger history`);
    if (entries.length === 1 && entries[0].name !== migration.name) problems.push(`${migration.version} has unexpected ledger name`);
  }
  return problems;
}

export function applyPlan(state, history) {
  const historyIssues = historyProblems(history);
  if (historyIssues.length) return { action: "block", reason: "history_conflict", problems: historyIssues };
  const stage = stageForState(state);
  if (stage === "complete") return { action: "skip", reason: "exact_post_verified", migrations: [] };
  if (stage === "pre") return { action: "apply", reason: "exact_pre_state", migrations: MIGRATIONS };
  if (stage === "pdf_ready") return { action: "apply", reason: "first_migration_verified", migrations: MIGRATIONS.slice(1) };
  if (stage === "statement_ready") return { action: "apply", reason: "statement_contract_verified", migrations: [MIGRATIONS[2]] };
  return {
    action: "block",
    reason: "unknown_live_state",
    problems: [...preStateProblems(state), ...finalPostProblems(state), ...deliveryPreProblems(state), ...deliveryPostProblems(state)],
  };
}

export async function applyManagedMigration(credentials, migration, sql, fetchImpl = fetch) {
  try {
    return await request({
      ...credentials,
      path: "/database/migrations",
      method: "POST",
      body: { query: sql, name: migration.name },
      fetchImpl,
    });
  } catch {
    throw new Error(`APPLY_OUTCOME_UNKNOWN: ${migration.version} request failed without trustworthy commit acknowledgement`);
  }
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const apply = argv.includes("--apply");
  const preflight = argv.includes("--preflight");
  if (apply === preflight) throw new Error("Choose exactly one of --preflight or --apply");
  if (apply) {
    throw new Error(
      "LEGACY_PAYROLL_STATEMENT_APPLY_RETIRED: use the exact forward-only migration workflow; historical 00000/00001/00004 cannot be replayed",
    );
  }
  const sourceRoot = sourceRootFromArgv(argv);
  const sourceIssues = sourceProblems(sourceRoot);
  if (sourceIssues.length) throw new Error(`Source policy failed: ${sourceIssues.join("; ")}`);
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) throw new Error("Missing required Supabase credential context");
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Refusing non-approved Supabase project ref");

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const [before, history] = await Promise.all([readState(credentials, fetchImpl), listMigrationHistory(credentials, fetchImpl)]);
  log("PRE", JSON.stringify(safeState(before)));
  log("LEDGER", JSON.stringify(history.map((entry) => ({ version: entry.version, name: entry.name }))));
  const plan = applyPlan(before, history);
  log(`DECISION_${plan.action.toUpperCase()}`, plan.reason);
  if (plan.action === "block") throw new Error(`Live payroll statement state is not allowlisted: ${plan.problems.join("; ")}`);
  if (preflight || plan.action === "skip") return { applied: false, before, after: before, plan };
  if (env.CONFIRM_APPLY_DEALER_PAYROLL_STATEMENT_CONTRACT !== CONFIRMATION) throw new Error("Exact apply confirmation is missing");

  let state = before;
  for (const migration of plan.migrations) {
    const sql = readFileSync(resolve(sourceRoot, migration.path), "utf8");
    log(`APPLY_EXACT ${migration.version}`);
    await applyManagedMigration(credentials, migration, sql, fetchImpl);
    state = await readState(credentials, fetchImpl);
    const problems = migration.version === MIGRATIONS[0].version
      ? pdfPostProblems(state)
      : migration.version === MIGRATIONS[1].version
        ? finalPostProblems(state)
        : deliveryPostProblems(state);
    if (problems.length) throw new Error(`Post-apply verification failed for ${migration.version}: ${problems.join("; ")}`);
    log(`POST_${migration.version}`, JSON.stringify(safeState(state)));
  }
  const finalProblems = deliveryPostProblems(state);
  if (finalProblems.length) throw new Error(`Final post-apply verification failed: ${finalProblems.join("; ")}`);
  log("APPLY_AND_VERIFY_PASS");
  return { applied: true, before, after: state, plan };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-payroll-statement-apply] FAIL", error.message);
    process.exitCode = 1;
  });
}
