#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLOOR_OWNED,
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  NEVER_APPLY,
  PROJECT_REF,
  createMigrationRequest,
  historyEntryMatchesCandidate,
  migrationEquivalenceProblems,
  selectedMigrationProblems,
} from "./shortage-alert-migration-policy.mjs";

export const CONFIRMATION = "APPLY_DEALER_SHORTAGE_ALERT_20270104000006";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 90_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vinPokerRoot = resolve(scriptDirectory, "..", "..");
const oldCollisionVersion = "20270104000005";
const log = (...values) => console.log("[dealer-shortage-alert-apply]", ...values);

export const STATE_SQL = `with expected as (
  select
    to_regclass('public.dealer_shortage_alert_incidents') as incident_table,
    to_regprocedure('public.advance_dealer_shortage_alert_incident(uuid,text,text,smallint,jsonb,text,boolean,integer,integer)') as advance_oid,
    to_regprocedure('public.complete_dealer_shortage_alert_notification(uuid,uuid,boolean)') as complete_oid,
    to_regprocedure('public.get_my_floor_operator_scope()') as floor_scope_oid
), advance_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.advance_oid
), complete_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.complete_oid
)
select
  e.incident_table is not null as incident_table_exists,
  coalesce((select relrowsecurity from pg_class where oid = e.incident_table), false) as incident_rls_enabled,
  exists(select 1 from pg_class where relname='idx_dealer_shortage_alert_incidents_open' and relnamespace='public'::regnamespace) as incident_open_index_exists,
  (select count(*) from pg_constraint where conrelid=e.incident_table and conname in (
    'dealer_shortage_alert_incidents_club_key_unique',
    'dealer_shortage_alert_incidents_snapshot_object',
    'dealer_shortage_alert_incidents_snapshot_size',
    'dealer_shortage_alert_incidents_error_code_safe'
  )) as incident_constraint_count,
  coalesce(has_table_privilege('service_role', e.incident_table, 'SELECT,INSERT,UPDATE'), false) as incident_service_role_write,
  coalesce(has_table_privilege('authenticated', e.incident_table, 'SELECT'), false) as incident_authenticated_select,
  coalesce(has_table_privilege('anon', e.incident_table, 'SELECT'), false) as incident_anon_select,
  e.advance_oid is not null as advance_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='advance_dealer_shortage_alert_incident') as advance_overloads,
  coalesce((select oidvectortypes(proargtypes) from advance_fn), '') as advance_argument_types,
  coalesce((select pronargdefaults from advance_fn), 0) as advance_default_count,
  coalesce((select format_type(prorettype, null) from advance_fn), '') as advance_return_type,
  coalesce((select l.lanname from advance_fn p join pg_language l on l.oid=p.prolang), '') as advance_language,
  coalesce((select prosecdef from advance_fn), false) as advance_security_definer,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=pg_catalog, public, extensions(,|$)' from advance_fn), false) as advance_search_path,
  coalesce(has_function_privilege('service_role', e.advance_oid, 'EXECUTE'), false) as advance_service_role_execute,
  coalesce(has_function_privilege('authenticated', e.advance_oid, 'EXECUTE'), false) as advance_authenticated_execute,
  coalesce(has_function_privilege('anon', e.advance_oid, 'EXECUTE'), false) as advance_anon_execute,
  coalesce((select exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from advance_fn p), false) as advance_public_execute,
  coalesce((select pg_get_functiondef(oid) like all(array[
    '%p_cooldown_seconds integer DEFAULT 600%',
    '%p_resolution_debounce_seconds integer DEFAULT 120%',
    '%octet_length(p_snapshot::text) > 8000%'
  ]) from advance_fn), false) as advance_lifecycle_contract,
  e.complete_oid is not null as complete_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='complete_dealer_shortage_alert_notification') as complete_overloads,
  coalesce((select oidvectortypes(proargtypes) from complete_fn), '') as complete_argument_types,
  coalesce((select pronargdefaults from complete_fn), 0) as complete_default_count,
  coalesce((select format_type(prorettype, null) from complete_fn), '') as complete_return_type,
  coalesce((select l.lanname from complete_fn p join pg_language l on l.oid=p.prolang), '') as complete_language,
  coalesce((select prosecdef from complete_fn), false) as complete_security_definer,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=pg_catalog, public, extensions(,|$)' from complete_fn), false) as complete_search_path,
  coalesce(has_function_privilege('service_role', e.complete_oid, 'EXECUTE'), false) as complete_service_role_execute,
  coalesce(has_function_privilege('authenticated', e.complete_oid, 'EXECUTE'), false) as complete_authenticated_execute,
  coalesce(has_function_privilege('anon', e.complete_oid, 'EXECUTE'), false) as complete_anon_execute,
  coalesce((select exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from complete_fn p), false) as complete_public_execute,
  (
    e.floor_scope_oid is not null
    and has_function_privilege('authenticated', e.floor_scope_oid, 'EXECUTE')
    and not has_function_privilege('anon', e.floor_scope_oid, 'EXECUTE')
    and not has_function_privilege('service_role', e.floor_scope_oid, 'EXECUTE')
  ) as floor_collision_post_state
from expected e;`;

function firstRow(result) {
  return Array.isArray(result) ? result[0] : result;
}

function safeState(state) {
  return {
    incident_table_exists: state.incident_table_exists,
    incident_rls_enabled: state.incident_rls_enabled,
    incident_open_index_exists: state.incident_open_index_exists,
    incident_constraint_count: Number(state.incident_constraint_count),
    incident_service_role_write: state.incident_service_role_write,
    incident_authenticated_select: state.incident_authenticated_select,
    incident_anon_select: state.incident_anon_select,
    advance_exists: state.advance_exists,
    advance_overloads: Number(state.advance_overloads),
    advance_argument_types: state.advance_argument_types,
    advance_default_count: Number(state.advance_default_count),
    advance_return_type: state.advance_return_type,
    advance_language: state.advance_language,
    advance_security_definer: state.advance_security_definer,
    advance_search_path: state.advance_search_path,
    advance_service_role_execute: state.advance_service_role_execute,
    advance_authenticated_execute: state.advance_authenticated_execute,
    advance_anon_execute: state.advance_anon_execute,
    advance_public_execute: state.advance_public_execute,
    advance_lifecycle_contract: state.advance_lifecycle_contract,
    complete_exists: state.complete_exists,
    complete_overloads: Number(state.complete_overloads),
    complete_argument_types: state.complete_argument_types,
    complete_default_count: Number(state.complete_default_count),
    complete_return_type: state.complete_return_type,
    complete_language: state.complete_language,
    complete_security_definer: state.complete_security_definer,
    complete_search_path: state.complete_search_path,
    complete_service_role_execute: state.complete_service_role_execute,
    complete_authenticated_execute: state.complete_authenticated_execute,
    complete_anon_execute: state.complete_anon_execute,
    complete_public_execute: state.complete_public_execute,
    floor_collision_post_state: state.floor_collision_post_state,
  };
}

export function preStateProblems(state) {
  const problems = [];
  for (const key of [
    "incident_table_exists",
    "incident_open_index_exists",
    "advance_exists",
    "complete_exists",
  ]) {
    if (state[key] === true) problems.push(`${key} is already present`);
  }
  if (Number(state.advance_overloads) !== 0) problems.push("advance_overloads is not zero");
  if (Number(state.complete_overloads) !== 0) problems.push("complete_overloads is not zero");
  return problems;
}

export function postStateProblems(state) {
  const problems = [];
  for (const key of [
    "incident_table_exists",
    "incident_rls_enabled",
    "incident_open_index_exists",
    "incident_service_role_write",
    "advance_exists",
    "advance_security_definer",
    "advance_search_path",
    "advance_service_role_execute",
    "advance_lifecycle_contract",
    "complete_exists",
    "complete_security_definer",
    "complete_search_path",
    "complete_service_role_execute",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of [
    "incident_authenticated_select",
    "incident_anon_select",
    "advance_authenticated_execute",
    "advance_anon_execute",
    "advance_public_execute",
    "complete_authenticated_execute",
    "complete_anon_execute",
    "complete_public_execute",
  ]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  for (const [key, expected] of [
    ["incident_constraint_count", 4],
    ["advance_overloads", 1],
    ["advance_default_count", 2],
    ["complete_overloads", 1],
    ["complete_default_count", 0],
  ]) {
    if (Number(state[key]) !== expected) problems.push(`${key} expected ${expected}`);
  }
  if (state.advance_argument_types !== "uuid, text, text, smallint, jsonb, text, boolean, integer, integer") {
    problems.push("advance argument types do not match exact signature");
  }
  if (state.complete_argument_types !== "uuid, uuid, boolean") {
    problems.push("complete argument types do not match exact signature");
  }
  for (const key of ["advance_return_type", "complete_return_type"]) {
    if (state[key] !== "jsonb") problems.push(`${key} is not jsonb`);
  }
  for (const key of ["advance_language", "complete_language"]) {
    if (state[key] !== "plpgsql") problems.push(`${key} is not plpgsql`);
  }
  return problems;
}

export function historyProblems(history, state) {
  const problems = [];
  const matchingCandidate = history.filter(historyEntryMatchesCandidate);
  const candidateNameEntries = history.filter((entry) => entry?.name === MIGRATION_NAME);
  if (candidateNameEntries.length !== matchingCandidate.length) {
    problems.push("candidate ledger name has an invalid platform version");
  }
  if (matchingCandidate.length > 1) problems.push("candidate migration is duplicated in history");

  const oldEntries = history.filter((entry) => entry?.version === oldCollisionVersion);
  if (oldEntries.length > 0 && state.floor_collision_post_state !== true) {
    problems.push("legacy 20270104000005 exists without verified Floor-owned post-state");
  }
  return problems;
}

export function preApplyDecision(state, history) {
  const historyIssues = historyProblems(history, state);
  if (historyIssues.length) return { action: "block", reason: "history_conflict", problems: historyIssues };

  const candidateRegistered = history.some(historyEntryMatchesCandidate);
  const postProblems = postStateProblems(state);
  if (candidateRegistered && postProblems.length === 0) {
    return { action: "skip", reason: "exact_post_registered", problems: [] };
  }
  if (candidateRegistered) {
    return { action: "block", reason: "registered_contract_drift", problems: postProblems };
  }
  if (postProblems.length === 0) {
    return { action: "block", reason: "exact_post_unregistered", problems: postProblems };
  }
  const preProblems = preStateProblems(state);
  return preProblems.length === 0
    ? { action: "apply", reason: "exact_absent_pre_state", problems: [] }
    : { action: "block", reason: "unknown_pre_state", problems: [...preProblems, ...postProblems] };
}

async function request({ projectRef, token, path, method, body, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
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
  return firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: STATE_SQL },
    fetchImpl,
  }));
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

export function sourcePolicyProblems() {
  return [
    ...selectedMigrationProblems(vinPokerRoot),
    ...migrationEquivalenceProblems(vinPokerRoot),
  ];
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const apply = argv.includes("--apply");
  const preflight = argv.includes("--preflight");
  if (apply === preflight) throw new Error("Choose exactly one of --preflight or --apply");

  const sourceProblems = sourcePolicyProblems();
  if (sourceProblems.length) throw new Error(`Source policy failed: ${sourceProblems.join("; ")}`);
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) {
    throw new Error("Missing required Supabase credential context");
  }
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) {
    throw new Error("Refusing non-approved Supabase project ref");
  }
  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const [before, history] = await Promise.all([
    readState(credentials, fetchImpl),
    listMigrationHistory(credentials, fetchImpl),
  ]);
  log("PRE", JSON.stringify(safeState(before)));
  const decision = preApplyDecision(before, history);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") {
    throw new Error(`Live alert state is not allowlisted: ${decision.problems.join("; ")}`);
  }
  if (preflight) return { applied: false, before, after: before, decision };
  if (env.CONFIRM_APPLY_DEALER_SHORTAGE_ALERT !== CONFIRMATION) {
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
  if (postDecision.action !== "skip") {
    throw new Error(`Post-apply verification failed: ${postDecision.reason}; ${postDecision.problems.join("; ")}`);
  }
  log("APPLY_AND_VERIFY_PASS");
  return { applied: true, before, after, decision: postDecision };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-shortage-alert-apply] FAIL", error.message);
    process.exitCode = 1;
  });
}

export const SUPERSESSION_POLICY = Object.freeze({ NEVER_APPLY, FLOOR_OWNED, ALERT_APPROVED: MIGRATION_PATH });
