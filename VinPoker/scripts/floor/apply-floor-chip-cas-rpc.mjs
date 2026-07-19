import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_REF = "orlesggcjamwuknxwcpk";
const EXPECTED_HEAD_REF = "codex/floor-production-canary";
const CONFIRMATION = "APPLY_FLOOR_CHIP_CAS_RPC";
const MIGRATION =
  "supabase/migrations/20270104000001_floor_chip_cas_rpc.sql";
const EXPECTED_SHA256 =
  "69517eb279e25bb4485665af18eaa04166572a6a2004b56523b8aaa1fb6bdaa6";
const FUNCTION_NAME = "floor_update_tournament_seat_chip";
const ROLLBACK_SQL = `
begin;
drop function if exists public.floor_update_tournament_seat_chip(
  uuid,
  uuid,
  integer,
  integer
);
commit;`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fail(code) {
  throw new Error(code);
}

function safeIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    ? value
    : "unknown";
}

function executableSql(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

function validateMigration(sql) {
  const canonicalSql = sql.replace(/\r\n?/g, "\n");
  const sha = createHash("sha256").update(canonicalSql).digest("hex");
  if (sha !== EXPECTED_SHA256) fail("migration_sha256_mismatch");
  const executable = executableSql(sql);
  for (const required of [
    "CREATE OR REPLACE FUNCTION public.floor_update_tournament_seat_chip",
    "v_actor UUID := auth.uid()",
    "SECURITY DEFINER",
    "SET search_path = public",
    "FROM public.club_cashiers cc",
    "FROM public.club_floors cf",
    "FOR UPDATE",
    "SET chip_count = p_chip_count",
    "REVOKE ALL ON FUNCTION public.floor_update_tournament_seat_chip",
    "GRANT EXECUTE ON FUNCTION public.floor_update_tournament_seat_chip",
  ]) {
    if (!sql.includes(required)) fail("migration_contract_mismatch");
  }
  if (/schema_migrations|CREATE INDEX|DROP INDEX|TRUNCATE|\bDELETE\b|\bINSERT\b/i.test(executable)) {
    fail("migration_contains_out_of_scope_sql");
  }
  const updateStatements = executable.match(
    /\bUPDATE\s+(?:ONLY\s+)?(?:(?:"?[a-z_][\w$]*"?)\.)?"?[a-z_][\w$]*"?/gi,
  ) ?? [];
  if (updateStatements.length !== 1) {
    fail("migration_write_count_mismatch");
  }
  if (!/UPDATE public\.tournament_seats SET chip_count = p_chip_count/i.test(executable)) {
    fail("migration_write_boundary_mismatch");
  }
  return sql;
}

function requireContext(environment = process.env) {
  const required = [
    "SUPABASE_PROJECT_REF",
    "SUPABASE_ACCESS_TOKEN",
    "GITHUB_REF",
    "GITHUB_HEAD_REF",
    "FLOOR_CHIP_CAS_CONFIRM",
  ];
  const missing = required.filter((name) => !environment[name]);
  if (missing.length > 0) fail(`missing_context_${missing.join("_")}`);
  if (environment.SUPABASE_PROJECT_REF !== PRODUCTION_REF) {
    fail("project_ref_mismatch");
  }
  if (environment.GITHUB_REF === "refs/heads/main") fail("rollout_must_not_run_from_main");
  if (environment.GITHUB_HEAD_REF !== EXPECTED_HEAD_REF) fail("head_ref_mismatch");
  if (environment.FLOOR_CHIP_CAS_CONFIRM !== CONFIRMATION) {
    fail("rollout_confirmation_missing");
  }
  return {
    projectRef: environment.SUPABASE_PROJECT_REF,
    accessToken: environment.SUPABASE_ACCESS_TOKEN,
  };
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  return payload ? [payload] : [];
}

async function queryManagement(context, query, readOnly) {
  let response;
  try {
    response = await fetch(
      `https://api.supabase.com/v1/projects/${context.projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, read_only: readOnly }),
      },
    );
  } catch {
    fail("management_api_network_error");
  }
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const code = safeIdentifier(payload?.code ?? payload?.error_code);
    const constraint = safeIdentifier(payload?.constraint);
    fail(
      `management_api_status_${response.status}_code_${code}_constraint_${constraint}`,
    );
  }
  return normalizeRows(payload);
}

function one(rows, code) {
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== "object") {
    fail(code);
  }
  return rows[0];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

const INDEX_STATE_SQL = `
select
  count(*)::int as target_count,
  coalesce(bool_and(i.indisvalid), false) as target_valid,
  coalesce(bool_and(i.indisready), false) as target_ready,
  coalesce(bool_and(pg_get_indexdef(i.indexrelid, 1, true) = 'table_id'), false)
    as table_id_leading
from pg_index i
join pg_class ic on ic.oid = i.indexrelid
where i.indrelid = to_regclass('public.dealer_rotation_schedule')
  and ic.relname = 'idx_dealer_rotation_schedule_table_id';`;

const LEDGER_STATE_SQL = `
select
  count(*) filter (where version = '20270104000000')::int as index_version_count,
  count(*) filter (where version = '20270104000001')::int as rpc_version_count
from supabase_migrations.schema_migrations;`;

const FUNCTION_STATE_SQL = `
with candidates as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.proowner,
    p.prosrc,
    r.rolname as owner_name,
    (r.rolname in ('postgres', 'supabase_admin')) as trusted_owner,
    (p.proargtypes = '2950 2950 23 23'::oidvector) as exact_signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public'
    and p.proname = '${FUNCTION_NAME}'
), exact_fn as (
  select * from candidates where exact_signature
)
select
  (select count(*)::int from candidates) as overload_count,
  (select count(*)::int from exact_fn) as exact_count,
  coalesce((select bool_and(prosecdef) from exact_fn), false) as security_definer,
  coalesce((select bool_and('search_path=public' = any(proconfig)) from exact_fn), false)
    as search_path_public,
  coalesce((select bool_and(trusted_owner) from exact_fn), false) as trusted_owner,
  coalesce((select string_agg(owner_name, ',' order by owner_name) from exact_fn), '')
    as owner_names,
  coalesce((select bool_and(not has_function_privilege('anon', oid, 'EXECUTE')) from exact_fn), false)
    as anon_denied,
  coalesce((select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')) from exact_fn), false)
    as authenticated_execute,
  coalesce((select bool_and(not exists (
    select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  )) from exact_fn), false) as public_denied,
  coalesce((select bool_and(position('auth.uid()' in lower(prosrc)) > 0) from exact_fn), false)
    as actor_bound,
  coalesce((select bool_and(
    position('public.clubs' in lower(prosrc)) > 0
    and position('public.club_cashiers' in lower(prosrc)) > 0
    and position('public.club_floors' in lower(prosrc)) > 0
  ) from exact_fn), false) as membership_bound,
  coalesce((select bool_and(
    regexp_count(
      lower(prosrc),
      '\\mupdate\\M[[:space:]]+([a-z_][a-z0-9_$]*\\.)?[a-z_][a-z0-9_$]*'
    ) = 1
    and lower(prosrc) like '%update public.tournament_seats%set chip_count = p_chip_count%'
    and lower(prosrc) !~ '\\m(insert|delete|truncate|merge)\\M'
  ) from exact_fn), false) as chip_only_write;`;

function validateIndex(state) {
  if (
    number(state.target_count) !== 1 || state.target_valid !== true ||
    state.target_ready !== true || state.table_id_leading !== true
  ) {
    fail("cleanup_index_metadata_mismatch");
  }
}

function validateFunction(state) {
  const booleans = [
    "security_definer",
    "search_path_public",
    "trusted_owner",
    "anon_denied",
    "authenticated_execute",
    "public_denied",
    "actor_bound",
    "membership_bound",
    "chip_only_write",
  ];
  if (number(state.overload_count) !== 1 || number(state.exact_count) !== 1) {
    fail("function_overload_mismatch");
  }
  for (const field of booleans) {
    if (state[field] !== true) fail(`function_contract_${field}`);
  }
  const owners = String(state.owner_names ?? "").split(",").filter(Boolean);
  if (owners.length !== 1) fail("function_owner_mismatch");
  console.log(
    `FLOOR_CHIP_CAS_DB FUNCTION_PASS signature=uuid,uuid,integer,integer owner=${safeIdentifier(owners[0])} security_definer=true search_path=public public_execute=false anon_execute=false authenticated_execute=true chip_only_write=true`,
  );
}

async function rollbackNewFunction(context) {
  await queryManagement(context, ROLLBACK_SQL, false);
  const state = one(
    await queryManagement(context, FUNCTION_STATE_SQL, true),
    "function_rollback_state_missing",
  );
  if (number(state.overload_count) !== 0 || number(state.exact_count) !== 0) {
    fail("function_rollback_incomplete");
  }
  console.log(
    "FLOOR_CHIP_CAS_DB ROLLBACK_PASS exact_function_removed=true edge_deployed=false ledger_write=false",
  );
}

async function main() {
  const sql = validateMigration(
    readFileSync(resolve(root, MIGRATION), "utf8"),
  );
  console.log(
    "FLOOR_CHIP_CAS_DB STATIC_GUARD_PASS exact_file=true db_push=false pending_chain=false ledger_write=false",
  );
  if (!process.env.SUPABASE_PROJECT_REF && !process.env.SUPABASE_ACCESS_TOKEN) {
    return;
  }

  const context = requireContext();
  const index = one(
    await queryManagement(context, INDEX_STATE_SQL, true),
    "index_state_missing",
  );
  validateIndex(index);
  console.log(
    "FLOOR_CHIP_CAS_DB INDEX_PASS target_count=1 valid=true ready=true leading=table_id",
  );

  const ledgerBefore = one(
    await queryManagement(context, LEDGER_STATE_SQL, true),
    "ledger_pre_state_missing",
  );
  const functionBefore = one(
    await queryManagement(context, FUNCTION_STATE_SQL, true),
    "function_pre_state_missing",
  );
  const preExact = number(functionBefore.exact_count);
  if (number(functionBefore.overload_count) !== preExact || ![0, 1].includes(preExact)) {
    fail("preexisting_function_overload_mismatch");
  }

  if (preExact === 0) {
    console.log(
      "FLOOR_CHIP_CAS_DB APPLY_START transport=management_sql exact_file=20270104000001 transaction=true",
    );
    try {
      await queryManagement(context, sql, false);
    } catch (error) {
      try {
        const failureState = one(
          await queryManagement(context, FUNCTION_STATE_SQL, true),
          "function_failure_state_missing",
        );
        let rolledBack = number(failureState.exact_count) === 0;
        if (!rolledBack && number(failureState.overload_count) === 1) {
          await rollbackNewFunction(context);
          rolledBack = true;
        }
        console.log(
          `FLOOR_CHIP_CAS_DB APPLY_FAILURE rollback_confirmed=${rolledBack}`,
        );
      } catch {
        console.log(
          "FLOOR_CHIP_CAS_DB APPLY_FAILURE rollback_confirmed=unmeasured",
        );
      }
      throw error;
    }
  } else {
    validateFunction(functionBefore);
    console.log(
      "FLOOR_CHIP_CAS_DB APPLY_SKIPPED exact_function_already_verified=true",
    );
  }

  let ledgerAfter;
  try {
    const functionAfter = one(
      await queryManagement(context, FUNCTION_STATE_SQL, true),
      "function_post_state_missing",
    );
    validateFunction(functionAfter);
    ledgerAfter = one(
      await queryManagement(context, LEDGER_STATE_SQL, true),
      "ledger_post_state_missing",
    );
    if (
      number(ledgerAfter.index_version_count) !==
          number(ledgerBefore.index_version_count) ||
      number(ledgerAfter.rpc_version_count) !== number(ledgerBefore.rpc_version_count)
    ) {
      fail("migration_ledger_changed");
    }
  } catch (error) {
    if (preExact === 0) {
      try {
        await rollbackNewFunction(context);
      } catch {
        console.log(
          "FLOOR_CHIP_CAS_DB VERIFICATION_FAILURE rollback_confirmed=unmeasured",
        );
      }
    }
    throw error;
  }
  console.log(
    `FLOOR_CHIP_CAS_DB LEDGER_UNCHANGED index_version_count=${number(ledgerAfter.index_version_count)} rpc_version_count=${number(ledgerAfter.rpc_version_count)}`,
  );
  console.log("FLOOR CHIP CAS DB APPLY PASS");
}

export { requireContext, validateMigration };

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error) => {
    console.error(
      `FLOOR_CHIP_CAS_DB FAIL ${error instanceof Error ? error.message : "unknown"}`,
    );
    process.exitCode = 1;
  });
}
