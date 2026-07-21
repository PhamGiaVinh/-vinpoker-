#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROJECT_REF,
  applyExactMigration,
  extractFunctionBody,
  managementQuery,
  normalizedFunctionBodyHash,
} from "./apply-floor-clock-control.mjs";

export const MIGRATION_VERSION = "20270104000005";
export const MIGRATION_PATH =
  "supabase/migrations/20270104000005_floor_operator_scope_acl.sql";
export const MIGRATION_SHA256 =
  "6d6fbfa8b6f50e7203e6eb885a8980390fbfe7c8d3e45150e86521fa64a8081f";
export const SCOPE_SOURCE_PATH =
  "supabase/migrations/20261242000000_floor_operator_scope.sql";
export const CONFIRMATION = "APPLY_FLOOR_OPERATOR_SCOPE_ACL_20270104000005";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vinPokerRoot = resolve(scriptDirectory, "..", "..");
const trustedOwners = new Set(["postgres", "supabase_admin"]);
const log = (...values) => console.log("[floor-scope-acl-apply]", ...values);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedLf(value) {
  return value.replace(/\r\n/g, "\n");
}

function stripBodiesAndComments(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const scopeSource = readFileSync(resolve(vinPokerRoot, SCOPE_SOURCE_PATH), "utf8");
export const REVIEWED_SCOPE_BODY_HASH = normalizedFunctionBodyHash(
  extractFunctionBody(scopeSource, "get_my_floor_operator_scope"),
);

export function validateMigration(sql) {
  const problems = [];
  const normalized = normalizedLf(sql);
  const topLevel = stripBodiesAndComments(normalized);
  if (sha256(normalized) !== MIGRATION_SHA256) problems.push("migration checksum mismatch");
  if (!/^\s*BEGIN\s*;/i.test(topLevel)) problems.push("migration is not transaction-wrapped");
  if (!/COMMIT\s*;\s*$/i.test(topLevel)) problems.push("migration does not end with COMMIT");
  if (/schema_migrations/i.test(topLevel)) problems.push("touches schema_migrations");
  if (/\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i.test(topLevel)) {
    problems.push("contains non-ACL mutation");
  }
  if (/\b(?:payout|payment|sepay|staking|escrow)\b/i.test(topLevel)) {
    problems.push("touches a money-path identifier");
  }
  if (!/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_my_floor_operator_scope\(\)\s+FROM\s+PUBLIC,\s*anon,\s*service_role\s*;/i.test(normalized)) {
    problems.push("missing exact runtime-role revoke");
  }
  if (!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_my_floor_operator_scope\(\)\s+TO\s+authenticated\s*;/i.test(normalized)) {
    problems.push("missing exact authenticated grant");
  }
  return problems;
}

export const STATE_SQL = `with expected as (
  select to_regprocedure('public.get_my_floor_operator_scope()') as scope_oid
), scope_fn as (
  select p.* from pg_proc p, expected e where p.oid=e.scope_oid
)
select
  e.scope_oid is not null as scope_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_my_floor_operator_scope') as scope_overloads,
  coalesce((select pg_get_userbyid(proowner) from scope_fn), '') as scope_owner,
  coalesce((select md5(replace(prosrc, chr(13) || chr(10), chr(10))) from scope_fn), '') as scope_hash,
  coalesce((select prosecdef from scope_fn), false) as scope_security_definer,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from scope_fn), false) as scope_search_path,
  coalesce((select provolatile='s' from scope_fn), false) as scope_stable,
  coalesce((select pronargs=0 from scope_fn), false) as scope_zero_inputs,
  coalesce((select proretset from scope_fn), false) as scope_returns_set,
  coalesce((select pg_get_function_result(oid) from scope_fn), '') as scope_result,
  coalesce((select l.lanname from scope_fn p join pg_language l on l.oid=p.prolang), '') as scope_language,
  coalesce(has_function_privilege('authenticated', e.scope_oid, 'EXECUTE'), false) as authenticated_execute,
  coalesce(has_function_privilege('anon', e.scope_oid, 'EXECUTE'), false) as anon_execute,
  coalesce(has_function_privilege('service_role', e.scope_oid, 'EXECUTE'), false) as service_role_execute,
  coalesce((select exists(
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ) from scope_fn p), false) as public_execute,
  coalesce((select (
    select coalesce(jsonb_agg(grantee order by grantee), '[]'::jsonb)
    from (
      select distinct case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
    ) grant_rows
  ) from scope_fn p), '[]'::jsonb) as execute_grantees,
  exists(
    select 1 from supabase_migrations.schema_migrations
    where version='20270104000005'
  ) as migration_registered,
  (
    to_regclass('public.clubs') is not null
    and to_regclass('public.club_cashiers') is not null
    and to_regclass('public.club_floors') is not null
    and to_regprocedure('auth.uid()') is not null
  ) as prerequisites_ok
from expected e;`;

function arraysEqual(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function baseProblems(state) {
  const problems = [];
  for (const key of [
    "scope_exists",
    "scope_security_definer",
    "scope_search_path",
    "scope_stable",
    "scope_zero_inputs",
    "scope_returns_set",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  if (Number(state.scope_overloads) !== 1) problems.push("scope_overloads expected 1");
  if (!trustedOwners.has(state.scope_owner)) problems.push("scope_owner is not trusted");
  if (state.scope_hash !== REVIEWED_SCOPE_BODY_HASH) problems.push("scope_hash is not reviewed");
  if (state.scope_language !== "sql") problems.push("scope_language is not sql");
  if (
    state.scope_result !==
    "TABLE(club_id uuid, can_owner boolean, can_cashier boolean, can_floor boolean)"
  ) {
    problems.push("scope_result does not match exact table contract");
  }
  return problems;
}

function aclProblems(state, expected) {
  const problems = [];
  for (const [key, value] of Object.entries(expected.effective)) {
    if (state[key] !== value) problems.push(`${key} is not ${value}`);
  }
  if (!arraysEqual(state.execute_grantees, expected.grantees)) {
    problems.push("execute_grantees do not match exact ACL state");
  }
  return problems;
}

const PRE_ACL = Object.freeze({
  effective: Object.freeze({
    authenticated_execute: true,
    anon_execute: false,
    service_role_execute: true,
    public_execute: false,
  }),
  grantees: Object.freeze(["authenticated", "service_role"]),
});
const POST_ACL = Object.freeze({
  effective: Object.freeze({
    authenticated_execute: true,
    anon_execute: false,
    service_role_execute: false,
    public_execute: false,
  }),
  grantees: Object.freeze(["authenticated"]),
});

export function contractProblems(state, phase = "post") {
  return [
    ...baseProblems(state),
    ...aclProblems(state, phase === "pre" ? PRE_ACL : POST_ACL),
  ];
}

export function preApplyDecision(state) {
  const postProblems = contractProblems(state, "post");
  if (postProblems.length === 0) {
    return {
      action: "skip",
      reason: state.migration_registered ? "exact_post_registered" : "exact_post_unregistered",
      problems: [],
    };
  }
  if (state.migration_registered === true) {
    return { action: "block", reason: "registered_contract_drift", problems: postProblems };
  }
  const preProblems = contractProblems(state, "pre");
  return preProblems.length === 0
    ? { action: "apply", reason: "exact_known_predecessor", problems: [] }
    : {
        action: "block",
        reason: "unknown_live_drift",
        problems: [...postProblems, ...preProblems],
      };
}

export function postApplyProblems(before, after) {
  const problems = contractProblems(after, "post");
  for (const key of [
    "scope_owner",
    "scope_hash",
    "scope_result",
    "scope_language",
    "scope_security_definer",
    "scope_search_path",
    "scope_stable",
  ]) {
    if (before[key] !== after[key]) problems.push(`${key} changed during ACL apply`);
  }
  if (before.migration_registered !== after.migration_registered) {
    problems.push("schema_migrations registration changed");
  }
  return problems;
}

function firstRow(result) {
  return Array.isArray(result) ? result[0] : result;
}

function safeState(state) {
  return {
    scope_exists: state.scope_exists,
    scope_overloads: Number(state.scope_overloads),
    scope_owner: state.scope_owner,
    scope_hash: state.scope_hash,
    scope_security_definer: state.scope_security_definer,
    scope_search_path: state.scope_search_path,
    scope_stable: state.scope_stable,
    scope_zero_inputs: state.scope_zero_inputs,
    scope_returns_set: state.scope_returns_set,
    scope_result: state.scope_result,
    scope_language: state.scope_language,
    authenticated_execute: state.authenticated_execute,
    anon_execute: state.anon_execute,
    service_role_execute: state.service_role_execute,
    public_execute: state.public_execute,
    execute_grantees: state.execute_grantees,
    migration_registered: state.migration_registered,
    prerequisites_ok: state.prerequisites_ok,
  };
}

async function readState(credentials) {
  return firstRow(await managementQuery({ ...credentials, query: STATE_SQL }));
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const apply = argv.includes("--apply");
  const preflight = argv.includes("--preflight");
  if (apply === preflight) throw new Error("Choose exactly one of --preflight or --apply");

  const sql = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  const migrationProblems = validateMigration(sql);
  if (migrationProblems.length) {
    throw new Error(`Migration safety validation failed: ${migrationProblems.join("; ")}`);
  }
  log(`exact migration checksum PASS (${MIGRATION_VERSION})`);

  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) {
    throw new Error("Missing required Supabase credential context");
  }
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) {
    throw new Error("Refusing non-approved Supabase project ref");
  }
  const credentials = {
    projectRef: env.SUPABASE_PROJECT_REF,
    token: env.SUPABASE_ACCESS_TOKEN,
  };
  const before = await readState(credentials);
  log("PRE", JSON.stringify(safeState(before)));
  if (before.prerequisites_ok !== true) throw new Error("Live prerequisites are incomplete");

  const decision = preApplyDecision(before);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") {
    throw new Error(`Live scope ACL state is not allowlisted: ${decision.problems.join("; ")}`);
  }
  if (preflight) {
    log("PREFLIGHT_PASS");
    return { applied: false, before, after: before };
  }
  if (env.CONFIRM_APPLY_FLOOR_SCOPE_ACL !== CONFIRMATION) {
    throw new Error("Exact apply confirmation is missing");
  }
  if (decision.action === "skip") {
    log("exact scope ACL already live; apply skipped");
    return { applied: false, before, after: before };
  }

  log(`applying exact migration ${MIGRATION_VERSION}`);
  await applyExactMigration(credentials, sql);
  let after;
  try {
    after = await readState(credentials);
  } catch {
    throw new Error(
      "APPLIED_VERIFY_INCOMPLETE: ACL request succeeded but post-commit metadata verification failed; do not infer rollback",
    );
  }
  log("POST", JSON.stringify(safeState(after)));
  const problems = postApplyProblems(before, after);
  if (problems.length) throw new Error(`Post-apply verification failed: ${problems.join("; ")}`);
  log("APPLY_AND_VERIFY_PASS");
  return { applied: true, before, after };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[floor-scope-acl-apply] FAIL", error.message);
    process.exitCode = 1;
  });
}
