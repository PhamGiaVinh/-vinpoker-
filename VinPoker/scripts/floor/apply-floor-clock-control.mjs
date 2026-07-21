#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const MIGRATION_VERSION = "20270104000004";
export const MIGRATION_PATH =
  "supabase/migrations/20270104000004_floor_clock_control_atomic.sql";
export const MIGRATION_SHA256 =
  "20e63d51c3f910ea69c4a179162ab36b7a6196a01fd5f650c35eab0eed263e24";
export const CONFIRMATION = "APPLY_FLOOR_CLOCK_CONTROL_20270104000004";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vinPokerRoot = resolve(scriptDirectory, "..", "..");

const log = (...values) => console.log("[floor-clock-apply]", ...values);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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
  coalesce((select prosecdef from control_fn), false) as control_security_definer,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from start_fn), false) as start_search_path,
  coalesce((select array_to_string(proconfig, ',') ~ '(^|,)search_path=public(,|$)' from control_fn), false) as control_search_path,
  coalesce((select pg_get_functiondef(oid) like '%auth.uid()%' from start_fn), false) as start_auth_uid,
  coalesce((select pg_get_functiondef(oid) like '%auth.uid()%' from control_fn), false) as control_auth_uid,
  coalesce((select pg_get_functiondef(oid) like '%clubs%' from control_fn), false) as control_owner_scope,
  coalesce((select pg_get_functiondef(oid) like '%club_cashiers%' from control_fn), false) as control_cashier_scope,
  coalesce((select pg_get_functiondef(oid) like '%club_floors%' from control_fn), false) as control_floor_scope,
  coalesce((select pg_get_functiondef(oid) like '%is_club_floor%' from start_fn), false) as start_floor_scope,
  coalesce((select pg_get_functiondef(oid) like '%control_revision%' from get_fn), false) as get_control_revision,
  coalesce(has_function_privilege('authenticated', e.start_oid, 'EXECUTE'), false) as start_authenticated_execute,
  coalesce(has_function_privilege('anon', e.start_oid, 'EXECUTE'), false) as start_anon_execute,
  coalesce(has_function_privilege('authenticated', e.control_oid, 'EXECUTE'), false) as control_authenticated_execute,
  coalesce(has_function_privilege('anon', e.control_oid, 'EXECUTE'), false) as control_anon_execute,
  coalesce((select exists(
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ) from start_fn p), false) as start_public_execute,
  coalesce((select exists(
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ) from control_fn p), false) as control_public_execute,
  coalesce((select md5(pg_get_functiondef(oid)) from start_fn), '') as start_hash,
  coalesce((select md5(pg_get_functiondef(oid)) from get_fn), '') as get_hash,
  coalesce((select md5(pg_get_functiondef(oid)) from control_fn), '') as control_hash,
  coalesce((select md5(coalesce(relacl::text,'')) from pg_class where oid=to_regclass('public.tournaments')), '') as tournaments_acl_hash,
  coalesce(has_table_privilege('authenticated','public.tournaments','UPDATE'), false) as authenticated_tournaments_update,
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
    "start_authenticated_execute",
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
    "control_anon_execute",
    "start_public_execute",
    "control_public_execute",
  ]) {
    if (state[key] !== false) problems.push(`${key} is not false`);
  }
  return problems;
}

export async function managementQuery({ projectRef, token, query, fetchImpl = fetch }) {
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
    control_security_definer: state.control_security_definer,
    start_search_path: state.start_search_path,
    control_search_path: state.control_search_path,
    start_authenticated_execute: state.start_authenticated_execute,
    start_anon_execute: state.start_anon_execute,
    start_public_execute: state.start_public_execute,
    control_authenticated_execute: state.control_authenticated_execute,
    control_anon_execute: state.control_anon_execute,
    control_public_execute: state.control_public_execute,
    get_control_revision: state.get_control_revision,
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
  const beforeProblems = contractProblems(before);
  if (preflight) {
    log(beforeProblems.length === 0 ? "CONTRACT_ALREADY_LIVE" : "CONTRACT_NOT_LIVE");
    return { applied: false, before, after: before };
  }

  if (env.CONFIRM_APPLY_FLOOR_CLOCK !== CONFIRMATION) {
    throw new Error("Exact apply confirmation is missing");
  }
  if (beforeProblems.length === 0) {
    log("exact contract already live; apply skipped");
    return { applied: false, before, after: before };
  }

  log(`applying exact migration ${MIGRATION_VERSION}`);
  await managementQuery({ ...credentials, query: sql });
  const after = await readState(credentials);
  log("POST", JSON.stringify(safeState(after)));

  const afterProblems = contractProblems(after);
  if (before.tournaments_acl_hash !== after.tournaments_acl_hash) {
    afterProblems.push("tournaments table ACL changed");
  }
  if (before.authenticated_tournaments_update !== after.authenticated_tournaments_update) {
    afterProblems.push("authenticated tournaments UPDATE posture changed");
  }
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
