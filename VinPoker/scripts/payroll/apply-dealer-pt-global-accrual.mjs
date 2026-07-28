#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASELINE_MIGRATION_VERSION,
  createMigrationRequest,
  historyEntryMatchesCandidate,
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  NEVER_APPLY,
  PROJECT_REF,
  sourcePolicyProblems,
} from "./dealer-pt-global-accrual-migration-policy.mjs";

export const CONFIRMATION = "APPLY_DEALER_PT_WAGE_GLOBAL_CONTINUOUS_ACCRUAL_V2_20270106000001";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 90_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultVinPokerRoot = resolve(scriptDirectory, "..", "..");
const log = (...values) => console.log("[dealer-pt-global-accrual-apply]", ...values);

// This query returns only booleans, counts, and fingerprints. It deliberately
// contains no live IDs, names, payment values, or raw function definitions.
export const STATE_SQL = `with expected as (
  select
    to_regclass('public.dealer_pt_wage_accrual_global_policy') as global_policy_table,
    to_regclass('public.dealer_pt_wage_rate_history') as rate_history_table,
    to_regprocedure('public.get_dealer_pt_wage_global_accrual_policy()') as get_global_oid,
    to_regprocedure('public.set_all_approved_dealer_pt_wage_accrual(boolean,text)') as set_global_oid,
    to_regprocedure('public.assert_dealer_pt_wage_global_activation_ready(timestamp with time zone)') as readiness_oid,
    to_regprocedure('public._pt_wage_balance(uuid)') as balance_oid,
    to_regprocedure('public.pay_part_time_balance(uuid,text,text,text,text)') as payment_oid
), get_global_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.get_global_oid
), set_global_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.set_global_oid
), readiness_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.readiness_oid
), balance_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.balance_oid
), payment_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.payment_oid
)
select
  to_regclass('public.clubs') is not null as clubs_exists,
  to_regclass('public.dealers') is not null as dealers_exists,
  to_regclass('public.dealer_attendance') is not null as attendance_exists,
  to_regclass('public.dealer_pt_wage_accrual_policies') is not null as club_policy_table_exists,
  to_regclass('public.dealer_pt_wage_payments') is not null as payments_table_exists,
  to_regclass('public.payroll_audit_log') is not null as payroll_audit_table_exists,
  to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)') is not null as club_policy_writer_exists,
  e.global_policy_table is not null as global_policy_table_exists,
  e.rate_history_table is not null as rate_history_table_exists,
  coalesce((select relrowsecurity from pg_class where oid = e.global_policy_table), false) as global_policy_rls_enabled,
  coalesce((select relrowsecurity from pg_class where oid = e.rate_history_table), false) as rate_history_rls_enabled,
  coalesce(has_table_privilege('authenticated', e.global_policy_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as global_policy_authenticated_access,
  coalesce(has_table_privilege('anon', e.global_policy_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as global_policy_anon_access,
  coalesce(has_table_privilege('service_role', e.global_policy_table, 'SELECT'), false) as global_policy_service_role_select,
  coalesce(has_table_privilege('authenticated', e.rate_history_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as rate_history_authenticated_access,
  coalesce(has_table_privilege('anon', e.rate_history_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as rate_history_anon_access,
  coalesce(has_table_privilege('service_role', e.rate_history_table, 'SELECT'), false) as rate_history_service_role_select,
  exists(select 1 from pg_attribute where attrelid='public.dealer_pt_wage_payments'::regclass and attname='accrual_policy_snapshot' and not attisdropped) as payment_snapshot_column_exists,
  exists(select 1 from pg_trigger where tgrelid='public.dealers'::regclass and tgname='trg_capture_dealer_pt_wage_rate_history' and not tgisinternal and tgenabled <> 'D') as rate_history_trigger_enabled,
  exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname='idx_dealer_pt_wage_rate_history_dealer_effective') as rate_history_index_exists,
  e.get_global_oid is not null as get_global_exists,
  e.set_global_oid is not null as set_global_exists,
  e.readiness_oid is not null as readiness_exists,
  e.balance_oid is not null as balance_exists,
  e.payment_oid is not null as payment_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_dealer_pt_wage_global_accrual_policy') as get_global_overloads,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='set_all_approved_dealer_pt_wage_accrual') as set_global_overloads,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_dealer_pt_wage_global_activation_ready') as readiness_overloads,
  coalesce((select oidvectortypes(proargtypes) from get_global_fn), '') as get_global_argument_types,
  coalesce((select oidvectortypes(proargtypes) from set_global_fn), '') as set_global_argument_types,
  coalesce((select oidvectortypes(proargtypes) from readiness_fn), '') as readiness_argument_types,
  coalesce((select format_type(prorettype, null) from get_global_fn), '') as get_global_return_type,
  coalesce((select format_type(prorettype, null) from set_global_fn), '') as set_global_return_type,
  coalesce((select format_type(prorettype, null) from readiness_fn), '') as readiness_return_type,
  coalesce((select prosecdef from get_global_fn), false) as get_global_security_definer,
  coalesce((select prosecdef from set_global_fn), false) as set_global_security_definer,
  coalesce((select prosecdef from readiness_fn), false) as readiness_security_definer,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from get_global_fn), false) as get_global_search_path,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from set_global_fn), false) as set_global_search_path,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from readiness_fn), false) as readiness_search_path,
  coalesce(has_function_privilege('authenticated', e.get_global_oid, 'EXECUTE'), false) as get_global_authenticated_execute,
  coalesce(has_function_privilege('anon', e.get_global_oid, 'EXECUTE'), false) as get_global_anon_execute,
  coalesce(has_function_privilege('authenticated', e.set_global_oid, 'EXECUTE'), false) as set_global_authenticated_execute,
  coalesce(has_function_privilege('anon', e.set_global_oid, 'EXECUTE'), false) as set_global_anon_execute,
  coalesce(has_function_privilege('service_role', e.readiness_oid, 'EXECUTE'), false) as readiness_service_role_execute,
  coalesce(has_function_privilege('authenticated', e.readiness_oid, 'EXECUTE'), false) as readiness_authenticated_execute,
  coalesce(has_function_privilege('anon', e.readiness_oid, 'EXECUTE'), false) as readiness_anon_execute,
  coalesce((select exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from get_global_fn p), false) as get_global_public_execute,
  coalesce((select exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from set_global_fn p), false) as set_global_public_execute,
  coalesce((select exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from readiness_fn p), false) as readiness_public_execute,
  coalesce((select pg_get_functiondef(e.balance_oid) like all(array['%rate_segments%', '%pt_eligible%', '%greatest(%', '%extract(epoch from%']) from expected), false) as balance_segment_contract,
  coalesce((select pg_get_functiondef(e.payment_oid) like '%accrual_policy_snapshot%' from expected), false) as payment_snapshot_contract,
  (select count(*) from public.dealer_pt_wage_payments) as payment_row_count,
  (select md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' order by p.id), '')) from public.dealer_pt_wage_payments p) as payment_rows_hash,
  (select count(*) from public.dealer_pt_wage_accrual_policies) as club_policy_row_count,
  (select count(*) from public.dealer_pt_wage_accrual_policies where standby_accrual_enabled) as enabled_club_policy_count,
  (select md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' order by p.club_id), '')) from public.dealer_pt_wage_accrual_policies p) as club_policy_rows_hash,
  (select count(*) from public.dealer_attendance) as attendance_row_count,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.dealer_attendance a) as attendance_rows_hash,
  (select count(*) from public.payroll_audit_log where table_name='dealer_pt_wage_accrual_global_policy' and coalesce(new_values->>'future_club_enabled', '')='true') as global_enable_audit_count,
  (select count(*) from public.payroll_audit_log where table_name='dealer_pt_wage_accrual_global_policy') as global_audit_count
from expected e;`;

export const POST_DATA_STATE_SQL = `select
  (select count(*) from public.dealer_pt_wage_rate_history h join public.dealers d on d.id=h.dealer_id where d.employment_type='part_time' and d.deleted_at is null and h.pt_eligible and h.effective_from <= now()) as active_pt_baseline_count,
  (select count(*) from public.dealers d where d.employment_type='part_time' and d.deleted_at is null) as active_pt_dealer_count,
  (select count(*) from public.dealer_pt_wage_accrual_global_policy where singleton and future_club_enabled) as global_enabled_row_count,
  (select count(*) from public.dealer_pt_wage_accrual_global_policy where singleton) as global_policy_row_count;`;

function firstRow(result) {
  return Array.isArray(result) ? result[0] : result;
}

function number(value) {
  return Number(value ?? 0);
}

export function safeState(state) {
  const safe = {};
  const safeStringKeys = new Set([
    "get_global_argument_types",
    "set_global_argument_types",
    "readiness_argument_types",
    "get_global_return_type",
    "set_global_return_type",
    "readiness_return_type",
  ]);
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key.endsWith("_hash")) safe[key] = typeof value === "string" && /^[a-f0-9]{32}$/u.test(value) ? value : "invalid";
    else if (key.endsWith("_count") || key.endsWith("_overloads") || key.endsWith("_row_count")) safe[key] = number(value);
    else if (safeStringKeys.has(key)) safe[key] = typeof value === "string" ? value : "";
    else safe[key] = value === true;
  }
  return safe;
}

const BASELINE_REQUIRED_TRUE = [
  "clubs_exists",
  "dealers_exists",
  "attendance_exists",
  "club_policy_table_exists",
  "payments_table_exists",
  "payroll_audit_table_exists",
  "club_policy_writer_exists",
  "payment_snapshot_column_exists",
  "balance_exists",
  "payment_exists",
];

const POST_REQUIRED_TRUE = [
  "global_policy_table_exists",
  "rate_history_table_exists",
  "global_policy_rls_enabled",
  "rate_history_rls_enabled",
  "global_policy_service_role_select",
  "rate_history_service_role_select",
  "payment_snapshot_column_exists",
  "rate_history_trigger_enabled",
  "rate_history_index_exists",
  "get_global_exists",
  "set_global_exists",
  "readiness_exists",
  "get_global_security_definer",
  "set_global_security_definer",
  "readiness_security_definer",
  "get_global_search_path",
  "set_global_search_path",
  "readiness_search_path",
  "get_global_authenticated_execute",
  "set_global_authenticated_execute",
  "balance_segment_contract",
  "payment_snapshot_contract",
  "post_data_available",
];

const POST_REQUIRED_FALSE = [
  "global_policy_authenticated_access",
  "global_policy_anon_access",
  "rate_history_authenticated_access",
  "rate_history_anon_access",
  "get_global_anon_execute",
  "set_global_anon_execute",
  "readiness_service_role_execute",
  "readiness_authenticated_execute",
  "readiness_anon_execute",
  "get_global_public_execute",
  "set_global_public_execute",
  "readiness_public_execute",
];

export function preStateProblems(state) {
  const problems = [];
  for (const key of BASELINE_REQUIRED_TRUE) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of [
    "global_policy_table_exists",
    "rate_history_table_exists",
    "rate_history_trigger_enabled",
    "get_global_exists",
    "set_global_exists",
    "readiness_exists",
  ]) {
    if (state[key] === true) problems.push(`${key} is already present`);
  }
  for (const key of ["global_enable_audit_count", "global_audit_count"]) {
    if (number(state[key]) !== 0) problems.push(`${key} is not zero in the dark pre-state`);
  }
  return problems;
}

export function postStateProblems(state) {
  const problems = [];
  for (const key of [...BASELINE_REQUIRED_TRUE, ...POST_REQUIRED_TRUE]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of POST_REQUIRED_FALSE) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  for (const [key, expected] of [
    ["get_global_overloads", 1],
    ["set_global_overloads", 1],
    ["readiness_overloads", 1],
    ["global_policy_row_count", 1],
    ["global_enabled_row_count", 0],
    ["global_enable_audit_count", 0],
    ["global_audit_count", 0],
  ]) {
    if (number(state[key]) !== expected) problems.push(`${key} expected ${expected}`);
  }
  if (state.get_global_argument_types !== "") problems.push("get_global signature is not exact");
  if (state.set_global_argument_types !== "boolean, text") problems.push("set_global signature is not exact");
  if (state.readiness_argument_types !== "timestamp with time zone") problems.push("readiness signature is not exact");
  if (state.get_global_return_type !== "jsonb" || state.set_global_return_type !== "jsonb") {
    problems.push("global policy RPC return type is not jsonb");
  }
  if (state.readiness_return_type !== "void") problems.push("readiness return type is not void");
  if (number(state.active_pt_baseline_count) !== number(state.active_pt_dealer_count)) {
    problems.push("active part-time dealers are missing a rate-history baseline");
  }
  return problems;
}

function historyProblems(history) {
  const problems = [];
  const matching = history.filter(historyEntryMatchesCandidate);
  const candidateNames = history.filter((entry) => entry?.name === MIGRATION_NAME);
  if (matching.length > 1) problems.push("candidate migration is duplicated in ledger history");
  if (candidateNames.length !== matching.length) problems.push("candidate migration has an invalid ledger version");
  if (!history.some((entry) => entry?.version === BASELINE_MIGRATION_VERSION)) {
    problems.push("required 20270105000001 baseline is absent from migration history");
  }
  for (const path of NEVER_APPLY) {
    const forbiddenVersion = path.split("/").pop().slice(0, 14);
    const forbiddenName = path.split("/").pop().replace(/\.sql$/u, "");
    if (history.some((entry) => entry?.version === forbiddenVersion || entry?.name === forbiddenName)) {
      problems.push(`superseded migration is registered: ${forbiddenName}`);
    }
  }
  return problems;
}

export function preApplyDecision(state, history) {
  const historyIssues = historyProblems(history);
  if (historyIssues.length) return { action: "block", reason: "history_conflict", problems: historyIssues };
  const candidateRegistered = history.some(historyEntryMatchesCandidate);
  const postProblems = postStateProblems(state);
  if (candidateRegistered && postProblems.length === 0) {
    return { action: "skip", reason: "exact_post_registered", problems: [] };
  }
  if (candidateRegistered || postProblems.length === 0) {
    return { action: "block", reason: "registered_or_unregistered_post_drift", problems: postProblems };
  }
  const preProblems = preStateProblems(state);
  return preProblems.length === 0
    ? { action: "apply", reason: "exact_dark_pre_state", problems: [] }
    : { action: "block", reason: "unknown_pre_state", problems: [...preProblems, ...postProblems] };
}

export function postApplyProblems(before, after) {
  const problems = postStateProblems(after);
  for (const key of [
    "payment_row_count",
    "payment_rows_hash",
    "club_policy_row_count",
    "enabled_club_policy_count",
    "club_policy_rows_hash",
    "attendance_row_count",
    "attendance_rows_hash",
    "global_enable_audit_count",
  ]) {
    if (before[key] !== after[key]) problems.push(`${key} changed during dark migration apply`);
  }
  return problems;
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
  if (!response.ok) throw new Error(`Management API request failed with status ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export async function listMigrationHistory(credentials, fetchImpl = fetch) {
  const result = await request({ ...credentials, path: "/database/migrations", method: "GET", fetchImpl });
  if (!Array.isArray(result)) throw new Error("Migration history returned an invalid payload");
  return result.map((entry) => ({ version: String(entry?.version ?? ""), name: String(entry?.name ?? "") }));
}

export async function readState(credentials, fetchImpl = fetch) {
  const base = firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: STATE_SQL },
    fetchImpl,
  }));
  if (base.global_policy_table_exists !== true || base.rate_history_table_exists !== true) {
    return {
      ...base,
      post_data_available: false,
      active_pt_baseline_count: 0,
      active_pt_dealer_count: 0,
      global_enabled_row_count: 0,
      global_policy_row_count: 0,
    };
  }
  const postData = firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: POST_DATA_STATE_SQL },
    fetchImpl,
  }));
  return { ...base, ...postData, post_data_available: true };
}

export async function applyManagedMigration(credentials, sql, fetchImpl = fetch) {
  try {
    return await request({
      ...credentials,
      path: "/database/migrations",
      method: "POST",
      body: createMigrationRequest(sql),
      fetchImpl,
    });
  } catch {
    throw new Error(
      "APPLY_OUTCOME_UNKNOWN: exact migration request failed without a trustworthy commit acknowledgement; re-run read-only preflight and do not infer rollback",
    );
  }
}

function sourceRootFromArgv(argv) {
  const index = argv.indexOf("--source-root");
  if (index === -1) return defaultVinPokerRoot;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--source-root requires an explicit directory");
  return resolve(value);
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const apply = argv.includes("--apply");
  const preflight = argv.includes("--preflight");
  if (apply === preflight) throw new Error("Choose exactly one of --preflight or --apply");
  const vinPokerRoot = sourceRootFromArgv(argv);
  const policyProblems = sourcePolicyProblems(vinPokerRoot);
  if (policyProblems.length) throw new Error(`Source policy failed: ${policyProblems.join("; ")}`);
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) {
    throw new Error("Missing required Supabase credential context");
  }
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Refusing non-approved Supabase project ref");

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const [before, history] = await Promise.all([
    readState(credentials, fetchImpl),
    listMigrationHistory(credentials, fetchImpl),
  ]);
  log("PRE", JSON.stringify(safeState(before)));
  const decision = preApplyDecision(before, history);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") {
    throw new Error(`Live payroll state is not allowlisted: ${decision.problems.join("; ")}`);
  }
  if (preflight) return { applied: false, before, after: before, decision };
  if (env.CONFIRM_APPLY_DEALER_PT_GLOBAL_ACCRUAL !== CONFIRMATION) {
    throw new Error("Exact apply confirmation is missing");
  }
  if (decision.action === "skip") return { applied: false, before, after: before, decision };

  const sql = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  log(`APPLY_EXACT ${MIGRATION_VERSION}`);
  await applyManagedMigration(credentials, sql, fetchImpl);
  let after;
  let postHistory;
  try {
    [after, postHistory] = await Promise.all([
      readState(credentials, fetchImpl),
      listMigrationHistory(credentials, fetchImpl),
    ]);
  } catch {
    throw new Error(
      "APPLIED_VERIFY_INCOMPLETE: migration request succeeded but post-commit verification failed; do not infer rollback",
    );
  }
  log("POST", JSON.stringify(safeState(after)));
  const postDecision = preApplyDecision(after, postHistory);
  const drift = postApplyProblems(before, after);
  if (postDecision.action !== "skip" || drift.length) {
    throw new Error(
      `Post-apply verification failed: ${postDecision.reason}; ${[...postDecision.problems, ...drift].join("; ")}`,
    );
  }
  log("APPLY_AND_VERIFY_PASS");
  return { applied: true, before, after, decision: postDecision };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-pt-global-accrual-apply] FAIL", error.message);
    process.exitCode = 1;
  });
}
