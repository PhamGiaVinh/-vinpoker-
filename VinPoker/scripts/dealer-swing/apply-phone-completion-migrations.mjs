#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONFIRMATION,
  MIGRATIONS,
  PROJECT_REF,
  createMigrationRequest,
  historyEntryMatches,
  migrationPath,
  sourcePolicyProblems,
} from "./phone-completion-migration-policy.mjs";

export const MANAGEMENT_REQUEST_TIMEOUT_MS = 90_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vinPokerRoot = resolve(scriptDirectory, "..", "..");
const log = (...values) => console.log("[dealer-swing-phone-apply]", ...values);

export const STATE_SQL = `
WITH refs AS (
  SELECT
    to_regclass('public.dealer_swing_phone_rollout') AS rollout_table,
    to_regclass('public.operator_dealer_checkin_requests') AS checkin_requests_table,
    to_regclass('public.dealer_phone_close_requests') AS close_requests_table,
    to_regprocedure('public.get_dealer_swing_phone_rollout(uuid)') AS get_rollout_oid,
    to_regprocedure('public.operator_check_in_dealers(uuid,uuid,jsonb)') AS checkin_oid,
    to_regprocedure('public._dealer_phone_close_state(uuid,uuid[])') AS close_state_oid,
    to_regprocedure('public.close_dealer_tables(uuid,uuid,uuid[])') AS legacy_close_oid,
    to_regprocedure('public.close_dealer_tables(uuid,uuid,uuid,uuid[],jsonb,boolean)') AS guarded_close_oid,
    to_regprocedure('public.reconcile_dealer_room_state(uuid,jsonb,timestamp with time zone,text,jsonb,boolean,boolean)') AS canonical_reconcile_oid,
    to_regprocedure('public.dealer_phone_reconcile_room_state(uuid,jsonb,timestamp with time zone,text,jsonb,boolean,boolean)') AS phone_reconcile_oid,
    to_regprocedure('public._dealer_record_checkin(uuid,text)') AS record_checkin_oid,
    to_regprocedure('public._dealer_scheduled_pool_enabled()') AS pool_enabled_oid,
    to_regprocedure('public.bridge_shift_checkins_to_pool()') AS pool_bridge_oid
), fn_counts AS (
  SELECT
    count(*) FILTER (WHERE n.nspname = 'public' AND p.proname = 'get_dealer_swing_phone_rollout') AS get_rollout_overloads,
    count(*) FILTER (WHERE n.nspname = 'public' AND p.proname = 'operator_check_in_dealers') AS checkin_overloads,
    count(*) FILTER (WHERE n.nspname = 'public' AND p.proname = 'close_dealer_tables') AS close_overloads,
    count(*) FILTER (WHERE n.nspname = 'public' AND p.proname = 'dealer_phone_reconcile_room_state') AS phone_reconcile_overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
)
SELECT
  r.rollout_table IS NOT NULL AS rollout_table_exists,
  r.checkin_requests_table IS NOT NULL AS checkin_requests_table_exists,
  r.close_requests_table IS NOT NULL AS close_requests_table_exists,
  COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = r.rollout_table), false) AS rollout_rls_enabled,
  COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = r.checkin_requests_table), false) AS checkin_requests_rls_enabled,
  COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = r.close_requests_table), false) AS close_requests_rls_enabled,
  r.get_rollout_oid IS NOT NULL AS get_rollout_exists,
  r.checkin_oid IS NOT NULL AS checkin_exists,
  r.close_state_oid IS NOT NULL AS close_state_exists,
  r.legacy_close_oid IS NOT NULL AS legacy_close_exists,
  r.guarded_close_oid IS NOT NULL AS guarded_close_exists,
  r.canonical_reconcile_oid IS NOT NULL AS canonical_reconcile_exists,
  r.phone_reconcile_oid IS NOT NULL AS phone_reconcile_exists,
  r.record_checkin_oid IS NOT NULL AS record_checkin_exists,
  r.pool_enabled_oid IS NOT NULL AS pool_enabled_exists,
  r.pool_bridge_oid IS NOT NULL AS pool_bridge_exists,
  c.get_rollout_overloads,
  c.checkin_overloads,
  c.close_overloads,
  c.phone_reconcile_overloads,
  COALESCE(has_function_privilege('authenticated', r.get_rollout_oid, 'EXECUTE'), false) AS get_rollout_authenticated_execute,
  COALESCE(has_function_privilege('anon', r.get_rollout_oid, 'EXECUTE'), false) AS get_rollout_anon_execute,
  COALESCE(has_function_privilege('authenticated', r.checkin_oid, 'EXECUTE'), false) AS checkin_authenticated_execute,
  COALESCE(has_function_privilege('anon', r.checkin_oid, 'EXECUTE'), false) AS checkin_anon_execute,
  COALESCE(has_function_privilege('authenticated', r.guarded_close_oid, 'EXECUTE'), false) AS guarded_close_authenticated_execute,
  COALESCE(has_function_privilege('anon', r.guarded_close_oid, 'EXECUTE'), false) AS guarded_close_anon_execute,
  COALESCE(has_function_privilege('authenticated', r.phone_reconcile_oid, 'EXECUTE'), false) AS phone_reconcile_authenticated_execute,
  COALESCE(has_function_privilege('anon', r.phone_reconcile_oid, 'EXECUTE'), false) AS phone_reconcile_anon_execute,
  COALESCE((SELECT prosecdef FROM pg_proc WHERE oid = r.get_rollout_oid), false) AS get_rollout_security_definer,
  COALESCE((SELECT prosecdef FROM pg_proc WHERE oid = r.checkin_oid), false) AS checkin_security_definer,
  COALESCE((SELECT prosecdef FROM pg_proc WHERE oid = r.guarded_close_oid), false) AS guarded_close_security_definer,
  COALESCE((SELECT prosecdef FROM pg_proc WHERE oid = r.phone_reconcile_oid), false) AS phone_reconcile_security_definer,
  COALESCE((SELECT scheduled_pool_enabled FROM public.dealer_selfcheckin_config WHERE id), false) AS pool_config_enabled,
  EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'dealer-app-pool-bridge'
      AND command LIKE '%bridge_shift_checkins_to_pool%'
  ) AS pool_bridge_job_exists
FROM refs r
CROSS JOIN fn_counts c;`;

export const ROLLOUT_STATE_SQL = `
SELECT
  NOT enabled AS master_disabled,
  NOT all_clubs_enabled AS all_clubs_disabled,
  cardinality(allowed_club_ids) = 0 AS allowlist_empty
FROM public.dealer_swing_phone_rollout
WHERE id;`;

function firstRow(result) {
  return Array.isArray(result) ? result[0] : result;
}

function number(value) {
  return Number(value ?? 0);
}

function rolloutDefaults(state) {
  return state?.rollout?.master_disabled === true
    && state.rollout.all_clubs_disabled === true
    && state.rollout.allowlist_empty === true;
}

export function safeState(state) {
  const keys = [
    "rollout_table_exists", "checkin_requests_table_exists", "close_requests_table_exists",
    "rollout_rls_enabled", "checkin_requests_rls_enabled", "close_requests_rls_enabled",
    "get_rollout_exists", "checkin_exists", "close_state_exists", "legacy_close_exists",
    "guarded_close_exists", "canonical_reconcile_exists", "phone_reconcile_exists",
    "record_checkin_exists", "pool_enabled_exists", "pool_bridge_exists", "pool_config_enabled", "pool_bridge_job_exists",
    "get_rollout_authenticated_execute", "get_rollout_anon_execute",
    "checkin_authenticated_execute", "checkin_anon_execute",
    "guarded_close_authenticated_execute", "guarded_close_anon_execute",
    "phone_reconcile_authenticated_execute", "phone_reconcile_anon_execute",
    "get_rollout_security_definer", "checkin_security_definer",
    "guarded_close_security_definer", "phone_reconcile_security_definer",
  ];
  const output = Object.fromEntries(keys.map((key) => [key, state[key] === true]));
  output.get_rollout_overloads = number(state.get_rollout_overloads);
  output.checkin_overloads = number(state.checkin_overloads);
  output.close_overloads = number(state.close_overloads);
  output.phone_reconcile_overloads = number(state.phone_reconcile_overloads);
  output.rollout_defaults_off = rolloutDefaults(state);
  return output;
}

export function dependencyProblems(state) {
  const problems = [];
  for (const key of [
    "legacy_close_exists", "canonical_reconcile_exists", "record_checkin_exists",
    "pool_enabled_exists", "pool_bridge_exists", "pool_config_enabled", "pool_bridge_job_exists",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  return problems;
}

function bootstrapPostProblems(state, requireDarkRuntimeDefaults = true) {
  const problems = [];
  for (const key of [
    "rollout_table_exists", "checkin_requests_table_exists", "rollout_rls_enabled",
    "checkin_requests_rls_enabled", "get_rollout_exists", "checkin_exists",
    "get_rollout_authenticated_execute", "checkin_authenticated_execute",
    "get_rollout_security_definer", "checkin_security_definer",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of ["get_rollout_anon_execute", "checkin_anon_execute"]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  if (number(state.get_rollout_overloads) !== 1) problems.push("get_rollout_overloads is not 1");
  if (number(state.checkin_overloads) !== 1) problems.push("checkin_overloads is not 1");
  if (requireDarkRuntimeDefaults && !rolloutDefaults(state)) {
    problems.push("runtime rollout defaults are not OFF with an empty allowlist");
  }
  return problems;
}

function closePostProblems(state) {
  const problems = [];
  for (const key of [
    "close_requests_table_exists", "close_requests_rls_enabled", "close_state_exists",
    "guarded_close_exists", "phone_reconcile_exists", "guarded_close_authenticated_execute",
    "phone_reconcile_authenticated_execute", "guarded_close_security_definer",
    "phone_reconcile_security_definer",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const key of ["guarded_close_anon_execute", "phone_reconcile_anon_execute"]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  if (number(state.close_overloads) !== 2) problems.push("close_overloads is not 2");
  if (number(state.phone_reconcile_overloads) !== 1) problems.push("phone_reconcile_overloads is not 1");
  return problems;
}

function anyBootstrapArtifact(state) {
  return ["rollout_table_exists", "checkin_requests_table_exists", "get_rollout_exists", "checkin_exists"]
    .some((key) => state[key] === true);
}

function anyCloseArtifact(state) {
  return ["close_requests_table_exists", "close_state_exists", "guarded_close_exists", "phone_reconcile_exists"]
    .some((key) => state[key] === true);
}

export function preApplyDecision(state, history) {
  const dependencyIssues = dependencyProblems(state);
  if (dependencyIssues.length) return { action: "block", reason: "missing_prerequisite", problems: dependencyIssues };

  const matched = new Map(MIGRATIONS.map((migration) => [migration.name, history.filter((entry) => historyEntryMatches(entry, migration))]));
  for (const [name, entries] of matched) {
    if (entries.length > 1) return { action: "block", reason: "duplicate_ledger_entry", problems: [`${name} is duplicated`] };
  }

  const bootstrapRegistered = matched.get(MIGRATIONS[0].name).length === 1;
  const closeRegistered = matched.get(MIGRATIONS[1].name).length === 1;
  const bootstrapIssues = bootstrapPostProblems(state);
  const closeIssues = closePostProblems(state);

  if (bootstrapRegistered && closeRegistered) {
    const problems = [...bootstrapIssues, ...closeIssues];
    return problems.length === 0
      ? { action: "skip", reason: "exact_post_registered", problems: [] }
      : { action: "block", reason: "registered_contract_drift", problems };
  }

  if (!bootstrapRegistered && !closeRegistered) {
    if (anyBootstrapArtifact(state) || anyCloseArtifact(state)) {
      return { action: "block", reason: "unregistered_phone_objects", problems: [...bootstrapIssues, ...closeIssues] };
    }
    return { action: "apply_both", reason: "exact_absent_pre_state", problems: [] };
  }

  if (bootstrapRegistered && !closeRegistered) {
    if (bootstrapIssues.length === 0 && !anyCloseArtifact(state)) {
      return { action: "apply_close", reason: "bootstrap_registered_close_absent", problems: [] };
    }
    return { action: "block", reason: "partial_contract_drift", problems: [...bootstrapIssues, ...closeIssues] };
  }

  return { action: "block", reason: "invalid_ledger_order", problems: ["close migration is registered before bootstrap migration"] };
}

export function runtimeSchemaDecision(state, history) {
  const problems = [];
  for (const migration of MIGRATIONS) {
    const namedEntries = history.filter((entry) => entry?.name === migration.name);
    if (namedEntries.length !== 1 || !historyEntryMatches(namedEntries[0], migration)) {
      problems.push(`${migration.name} is not exactly registered`);
    }
  }
  problems.push(
    ...dependencyProblems(state),
    ...bootstrapPostProblems(state, false),
    ...closePostProblems(state),
  );
  return problems.length === 0
    ? { action: "ready", reason: "exact_schema_registered", problems: [] }
    : { action: "block", reason: "schema_contract_drift", problems };
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
  if (!base?.rollout_table_exists) return { ...base, rollout: null };
  const rollout = firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: ROLLOUT_STATE_SQL },
    fetchImpl,
  }));
  return { ...base, rollout };
}

export async function applyManagedMigration(credentials, migration, sql, fetchImpl = fetch) {
  try {
    return await request({
      ...credentials,
      path: "/database/migrations",
      method: "POST",
      body: createMigrationRequest(migration, sql),
      fetchImpl,
    });
  } catch {
    throw new Error(
      `APPLY_OUTCOME_UNKNOWN: ${migration.name} request failed without a trustworthy commit acknowledgement; re-run read-only preflight and do not infer rollback`,
    );
  }
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const apply = argv.includes("--apply");
  const preflight = argv.includes("--preflight");
  if (apply === preflight) throw new Error("Choose exactly one of --preflight or --apply");

  const sourceProblems = sourcePolicyProblems(vinPokerRoot);
  if (sourceProblems.length) throw new Error(`Source policy failed: ${sourceProblems.join("; ")}`);
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) {
    throw new Error("Missing required Supabase credential context");
  }
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Refusing non-approved Supabase project ref");
  if (apply && env.CONFIRM_APPLY_DEALER_SWING_PHONE_COMPLETION !== CONFIRMATION) {
    throw new Error("Exact apply confirmation is missing");
  }

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  let [state, history] = await Promise.all([readState(credentials, fetchImpl), listMigrationHistory(credentials, fetchImpl)]);
  let decision = preApplyDecision(state, history);
  log("PRE", JSON.stringify(safeState(state)));
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") throw new Error(`Live phone state is not allowlisted: ${decision.problems.join("; ")}`);
  if (preflight || decision.action === "skip") return { applied: [], state, decision };

  const pending = decision.action === "apply_both" ? MIGRATIONS : [MIGRATIONS[1]];
  const applied = [];
  for (const migration of pending) {
    const sql = readFileSync(resolve(vinPokerRoot, migrationPath(migration)), "utf8");
    log(`APPLY_EXACT ${migration.name}`);
    await applyManagedMigration(credentials, migration, sql, fetchImpl);
    applied.push(migration.name);
    try {
      [state, history] = await Promise.all([readState(credentials, fetchImpl), listMigrationHistory(credentials, fetchImpl)]);
    } catch {
      throw new Error("APPLIED_VERIFY_INCOMPLETE: migration request succeeded but post-commit verification failed; do not infer rollback");
    }
    decision = preApplyDecision(state, history);
    log("POST", JSON.stringify(safeState(state)));
    if (decision.action === "block") throw new Error(`Post-apply verification failed: ${decision.reason}; ${decision.problems.join("; ")}`);
  }

  if (decision.action !== "skip") throw new Error(`Post-apply verification incomplete: ${decision.reason}`);
  log("APPLY_AND_VERIFY_PASS");
  return { applied, state, decision };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-swing-phone-apply] FAIL", error.message);
    process.exitCode = 1;
  });
}
