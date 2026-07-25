import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_REF = "orlesggcjamwuknxwcpk";
const CONFIRMATION = "CREATE_FLOOR_CLEANUP_INDEX";
const MIGRATION = "supabase/migrations/20261243000000_floor_cleanup_rotation_schedule_index.sql";
const INDEX_NAME = "idx_dealer_rotation_schedule_table_id";
const TABLE_NAME = "dealer_rotation_schedule";
const EXPECTED_DDL = `CREATE INDEX CONCURRENTLY IF NOT EXISTS
  ${INDEX_NAME}
ON public.${TABLE_NAME} (table_id)`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fail(code) {
  throw new Error(code);
}

function executableSql(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim().replace(/;$/, "").trim();
}

function validateMigration(sql) {
  if (executableSql(sql).toLowerCase() !== executableSql(EXPECTED_DDL).toLowerCase()) fail("migration_not_exact_allowlist");
  if (/\b(begin|commit|schema_migrations|drop|truncate|delete|update|insert|alter)\b/i.test(executableSql(sql))) fail("migration_contains_forbidden_sql");
  return sql;
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  return payload ? [payload] : [];
}

async function queryManagement(context, query, readOnly) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${context.projectRef}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, read_only: readOnly }),
    });
  } catch {
    fail("management_api_network_error");
  }
  if (!response.ok) fail(`management_api_status_${response.status}`);
  return normalizeRows(await response.json());
}

const STATE_SQL = `
with target as (
  select to_regclass('public.dealer_rotation_schedule')::oid as table_oid
)
select
  (table_oid is not null) as table_exists,
  coalesce(pg_total_relation_size(table_oid), 0)::bigint as table_bytes,
  coalesce((select c.reltuples::bigint from pg_class c where c.oid = table_oid), 0)::bigint as estimated_rows,
  coalesce((select s.n_live_tup::bigint from pg_stat_user_tables s where s.relid = table_oid), 0)::bigint as live_rows_estimate,
  coalesce((
    select string_agg(ic.relname, ',' order by ic.relname)
    from pg_index i join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = table_oid
  ), '') as index_names,
  coalesce((
    select string_agg(ic.relname, ',' order by ic.relname)
    from pg_index i join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = table_oid and not i.indisvalid
  ), '') as invalid_index_names,
  (select count(*)::int
   from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_am am on am.oid = ic.relam
   where i.indrelid = table_oid and i.indisvalid and i.indisready and i.indpred is null and am.amname = 'btree'
     and pg_get_indexdef(i.indexrelid, 1, true) = 'table_id') as valid_leading_count,
  (select count(*)::int from pg_index i join pg_class ic on ic.oid = i.indexrelid
   where i.indrelid = table_oid and ic.relname = '${INDEX_NAME}') as target_count,
  coalesce((select bool_and(i.indisvalid) from pg_index i join pg_class ic on ic.oid = i.indexrelid
   where i.indrelid = table_oid and ic.relname = '${INDEX_NAME}'), false) as target_valid,
  coalesce((select bool_and(i.indisready) from pg_index i join pg_class ic on ic.oid = i.indexrelid
   where i.indrelid = table_oid and ic.relname = '${INDEX_NAME}'), false) as target_ready,
  (select count(*)::int
   from pg_constraint con
   where con.conrelid = table_oid and con.contype = 'f'
     and con.conname = 'dealer_rotation_schedule_table_id_fkey') as fk_count,
  (select count(*)::int
   from pg_constraint con
   where con.conrelid = table_oid and con.contype = 'f'
     and con.conname = 'dealer_rotation_schedule_table_id_fkey'
     and con.confrelid = to_regclass('public.game_tables')
     and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (table_id) REFERENCES game_tables(id)%') as fk_target_count
from target;`;

const EXPLAIN_SQL = `explain (format json, costs false)
select 1 from public.dealer_rotation_schedule
where table_id = '00000000-0000-4000-8000-000000000000'::uuid;`;

const EXACT_LOOKUP_SQL = `select count(*)::int as exact_count
from public.dealer_rotation_schedule
where table_id = '00000000-0000-4000-8000-000000000000'::uuid;`;

function first(rows, code) {
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== "object") fail(code);
  return rows[0];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function logState(label, state) {
  console.log(`FLOOR_INDEX ${label} table_exists=${state.table_exists === true} table_bytes=${number(state.table_bytes)} estimated_rows=${number(state.estimated_rows)} live_rows_estimate=${number(state.live_rows_estimate)} valid_leading=${number(state.valid_leading_count)} target_count=${number(state.target_count)} target_valid=${state.target_valid === true} target_ready=${state.target_ready === true} fk_count=${number(state.fk_count)} fk_target_count=${number(state.fk_target_count)} indexes=${state.index_names || "none"} invalid=${state.invalid_index_names || "none"}`);
}

function validatePreflight(state) {
  if (state.table_exists !== true) fail("rotation_schedule_table_missing");
  if (number(state.fk_count) !== 1 || number(state.fk_target_count) !== 1) fail("rotation_schedule_fk_mismatch");
  if (state.invalid_index_names) fail("preexisting_invalid_index");
  if (number(state.target_count) > 1) fail("duplicate_target_index");
}

function requireContext(environment = process.env) {
  const required = ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "GITHUB_REF"];
  const missing = required.filter((name) => !environment[name]);
  if (missing.length > 0) fail(`missing_context_${missing.join("_")}`);
  if (environment.SUPABASE_PROJECT_REF !== PRODUCTION_REF) fail("project_ref_mismatch");
  if (environment.GITHUB_REF === "refs/heads/main") fail("index_must_not_run_from_main");
  return { projectRef: environment.SUPABASE_PROJECT_REF, accessToken: environment.SUPABASE_ACCESS_TOKEN };
}

async function verifyPlanner(context) {
  const planRows = await queryManagement(context, EXPLAIN_SQL, true);
  const plan = JSON.stringify(planRows);
  if (!/(Index (Only )?Scan|Bitmap Index Scan)/i.test(plan)) fail("planner_did_not_choose_index");
  const lookup = first(await queryManagement(context, EXACT_LOOKUP_SQL, true), "exact_lookup_missing");
  console.log(`FLOOR_INDEX LOOKUP_PASS exact_count=${number(lookup.exact_count)}`);
}

async function cleanupOwnInvalidArtifact(context, preState) {
  const failureState = first(await queryManagement(context, STATE_SQL, true), "failure_state_missing");
  logState("FAILURE_STATE", failureState);
  if (number(preState.target_count) === 0 && number(failureState.target_count) === 1 && failureState.target_valid !== true) {
    await queryManagement(context, `DROP INDEX CONCURRENTLY IF EXISTS public.${INDEX_NAME};`, false);
    const cleaned = first(await queryManagement(context, STATE_SQL, true), "cleanup_state_missing");
    logState("ARTIFACT_CLEANUP", cleaned);
    if (number(cleaned.target_count) !== 0) fail("own_invalid_index_cleanup_failed");
  }
}

async function main() {
  const sql = validateMigration(readFileSync(resolve(root, MIGRATION), "utf8"));
  console.log("FLOOR_INDEX STATIC_GUARD_PASS standalone_concurrent=true explicit_transaction=false migration_ledger_write=false");
  if (!process.env.SUPABASE_PROJECT_REF && !process.env.SUPABASE_ACCESS_TOKEN) return;

  const context = requireContext();
  const preState = first(await queryManagement(context, STATE_SQL, true), "preflight_state_missing");
  logState("PREFLIGHT", preState);
  validatePreflight(preState);

  if (number(preState.valid_leading_count) === 0) {
    if (!process.argv.includes("--apply") || process.env.FLOOR_INDEX_CONFIRM !== CONFIRMATION) fail("index_apply_confirmation_missing");
    console.log(`FLOOR_INDEX APPLY_START index=${INDEX_NAME} transport=management_sql_single_statement`);
    try {
      await queryManagement(context, sql, false);
    } catch (error) {
      await cleanupOwnInvalidArtifact(context, preState);
      throw error;
    }
  } else {
    console.log("FLOOR_INDEX APPLY_SKIPPED supporting_index_already_valid=true");
  }

  const postState = first(await queryManagement(context, STATE_SQL, true), "post_state_missing");
  logState("POST_VERIFY", postState);
  validatePreflight(postState);
  if (number(postState.valid_leading_count) < 1) fail("supporting_index_not_valid");
  if (number(preState.valid_leading_count) === 0 && (number(postState.target_count) !== 1 || postState.target_valid !== true || postState.target_ready !== true)) fail("target_index_not_ready");
  await verifyPlanner(context);
  console.log("FLOOR INDEX PASS");
}

main().catch((error) => {
  console.error(`FLOOR_INDEX FAIL ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
