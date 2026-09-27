#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { managementQuery, PROJECT_REF } from "../floor/apply-floor-clock-control.mjs";

export const STATE_SQL = `select
  exists(
    select 1 from supabase_migrations.schema_migrations
    where version = '20260925115949'
      and name = 'public_table_history_verified_results'
  ) as migration_registered,
  p.prosecdef as security_definer,
  coalesce(p.proconfig @> array['search_path=""']::text[], false) as empty_search_path,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  exists(
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) as public_execute,
  pg_get_functiondef(p.oid) like '%public_outcome%' as reads_verified_outcome,
  pg_get_functiondef(p.oid) like '%netDelta%' as returns_net_delta
from pg_proc p
where p.oid = to_regprocedure(
  'public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)'
);`;

export function stateProblems(state) {
  const expected = {
    migration_registered: true,
    security_definer: true,
    empty_search_path: true,
    anon_execute: true,
    authenticated_execute: true,
    service_role_execute: true,
    public_execute: false,
    reads_verified_outcome: true,
    returns_net_delta: true,
  };
  return Object.entries(expected)
    .filter(([key, value]) => state?.[key] !== value)
    .map(([key, value]) => `${key} expected ${value}`);
}

export async function run(env = process.env) {
  if (!env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PROJECT_REF !== PROJECT_REF) {
    throw new Error("Missing or wrong Supabase credential context");
  }
  const result = await managementQuery({
    projectRef: env.SUPABASE_PROJECT_REF,
    token: env.SUPABASE_ACCESS_TOKEN,
    query: STATE_SQL,
  });
  const state = Array.isArray(result) ? result[0] : result;
  const problems = stateProblems(state);
  if (problems.length) throw new Error(`Table-history postcheck failed: ${problems.join("; ")}`);
  console.log("PUBLIC_TABLE_HISTORY_POSTCHECK=PASS");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[public-table-history] FAIL", error.message);
    process.exitCode = 1;
  });
}
