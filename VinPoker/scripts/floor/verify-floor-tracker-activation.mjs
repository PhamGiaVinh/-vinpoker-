#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { managementQuery, PROJECT_REF } from "./apply-floor-clock-control.mjs";

export const STATE_SQL = `select
  exists(select 1 from supabase_migrations.schema_migrations where version='20270115000012') as migration_registered,
  has_function_privilege('authenticated', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE') as authenticated_execute,
  has_function_privilege('anon', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE') as anon_execute,
  has_function_privilege('service_role', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE') as service_role_execute,
  has_function_privilege('PUBLIC', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE') as public_execute;`;

export function stateProblems(state) {
  const expected = {
    migration_registered: true,
    authenticated_execute: true,
    anon_execute: false,
    service_role_execute: false,
    public_execute: false,
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
  if (problems.length) throw new Error(`Activation postcheck failed: ${problems.join("; ")}`);
  console.log("FLOOR_TRACKER_ACTIVATION_POSTCHECK=PASS");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[floor-tracker-activation] FAIL", error.message);
    process.exitCode = 1;
  });
}
