#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createMigrationRequest,
  historyEntryMatchesCandidate,
  historyProblems,
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  PROJECT_REF,
  sourcePolicyProblems,
} from "./dealer-pt-wage-readiness-acl-migration-policy.mjs";

export const CONFIRMATION = "APPLY_DEALER_PT_WAGE_READINESS_ACL_20270106000002";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 90_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultVinPokerRoot = resolve(scriptDirectory, "..", "..");
const log = (...values) => console.log("[dealer-pt-wage-readiness-acl-apply]", ...values);

// This protected read-only query intentionally returns no IDs, names, wages,
// timestamps, raw ACLs, SQL bodies, or audit payloads.
export const STATE_SQL = `with expected as (
  select
    to_regclass('public.dealer_pt_wage_accrual_global_policy') as global_policy_table,
    to_regclass('public.dealer_pt_wage_rate_history') as rate_history_table,
    to_regprocedure('public.assert_dealer_pt_wage_global_activation_ready(timestamp with time zone)') as readiness_oid
), readiness_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.readiness_oid
), role_acl as (
  select
    r.rolname,
    a.grantee,
    a.privilege_type
  from readiness_fn p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  join pg_roles r on r.oid = a.grantee
)
select
  e.global_policy_table is not null as global_policy_table_exists,
  e.rate_history_table is not null as rate_history_table_exists,
  e.readiness_oid is not null as readiness_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_dealer_pt_wage_global_activation_ready') as readiness_overloads,
  coalesce((select oidvectortypes(proargtypes) from readiness_fn), '') as readiness_argument_types,
  coalesce((select format_type(prorettype, null) from readiness_fn), '') as readiness_return_type,
  coalesce((select prosecdef from readiness_fn), false) as readiness_security_definer,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from readiness_fn), false) as readiness_search_path,
  coalesce((select p.proowner = r.oid from readiness_fn p join pg_roles r on r.rolname='service_role'), false) as readiness_service_role_is_owner,
  coalesce(has_function_privilege('service_role', e.readiness_oid, 'EXECUTE'), false) as readiness_service_role_execute,
  coalesce(has_function_privilege('authenticated', e.readiness_oid, 'EXECUTE'), false) as readiness_authenticated_execute,
  coalesce(has_function_privilege('anon', e.readiness_oid, 'EXECUTE'), false) as readiness_anon_execute,
  coalesce((select exists(select 1 from role_acl where rolname='service_role' and privilege_type='EXECUTE')), false) as readiness_service_role_explicit_execute,
  coalesce((select exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from readiness_fn p), false) as readiness_public_execute,
  coalesce((select relrowsecurity from pg_class where oid=e.global_policy_table), false) as global_policy_rls_enabled,
  coalesce((select relrowsecurity from pg_class where oid=e.rate_history_table), false) as rate_history_rls_enabled,
  coalesce(has_table_privilege('authenticated', e.global_policy_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as global_policy_authenticated_access,
  coalesce(has_table_privilege('anon', e.global_policy_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as global_policy_anon_access,
  coalesce(has_table_privilege('authenticated', e.rate_history_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as rate_history_authenticated_access,
  coalesce(has_table_privilege('anon', e.rate_history_table, 'SELECT,INSERT,UPDATE,DELETE'), false) as rate_history_anon_access,
  exists(select 1 from pg_attribute where attrelid='public.dealer_pt_wage_payments'::regclass and attname='accrual_policy_snapshot' and not attisdropped) as payment_snapshot_column_exists,
  exists(select 1 from pg_trigger where tgrelid='public.dealers'::regclass and tgname='trg_capture_dealer_pt_wage_rate_history' and not tgisinternal and tgenabled <> 'D') as rate_history_trigger_enabled,
  (select count(*) from public.dealer_pt_wage_accrual_global_policy where singleton) as global_policy_row_count,
  (select count(*) from public.dealer_pt_wage_accrual_global_policy where singleton and future_club_enabled) as global_enabled_row_count,
  (select count(*) from public.payroll_audit_log where table_name='dealer_pt_wage_accrual_global_policy' and coalesce(new_values->>'future_club_enabled', '')='true') as global_enable_audit_count,
  (select count(*) from public.dealer_pt_wage_payments) as payment_row_count,
  (select md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' order by p.id), '')) from public.dealer_pt_wage_payments p) as payment_rows_hash,
  (select count(*) from public.dealer_pt_wage_accrual_policies) as club_policy_row_count,
  (select md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' order by p.club_id), '')) from public.dealer_pt_wage_accrual_policies p) as club_policy_rows_hash,
  (select count(*) from public.dealer_attendance) as attendance_row_count,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.dealer_attendance a) as attendance_rows_hash,
  (select count(*) from public.dealers d where d.employment_type='part_time' and d.deleted_at is null) as active_pt_dealer_count,
  (select count(*) from public.dealer_pt_wage_rate_history h join public.dealers d on d.id=h.dealer_id where d.employment_type='part_time' and d.deleted_at is null and h.pt_eligible and h.effective_from <= now()) as active_pt_baseline_count
from expected e;`;

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function number(value) {
  return Number(value ?? 0);
}

export function safeState(state) {
  const output = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key.endsWith("_hash")) output[key] = typeof value === "string" && /^[a-f0-9]{32}$/u.test(value) ? value : "invalid";
    else if (key.endsWith("_count") || key.endsWith("_overloads")) output[key] = number(value);
    else if (["readiness_argument_types", "readiness_return_type"].includes(key)) output[key] = typeof value === "string" ? value : "";
    else output[key] = value === true;
  }
  return output;
}

const COMMON_REQUIRED_TRUE = [
  "global_policy_table_exists",
  "rate_history_table_exists",
  "readiness_exists",
  "readiness_security_definer",
  "readiness_search_path",
  "global_policy_rls_enabled",
  "rate_history_rls_enabled",
  "payment_snapshot_column_exists",
  "rate_history_trigger_enabled",
];

const COMMON_REQUIRED_FALSE = [
  "readiness_service_role_is_owner",
  "readiness_authenticated_execute",
  "readiness_anon_execute",
  "readiness_public_execute",
  "global_policy_authenticated_access",
  "global_policy_anon_access",
  "rate_history_authenticated_access",
  "rate_history_anon_access",
];

function commonStateProblems(state) {
  const problems = [];
  for (const key of COMMON_REQUIRED_TRUE) if (state[key] !== true) problems.push(`${key} is not true`);
  for (const key of COMMON_REQUIRED_FALSE) if (state[key] !== false) problems.push(`${key} is not false`);
  for (const [key, expected] of [
    ["readiness_overloads", 1],
    ["global_policy_row_count", 1],
    ["global_enabled_row_count", 0],
    ["global_enable_audit_count", 0],
  ]) if (number(state[key]) !== expected) problems.push(`${key} expected ${expected}`);
  if (state.readiness_argument_types !== "timestamp with time zone") problems.push("readiness signature is not exact");
  if (state.readiness_return_type !== "void") problems.push("readiness return type is not void");
  if (number(state.active_pt_baseline_count) !== number(state.active_pt_dealer_count)) {
    problems.push("active part-time dealers are missing a rate-history baseline");
  }
  return problems;
}

export function preStateProblems(state) {
  const problems = commonStateProblems(state);
  if (state.readiness_service_role_execute !== true) problems.push("service_role readiness execute is not present for exact ACL repair");
  if (state.readiness_service_role_explicit_execute !== true) problems.push("service_role readiness execute is not an explicit grant");
  return problems;
}

export function postStateProblems(state) {
  const problems = commonStateProblems(state);
  for (const key of ["readiness_service_role_execute", "readiness_service_role_explicit_execute"]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  return problems;
}

export function preApplyDecision(state, history) {
  const historyIssues = historyProblems(history);
  if (historyIssues.length) return { action: "block", reason: "history_conflict", problems: historyIssues };
  const registered = history.some(historyEntryMatchesCandidate);
  const postProblems = postStateProblems(state);
  if (registered && postProblems.length === 0) return { action: "skip", reason: "exact_post_registered", problems: [] };
  if (registered || postProblems.length === 0) {
    return { action: "block", reason: "registered_or_unregistered_post_drift", problems: postProblems };
  }
  const preProblems = preStateProblems(state);
  return preProblems.length === 0
    ? { action: "apply", reason: "exact_v2_dark_pre_state", problems: [] }
    : { action: "block", reason: "unknown_pre_state", problems: [...preProblems, ...postProblems] };
}

export function postApplyProblems(before, after) {
  const problems = postStateProblems(after);
  for (const key of [
    "payment_row_count",
    "payment_rows_hash",
    "club_policy_row_count",
    "club_policy_rows_hash",
    "attendance_row_count",
    "attendance_rows_hash",
    "global_enabled_row_count",
    "global_enable_audit_count",
  ]) if (before[key] !== after[key]) problems.push(`${key} changed during ACL-only migration apply`);
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

export async function readState(credentials, fetchImpl = fetch) {
  return firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: STATE_SQL },
    fetchImpl,
  }));
}

export async function listMigrationHistory(credentials, fetchImpl = fetch) {
  const history = await request({ ...credentials, path: "/database/migrations", method: "GET", fetchImpl });
  if (!Array.isArray(history)) throw new Error("Migration history returned an invalid payload");
  return history.map((entry) => ({ version: String(entry?.version ?? ""), name: String(entry?.name ?? "") }));
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
    throw new Error("APPLY_OUTCOME_UNKNOWN: exact migration request failed without a trustworthy commit acknowledgement; re-run read-only preflight and do not infer rollback");
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
  const sourceProblems = sourcePolicyProblems(vinPokerRoot);
  if (sourceProblems.length) throw new Error(`Source policy failed: ${sourceProblems.join("; ")}`);
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) throw new Error("Missing required Supabase credential context");
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Refusing non-approved Supabase project ref");

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const [before, history] = await Promise.all([readState(credentials, fetchImpl), listMigrationHistory(credentials, fetchImpl)]);
  log("PRE", JSON.stringify(safeState(before)));
  const decision = preApplyDecision(before, history);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") throw new Error(`Live payroll state is not allowlisted: ${decision.problems.join("; ")}`);
  if (preflight || decision.action === "skip") return { applied: false, before, after: before, decision };
  if (env.CONFIRM_APPLY_DEALER_PT_WAGE_READINESS_ACL !== CONFIRMATION) throw new Error("Exact apply confirmation is missing");

  const sql = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  log(`APPLY_EXACT ${MIGRATION_VERSION}`);
  await applyManagedMigration(credentials, sql, fetchImpl);
  let after;
  let postHistory;
  try {
    [after, postHistory] = await Promise.all([readState(credentials, fetchImpl), listMigrationHistory(credentials, fetchImpl)]);
  } catch {
    throw new Error("APPLIED_VERIFY_INCOMPLETE: migration request succeeded but post-commit verification failed; do not infer rollback");
  }
  log("POST", JSON.stringify(safeState(after)));
  const postDecision = preApplyDecision(after, postHistory);
  const drift = postApplyProblems(before, after);
  if (postDecision.action !== "skip" || drift.length) {
    throw new Error(`Post-apply verification failed: ${postDecision.reason}; ${[...postDecision.problems, ...drift].join("; ")}`);
  }
  log("APPLY_AND_VERIFY_PASS");
  return { applied: true, before, after, decision: postDecision };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-pt-wage-readiness-acl-apply] FAIL", error.message);
    process.exitCode = 1;
  });
}
