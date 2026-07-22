import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIRMATION,
  applyManagedMigration,
  preApplyDecision,
  run,
  sourcePolicyProblems,
} from "./apply-shortage-alert-lifecycle.mjs";
import {
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  migrationEquivalenceProblems,
  normalizeExecutableSql,
  selectedMigrationProblems,
} from "./shortage-alert-migration-policy.mjs";

const vinPokerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function exactPostState() {
  return {
    incident_table_exists: true,
    incident_rls_enabled: true,
    incident_open_index_exists: true,
    incident_constraint_count: 4,
    incident_service_role_write: true,
    incident_authenticated_select: false,
    incident_anon_select: false,
    advance_exists: true,
    advance_overloads: 1,
    advance_argument_types: "uuid, text, text, smallint, jsonb, text, boolean, integer, integer",
    advance_default_count: 2,
    advance_return_type: "jsonb",
    advance_language: "plpgsql",
    advance_security_definer: true,
    advance_search_path: true,
    advance_service_role_execute: true,
    advance_authenticated_execute: false,
    advance_anon_execute: false,
    advance_public_execute: false,
    advance_lifecycle_contract: true,
    complete_exists: true,
    complete_overloads: 1,
    complete_argument_types: "uuid, uuid, boolean",
    complete_default_count: 0,
    complete_return_type: "jsonb",
    complete_language: "plpgsql",
    complete_security_definer: true,
    complete_search_path: true,
    complete_service_role_execute: true,
    complete_authenticated_execute: false,
    complete_anon_execute: false,
    complete_public_execute: false,
    floor_collision_post_state: true,
  };
}

function exactPreState() {
  return {
    ...exactPostState(),
    incident_table_exists: false,
    incident_rls_enabled: false,
    incident_open_index_exists: false,
    incident_constraint_count: 0,
    incident_service_role_write: false,
    advance_exists: false,
    advance_overloads: 0,
    advance_argument_types: "",
    advance_default_count: 0,
    advance_return_type: "",
    advance_language: "",
    advance_security_definer: false,
    advance_search_path: false,
    advance_service_role_execute: false,
    advance_lifecycle_contract: false,
    complete_exists: false,
    complete_overloads: 0,
    complete_argument_types: "",
    complete_return_type: "",
    complete_language: "",
    complete_security_definer: false,
    complete_search_path: false,
    complete_service_role_execute: false,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("superseding migration is unique and executable SQL remains exactly equivalent", () => {
  assert.deepEqual(selectedMigrationProblems(vinPokerRoot), []);
  assert.deepEqual(migrationEquivalenceProblems(vinPokerRoot), []);
  assert.deepEqual(sourcePolicyProblems(), []);
});

test("all executable rollout paths select only the unique superseding alert migration", () => {
  const workspaceRoot = resolve(vinPokerRoot, "..");
  const disposableRunner = readFileSync(
    resolve(vinPokerRoot, "scripts/deploy/test-dealer-swing-drift-disposable.ps1"),
    "utf8",
  );
  const protectedWorkflow = readFileSync(
    resolve(workspaceRoot, ".github/workflows/dealer-shortage-alert-lifecycle-apply.yml"),
    "utf8",
  );
  const runbook = readFileSync(resolve(vinPokerRoot, "docs/dealer-swing/SHORTAGE_ALERT_ROLLOUT.md"), "utf8");

  assert.match(disposableRunner, /20270104000006_dealer_shortage_alert_lifecycle\.sql/);
  assert.doesNotMatch(disposableRunner, /20270104000005_dealer_shortage_alert_lifecycle\.sql/);
  assert.match(protectedWorkflow, /20270104000006/);
  assert.doesNotMatch(protectedWorkflow, /20270104000005_dealer_shortage_alert_lifecycle\.sql/);
  assert.match(runbook, /NEVER_APPLY.*20270104000005_dealer_shortage_alert_lifecycle\.sql/s);
  assert.match(runbook, /Apply only `20270104000006_dealer_shortage_alert_lifecycle\.sql`/);
});

test("exact selector skips only a matching candidate ledger record with the exact post-state", () => {
  const post = exactPostState();
  const candidate = [{ version: MIGRATION_VERSION, name: MIGRATION_NAME }];
  assert.equal(preApplyDecision(post, candidate).action, "skip");
  assert.equal(preApplyDecision(exactPreState(), []).action, "apply");
  assert.equal(
    preApplyDecision(post, [{ version: MIGRATION_VERSION, name: "unexpected" }]).reason,
    "exact_post_unregistered",
  );
  assert.equal(
    preApplyDecision(post, [{ version: "invalid", name: MIGRATION_NAME }]).reason,
    "history_conflict",
  );
  assert.equal(
    preApplyDecision(exactPreState(), [{ version: "20270104000005", name: "floor_operator_scope_acl" }]).reason,
    "exact_absent_pre_state",
  );
  assert.equal(
    preApplyDecision(
      { ...exactPreState(), floor_collision_post_state: false },
      [{ version: "20270104000005", name: "floor_operator_scope_acl" }],
    ).reason,
    "history_conflict",
  );
});

test("managed migration request uses only the approved endpoint and immutable name", async () => {
  const calls = [];
  await applyManagedMigration(
    { projectRef: "orlesggcjamwuknxwcpk", token: "test-token" },
    "select 1;",
    async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({});
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith("/database/migrations"), true);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { query: "select 1;", name: MIGRATION_NAME });
});

test("preflight is read-only and apply records only the approved migration identity", async () => {
  const calls = [];
  let stateReads = 0;
  let migrationApplied = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) {
      stateReads += 1;
      return jsonResponse([migrationApplied ? exactPostState() : exactPreState()]);
    }
    if (url.endsWith("/database/migrations") && options.method === "GET") {
      return jsonResponse(migrationApplied ? [{ version: MIGRATION_VERSION, name: MIGRATION_NAME }] : []);
    }
    if (url.endsWith("/database/migrations") && options.method === "POST") {
      migrationApplied = true;
      return jsonResponse({});
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  const env = { SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk", SUPABASE_ACCESS_TOKEN: "test-token" };

  const preflight = await run(["--preflight"], env, fetchImpl);
  assert.equal(preflight.applied, false);
  assert.equal(calls.some((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations")), false);

  const applied = await run(["--apply"], {
    ...env,
    CONFIRM_APPLY_DEALER_SHORTAGE_ALERT: CONFIRMATION,
  }, fetchImpl);
  assert.equal(applied.applied, true);
  assert.equal(stateReads >= 3, true);
  const applyCall = calls.find((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations"));
  assert.deepEqual(JSON.parse(applyCall.options.body).name, MIGRATION_NAME);
  assert.doesNotMatch(
    normalizeExecutableSql(JSON.parse(applyCall.options.body).query),
    /20270104000005_dealer_shortage_alert_lifecycle/,
  );
  assert.equal(MIGRATION_PATH.endsWith("20270104000006_dealer_shortage_alert_lifecycle.sql"), true);
});
