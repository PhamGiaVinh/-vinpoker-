#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const MIGRATION_VERSION = "20270104000004";
export const MIGRATION_PATH =
  "supabase/migrations/20270104000004_floor_clock_control_atomic.sql";
export const PREDECESSOR_START_MIGRATION_PATH =
  "supabase/migrations/20261241000000_floor_clock_start_atomic.sql";
export const PREDECESSOR_GET_MIGRATION_PATH =
  "supabase/migrations/20260608000001_tournament_live_tracker.sql";
export const MIGRATION_SHA256 =
  "20e63d51c3f910ea69c4a179162ab36b7a6196a01fd5f650c35eab0eed263e24";
export const CONFIRMATION = "APPLY_FLOOR_CLOCK_CONTROL_20270104000004";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 90_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vinPokerRoot = resolve(scriptDirectory, "..", "..");

const log = (...values) => console.log("[floor-clock-apply]", ...values);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function md5(value) {
  return createHash("md5").update(value).digest("hex");
}

function normalizedLf(value) {
  return value.replace(/\r\n/g, "\n");
}

export function normalizedFunctionBodyHash(value) {
  return md5(normalizedLf(value));
}

export function extractFunctionBody(sql, functionName) {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${escapedName}\\s*\\(`,
    "i",
  );
  const headerMatch = header.exec(sql);
  if (!headerMatch) throw new Error(`Missing reviewed function ${functionName}`);

  const definition = sql.slice(headerMatch.index);
  const bodyStartMatch = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(definition);
  if (!bodyStartMatch) throw new Error(`Missing body delimiter for ${functionName}`);
  const delimiter = bodyStartMatch[1];
  const bodyStart = bodyStartMatch.index + bodyStartMatch[0].length;
  const bodyEnd = definition.indexOf(delimiter, bodyStart);
  if (bodyEnd < 0) throw new Error(`Unterminated body for ${functionName}`);
  return normalizedLf(definition.slice(bodyStart, bodyEnd));
}

function reviewedBodyHashes() {
  const postSql = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  const predecessorStartSql = readFileSync(
    resolve(vinPokerRoot, PREDECESSOR_START_MIGRATION_PATH),
    "utf8",
  );
  const predecessorGetSql = readFileSync(
    resolve(vinPokerRoot, PREDECESSOR_GET_MIGRATION_PATH),
    "utf8",
  );
  return Object.freeze({
    post: Object.freeze({
      start: normalizedFunctionBodyHash(
        extractFunctionBody(postSql, "floor_start_tournament_clock"),
      ),
      get: normalizedFunctionBodyHash(extractFunctionBody(postSql, "get_tournament_clock")),
      control: normalizedFunctionBodyHash(
        extractFunctionBody(postSql, "floor_control_tournament_clock"),
      ),
    }),
    predecessor: Object.freeze({
      start: normalizedFunctionBodyHash(
        extractFunctionBody(predecessorStartSql, "floor_start_tournament_clock"),
      ),
      get: normalizedFunctionBodyHash(
        extractFunctionBody(predecessorGetSql, "get_tournament_clock"),
      ),
    }),
  });
}

export const REVIEWED_BODY_HASHES = reviewedBodyHashes();

function stripBodiesAndComments(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function validateMigration(sql) {
  const problems = [];
  const topLevel = stripBodiesAndComments(sql);

  if (sha256(sql.replace(/\r\n/g, "\n")) !== MIGRATION_SHA256) {
    problems.push("migration checksum mismatch");
  }
  if (!/^\s*BEGIN\s*;/i.test(topLevel)) problems.push("migration is not transaction-wrapped");
  if (!/COMMIT\s*;\s*$/i.test(topLevel)) problems.push("migration does not end with COMMIT");
  if (/schema_migrations/i.test(topLevel)) problems.push("touches schema_migrations");
  if (/\b(?:DROP|TRUNCATE)\b/i.test(topLevel)) problems.push("contains top-level destructive DDL");
  if (/\b(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i.test(topLevel)) {
    problems.push("contains top-level data mutation");
  }
  if (/\bGRANT\s+UPDATE\b/i.test(topLevel)) problems.push("grants direct table UPDATE");
  if (/\b(?:payout|payment|sepay|staking|escrow)\b/i.test(topLevel)) {
    problems.push("touches a money-path identifier");
  }

  for (const expected of [
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.floor_start_tournament_clock/i,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_tournament_clock/i,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.floor_control_tournament_clock/i,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.floor_control_tournament_clock/i,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.floor_control_tournament_clock/i,
  ]) {
    if (!expected.test(sql)) problems.push(`missing expected contract: ${expected.source}`);
  }

  return problems;
}

export const STATE_SQL = `with expected as (
  select
    to_regprocedure('public.floor_start_tournament_clock(uuid)') as start_oid,
    to_regprocedure('public.get_tournament_clock(uuid)') as get_oid,
    to_regprocedure('public.floor_control_tournament_clock(uuid,text,integer,text)') as control_oid
), start_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.start_oid
), get_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.get_oid
), control_fn as (
  select p.* from pg_proc p, expected e where p.oid = e.control_oid
)
select
  e.start_oid is not null as start_exists,
  e.get_oid is not null as get_exists,
  e.control_oid is not null as control_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='floor_start_tournament_clock') as start_overloads,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_tournament_clock') as get_overloads,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='floor_control_tournament_clock') as control_overloads,
  coalesce((select prosecdef from start_fn), false) as start_security_definer,
  coalesce((select prosecdef from get_fn), false) as get_security_definer,
  coalesce((select prosecdef from control_fn), false) as control_security_definer,
  coalesce((select pg_get_userbyid(proowner) from start_fn), '') as start_owner,
  coalesce((select pg_get_userbyid(proowner) from get_fn), '') as get_owner,
  coalesce((select pg_get_userbyid(proowner) from control_fn), '') as control_owner,
  coalesce((select to_jsonb(proargnames) from start_fn), '[]'::jsonb) as start_argument_names,
  coalesce((select to_jsonb(proargnames) from get_fn), '[]'::jsonb) as get_argument_names,
  coalesce((select to_jsonb(proargnames) from control_fn), '[]'::jsonb) as control_argument_names,
  coalesce((select oidvectortypes(proargtypes) from start_fn), '') as start_argument_types,
  coalesce((select oidvectortypes(proargtypes) from get_fn), '') as get_argument_types,
  coalesce((select oidvectortypes(proargtypes) from control_fn), '') as control_argument_types,
  coalesce((select pronargdefaults from start_fn), 0) as start_argument_defaults,
  coalesce((select pronargdefaults from get_fn), 0) as get_argument_defaults,
  coalesce((select pronargdefaults from control_fn), 0) as control_argument_defaults,
  coalesce((select format_type(prorettype, null) from start_fn), '') as start_return_type,
  coalesce((select format_type(prorettype, null) from get_fn), '') as get_return_type,
  coalesce((select format_type(prorettype, null) from control_fn), '') as control_return_type,
  coalesce((select l.lanname from start_fn p join pg_language l on l.oid=p.prolang), '') as start_language,
  coalesce((select l.lanname from get_fn p join pg_language l on l.oid=p.prolang), '') as get_language,
  coalesce((select l.lanname from control_fn p join pg_language l on l.oid=p.prolang), '') as control_language,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from start_fn), false) as start_search_path,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from control_fn), false) as control_search_path,
  coalesce((select pg_get_functiondef(oid) like '%auth.uid()%' from start_fn), false) as start_auth_uid,
  coalesce((select pg_get_functiondef(oid) like '%auth.uid()%' from control_fn), false) as control_auth_uid,
  coalesce((select pg_get_functiondef(oid) like '%clubs%' from control_fn), false) as control_owner_scope,
  coalesce((select pg_get_functiondef(oid) like '%club_cashiers%' from control_fn), false) as control_cashier_scope,
  coalesce((select pg_get_functiondef(oid) like '%club_floors%' from control_fn), false) as control_floor_scope,
  coalesce((select pg_get_functiondef(oid) like '%is_club_floor%' from start_fn), false) as start_floor_scope,
  coalesce((select pg_get_functiondef(oid) like '%control_revision%' from get_fn), false) as get_control_revision,
  coalesce((select pg_get_functiondef(oid) like all(array[
    '%clock_already_started%', '%tournament_already_closed%', '%floor_clock_started%',
    '%club_cashiers%', '%is_club_floor%'
  ]) from start_fn), false) as start_body_contract,
  coalesce((select pg_get_functiondef(oid) like all(array[
    '%control_revision%', '%clock_paused_at%', '%Clock not started%', '%remaining_seconds%'
  ]) from get_fn), false) as get_body_contract,
  coalesce((select pg_get_functiondef(oid) like all(array[
    '%stale_clock_state%', '%expected_control_revision_required%', '%adjust_time%',
    '%previous_level%', '%floor_tournament_clock_controlled%', '%club_cashiers%', '%club_floors%'
  ]) from control_fn), false) as control_body_contract,
  coalesce(has_function_privilege('authenticated', e.start_oid, 'EXECUTE'), false) as start_authenticated_execute,
  coalesce(has_function_privilege('anon', e.start_oid, 'EXECUTE'), false) as start_anon_execute,
  coalesce(has_function_privilege('service_role', e.start_oid, 'EXECUTE'), false) as start_service_role_execute,
  coalesce(has_function_privilege('authenticated', e.get_oid, 'EXECUTE'), false) as get_authenticated_execute,
  coalesce(has_function_privilege('anon', e.get_oid, 'EXECUTE'), false) as get_anon_execute,
  coalesce(has_function_privilege('service_role', e.get_oid, 'EXECUTE'), false) as get_service_role_execute,
  coalesce(has_function_privilege('authenticated', e.control_oid, 'EXECUTE'), false) as control_authenticated_execute,
  coalesce(has_function_privilege('anon', e.control_oid, 'EXECUTE'), false) as control_anon_execute,
  coalesce(has_function_privilege('service_role', e.control_oid, 'EXECUTE'), false) as control_service_role_execute,
  coalesce((select exists(
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ) from start_fn p), false) as start_public_execute,
  coalesce((select exists(
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ) from control_fn p), false) as control_public_execute,
  coalesce((select exists(
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ) from get_fn p), false) as get_public_execute,
  coalesce((select (
    select coalesce(jsonb_agg(grantee order by grantee), '[]'::jsonb)
    from (
      select distinct case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
    ) grant_rows
  ) from start_fn p), '[]'::jsonb) as start_execute_grantees,
  coalesce((select (
    select coalesce(jsonb_agg(grantee order by grantee), '[]'::jsonb)
    from (
      select distinct case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
    ) grant_rows
  ) from get_fn p), '[]'::jsonb) as get_execute_grantees,
  coalesce((select (
    select coalesce(jsonb_agg(grantee order by grantee), '[]'::jsonb)
    from (
      select distinct case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
    ) grant_rows
  ) from control_fn p), '[]'::jsonb) as control_execute_grantees,
  coalesce((select md5(replace(prosrc, chr(13) || chr(10), chr(10))) from start_fn), '') as start_hash,
  coalesce((select md5(replace(prosrc, chr(13) || chr(10), chr(10))) from get_fn), '') as get_hash,
  coalesce((select md5(replace(prosrc, chr(13) || chr(10), chr(10))) from control_fn), '') as control_hash,
  coalesce((select md5(coalesce(relacl::text,'')) from pg_class where oid=to_regclass('public.tournaments')), '') as tournaments_acl_hash,
  coalesce(has_table_privilege('authenticated','public.tournaments','UPDATE'), false) as authenticated_tournaments_update,
  exists(
    select 1 from supabase_migrations.schema_migrations
    where version='20270104000004'
  ) as migration_registered,
  (
    to_regclass('public.tournaments') is not null
    and to_regclass('public.clubs') is not null
    and to_regclass('public.club_cashiers') is not null
    and to_regclass('public.club_floors') is not null
    and to_regclass('public.tournament_levels') is not null
    and to_regclass('public.tournament_close_report') is not null
    and to_regclass('public.tournament_state_transitions') is not null
    and to_regclass('public.audit_logs') is not null
    and to_regprocedure('public.is_club_floor(uuid,uuid)') is not null
  ) as prerequisites_ok,
  (select count(*)=5 from information_schema.columns
    where table_schema='public' and table_name='tournaments'
      and column_name in ('current_level','clock_started_at','clock_paused_at','pause_accumulated','updated_at')) as clock_columns_ok
from expected e;`;

const TRUSTED_FUNCTION_OWNERS = new Set(["postgres", "supabase_admin"]);

function arraysEqual(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function requireExactGrantees(problems, key, actual, expected) {
  if (!arraysEqual(actual, expected)) {
    problems.push(`${key} does not match the reviewed execute grantees`);
  }
}

function requireTrustedOwner(problems, key, owner) {
  if (!TRUSTED_FUNCTION_OWNERS.has(owner)) {
    problems.push(`${key} is not a trusted function owner`);
  }
}

function requireExactSignature(problems, state, prefix, expected) {
  if (!arraysEqual(state[`${prefix}_argument_names`], expected.names)) {
    problems.push(`${prefix} argument names do not match exact signature`);
  }
  if (state[`${prefix}_argument_types`] !== expected.types) {
    problems.push(`${prefix} argument types do not match exact signature`);
  }
  if (Number(state[`${prefix}_argument_defaults`]) !== expected.defaults) {
    problems.push(`${prefix} argument defaults do not match exact signature`);
  }
  if (state[`${prefix}_return_type`] !== "jsonb") {
    problems.push(`${prefix} return type is not jsonb`);
  }
  if (state[`${prefix}_language`] !== "plpgsql") {
    problems.push(`${prefix} language is not plpgsql`);
  }
}

const START_SIGNATURE = Object.freeze({
  names: ["p_tournament_id"],
  types: "uuid",
  defaults: 0,
});
const GET_SIGNATURE = START_SIGNATURE;
const CONTROL_SIGNATURE = Object.freeze({
  names: [
    "p_tournament_id",
    "p_action",
    "p_delta_seconds",
    "p_expected_control_revision",
  ],
  types: "uuid, text, integer, text",
  defaults: 2,
});

export function contractProblems(state) {
  const problems = [];
  const requiredTrue = [
    "start_exists",
    "get_exists",
    "control_exists",
    "start_security_definer",
    "control_security_definer",
    "start_search_path",
    "control_search_path",
    "start_auth_uid",
    "control_auth_uid",
    "control_owner_scope",
    "control_cashier_scope",
    "control_floor_scope",
    "start_floor_scope",
    "get_control_revision",
    "start_body_contract",
    "get_body_contract",
    "control_body_contract",
    "start_authenticated_execute",
    "get_authenticated_execute",
    "get_anon_execute",
    "get_service_role_execute",
    "control_authenticated_execute",
  ];
  for (const key of requiredTrue) {
    if (state[key] !== true) problems.push(`${key} is not true`);
  }
  for (const [key, expected] of [
    ["start_overloads", 1],
    ["get_overloads", 1],
    ["control_overloads", 1],
  ]) {
    if (Number(state[key]) !== expected) problems.push(`${key} expected ${expected}`);
  }
  for (const key of [
    "start_anon_execute",
    "start_service_role_execute",
    "control_anon_execute",
    "control_service_role_execute",
    "start_public_execute",
    "get_public_execute",
    "control_public_execute",
    "get_security_definer",
  ]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  for (const key of ["start_hash", "get_hash", "control_hash"]) {
    if (typeof state[key] !== "string" || state[key].length !== 32) {
      problems.push(`${key} is not a live definition fingerprint`);
    }
  }
  for (const [key, expected] of [
    ["start_hash", REVIEWED_BODY_HASHES.post.start],
    ["get_hash", REVIEWED_BODY_HASHES.post.get],
    ["control_hash", REVIEWED_BODY_HASHES.post.control],
  ]) {
    if (state[key] !== expected) problems.push(`${key} does not match exact post-state`);
  }
  requireTrustedOwner(problems, "start_owner", state.start_owner);
  requireTrustedOwner(problems, "get_owner", state.get_owner);
  requireTrustedOwner(problems, "control_owner", state.control_owner);
  requireExactSignature(problems, state, "start", START_SIGNATURE);
  requireExactSignature(problems, state, "get", GET_SIGNATURE);
  requireExactSignature(problems, state, "control", CONTROL_SIGNATURE);
  requireExactGrantees(
    problems,
    "start_execute_grantees",
    state.start_execute_grantees,
    ["authenticated"],
  );
  requireExactGrantees(
    problems,
    "get_execute_grantees",
    state.get_execute_grantees,
    ["anon", "authenticated", "service_role"],
  );
  requireExactGrantees(
    problems,
    "control_execute_grantees",
    state.control_execute_grantees,
    ["authenticated"],
  );
  return problems;
}

export function predecessorProblems(state) {
  const problems = [];
  for (const key of ["start_exists", "get_exists", "start_security_definer", "start_search_path"]) {
    if (state[key] !== true) problems.push(`${key} is not true in known predecessor`);
  }
  for (const key of [
    "start_authenticated_execute",
    "start_service_role_execute",
    "get_authenticated_execute",
    "get_anon_execute",
    "get_service_role_execute",
    "get_public_execute",
  ]) {
    if (state[key] !== true) problems.push(`${key} is not true in known predecessor`);
  }
  for (const key of ["control_exists", "get_security_definer"]) {
    if (state[key] !== false) problems.push(`${key} is not false in known predecessor`);
  }
  for (const key of [
    "start_anon_execute",
    "start_public_execute",
    "control_authenticated_execute",
    "control_anon_execute",
    "control_service_role_execute",
    "control_public_execute",
  ]) {
    if (state[key] !== false) problems.push(`${key} is not false in known predecessor`);
  }
  for (const [key, expected] of [
    ["start_overloads", 1],
    ["get_overloads", 1],
    ["control_overloads", 0],
  ]) {
    if (Number(state[key]) !== expected) problems.push(`${key} expected ${expected} in known predecessor`);
  }
  if (state.start_hash !== REVIEWED_BODY_HASHES.predecessor.start) {
    problems.push("start_hash does not match known predecessor");
  }
  if (state.get_hash !== REVIEWED_BODY_HASHES.predecessor.get) {
    problems.push("get_hash does not match known predecessor");
  }
  if (state.control_hash !== "") {
    problems.push("control_hash is not absent in known predecessor");
  }
  requireTrustedOwner(problems, "start_owner", state.start_owner);
  requireTrustedOwner(problems, "get_owner", state.get_owner);
  if (state.control_owner !== "") problems.push("control_owner is not absent in known predecessor");
  requireExactSignature(problems, state, "start", START_SIGNATURE);
  requireExactSignature(problems, state, "get", GET_SIGNATURE);
  for (const [key, expected] of [
    ["control_argument_names", []],
    ["control_argument_types", ""],
    ["control_argument_defaults", 0],
    ["control_return_type", ""],
    ["control_language", ""],
  ]) {
    const actual = state[key];
    if (Array.isArray(expected) ? !arraysEqual(actual, expected) : actual !== expected) {
      problems.push(`${key} is not absent in known predecessor`);
    }
  }
  requireExactGrantees(
    problems,
    "start_execute_grantees",
    state.start_execute_grantees,
    ["authenticated", "service_role"],
  );
  requireExactGrantees(
    problems,
    "get_execute_grantees",
    state.get_execute_grantees,
    ["PUBLIC", "anon", "authenticated", "service_role"],
  );
  requireExactGrantees(problems, "control_execute_grantees", state.control_execute_grantees, []);
  return problems;
}

export function preApplyDecision(state) {
  const postProblems = contractProblems(state);
  if (postProblems.length === 0) {
    return {
      action: "skip",
      reason: state.migration_registered === true ? "exact_post_registered" : "exact_post_unregistered",
      problems: [],
    };
  }
  if (state.migration_registered === true) {
    return { action: "block", reason: "registered_contract_drift", problems: postProblems };
  }
  const knownPredecessorProblems = predecessorProblems(state);
  if (knownPredecessorProblems.length === 0) {
    return { action: "apply", reason: "exact_known_predecessor", problems: [] };
  }
  return {
    action: "block",
    reason: "unknown_live_drift",
    problems: [...postProblems, ...knownPredecessorProblems],
  };
}

export function postApplyProblems(before, after) {
  const problems = contractProblems(after);
  if (before.tournaments_acl_hash !== after.tournaments_acl_hash) {
    problems.push("tournaments table ACL changed");
  }
  if (before.authenticated_tournaments_update !== after.authenticated_tournaments_update) {
    problems.push("authenticated tournaments UPDATE posture changed");
  }
  if (before.migration_registered !== after.migration_registered) {
    problems.push("schema_migrations registration changed");
  }
  if (before.start_owner !== after.start_owner) problems.push("start function owner changed");
  if (before.get_owner !== after.get_owner) problems.push("get function owner changed");
  return problems;
}

export async function managementQuery({
  projectRef,
  token,
  query,
  fetchImpl = fetch,
  timeoutMs = MANAGEMENT_REQUEST_TIMEOUT_MS,
}) {
  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch {
    throw new Error("Management API network request failed");
  }
  if (!response.ok) {
    throw new Error(`Management API request failed with status ${response.status}`);
  }
  return response.json();
}

export async function applyExactMigration(credentials, sql, queryImpl = managementQuery) {
  try {
    return await queryImpl({ ...credentials, query: sql });
  } catch {
    throw new Error(
      "APPLY_OUTCOME_UNKNOWN: migration request failed without a trustworthy commit acknowledgement; re-run read-only preflight and do not infer rollback",
    );
  }
}

function firstRow(result) {
  return Array.isArray(result) ? result[0] : result;
}

function safeState(state) {
  return {
    start_exists: state.start_exists,
    get_exists: state.get_exists,
    control_exists: state.control_exists,
    start_overloads: Number(state.start_overloads),
    get_overloads: Number(state.get_overloads),
    control_overloads: Number(state.control_overloads),
    start_security_definer: state.start_security_definer,
    get_security_definer: state.get_security_definer,
    control_security_definer: state.control_security_definer,
    start_owner: state.start_owner,
    get_owner: state.get_owner,
    control_owner: state.control_owner,
    start_argument_names: state.start_argument_names,
    get_argument_names: state.get_argument_names,
    control_argument_names: state.control_argument_names,
    start_argument_types: state.start_argument_types,
    get_argument_types: state.get_argument_types,
    control_argument_types: state.control_argument_types,
    start_argument_defaults: Number(state.start_argument_defaults),
    get_argument_defaults: Number(state.get_argument_defaults),
    control_argument_defaults: Number(state.control_argument_defaults),
    start_return_type: state.start_return_type,
    get_return_type: state.get_return_type,
    control_return_type: state.control_return_type,
    start_language: state.start_language,
    get_language: state.get_language,
    control_language: state.control_language,
    start_search_path: state.start_search_path,
    control_search_path: state.control_search_path,
    start_authenticated_execute: state.start_authenticated_execute,
    start_anon_execute: state.start_anon_execute,
    start_service_role_execute: state.start_service_role_execute,
    start_public_execute: state.start_public_execute,
    get_authenticated_execute: state.get_authenticated_execute,
    get_anon_execute: state.get_anon_execute,
    get_service_role_execute: state.get_service_role_execute,
    get_public_execute: state.get_public_execute,
    control_authenticated_execute: state.control_authenticated_execute,
    control_anon_execute: state.control_anon_execute,
    control_service_role_execute: state.control_service_role_execute,
    control_public_execute: state.control_public_execute,
    start_execute_grantees: state.start_execute_grantees,
    get_execute_grantees: state.get_execute_grantees,
    control_execute_grantees: state.control_execute_grantees,
    get_control_revision: state.get_control_revision,
    start_body_contract: state.start_body_contract,
    get_body_contract: state.get_body_contract,
    control_body_contract: state.control_body_contract,
    migration_registered: state.migration_registered,
    prerequisites_ok: state.prerequisites_ok,
    clock_columns_ok: state.clock_columns_ok,
    start_hash: state.start_hash,
    get_hash: state.get_hash,
    control_hash: state.control_hash,
    tournaments_acl_hash: state.tournaments_acl_hash,
    authenticated_tournaments_update: state.authenticated_tournaments_update,
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
  if (before.prerequisites_ok !== true || before.clock_columns_ok !== true) {
    throw new Error("Live prerequisites are incomplete");
  }
  const decision = preApplyDecision(before);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") {
    throw new Error(`Live clock state is not allowlisted: ${decision.problems.join("; ")}`);
  }
  if (preflight) {
    log("PREFLIGHT_PASS");
    return { applied: false, before, after: before };
  }

  if (env.CONFIRM_APPLY_FLOOR_CLOCK !== CONFIRMATION) {
    throw new Error("Exact apply confirmation is missing");
  }
  if (decision.action === "skip") {
    log("exact contract already live; apply skipped");
    return { applied: false, before, after: before };
  }

  log(`applying exact migration ${MIGRATION_VERSION}`);
  await applyExactMigration(credentials, sql);
  let after;
  try {
    after = await readState(credentials);
  } catch {
    throw new Error(
      "APPLIED_VERIFY_INCOMPLETE: migration request succeeded but post-commit metadata verification failed; do not infer rollback",
    );
  }
  log("POST", JSON.stringify(safeState(after)));

  const afterProblems = postApplyProblems(before, after);
  if (afterProblems.length) {
    throw new Error(`Post-apply verification failed: ${afterProblems.join("; ")}`);
  }
  log("APPLY_AND_VERIFY_PASS");
  return { applied: true, before, after };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[floor-clock-apply] FAIL", error.message);
    process.exitCode = 1;
  });
}
