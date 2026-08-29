import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  AGGREGATES_SQL,
  CATALOG_SQL,
  CONFIRMATION,
  DELIVERY_GATE_SQL,
  LEGACY_DELIVERY_MIGRATION_NAME,
  PARENT_GATE_SQL,
  REPAIR_MIGRATION,
  catalogClass,
  deliveryGateClass,
  historyDiagnostics,
  repairDecision,
  run,
  sourceProblems,
} from "./repair-dealer-payroll-statement-delivery.mjs";
import { run as runLegacy } from "./apply-dealer-payroll-statement-contract.mjs";

const root = resolve(import.meta.dirname, "../..");

const dependencyKeys = [
  "statements_ready", "attempts_ready", "statement_rollout_ready", "periods_ready", "dealers_ready",
  "audit_ready", "full_time_payments_ready", "part_time_payments_ready",
  "statement_allowed_ready", "actor_ready", "finalizer_ready",
];
const objectKeys = [
  "rollout_table_exists", "operations_table_exists", "targets_table_exists",
  "operations_period_index_exists", "operations_active_index_exists", "targets_active_index_exists",
  "targets_state_index_exists", "attempts_target_index_exists", "attempts_operation_id_exists", "attempts_target_id_exists",
  "allowed_exists", "assert_exists", "rollout_exists", "refresh_exists", "create_exists", "get_exists",
  "claim_exists", "complete_exists", "fail_exists",
];

function catalog(complete = false) {
  const state = Object.fromEntries([...dependencyKeys, ...objectKeys].map((key) => [key, complete || dependencyKeys.includes(key)]));
  Object.assign(state, {
    rollout_rls_forced: complete,
    operations_rls_forced: complete,
    targets_rls_forced: complete,
    rollout_authenticated_execute: complete,
    rollout_anon_execute: false,
    create_authenticated_execute: complete,
    create_anon_execute: false,
    get_authenticated_execute: complete,
    get_anon_execute: false,
    assert_service_execute: complete,
    claim_service_execute: complete,
    claim_authenticated_execute: false,
    complete_service_execute: complete,
    complete_authenticated_execute: false,
    fail_service_execute: complete,
    fail_authenticated_execute: false,
    tables_authenticated_denied: complete,
    tables_anon_denied: complete,
    tables_service_worker_access: complete,
  });
  for (const key of [
    "allowed_overloads", "assert_overloads", "rollout_overloads", "refresh_overloads", "create_overloads",
    "get_overloads", "claim_overloads", "complete_overloads", "fail_overloads",
  ]) state[key] = complete ? 1 : 0;
  return state;
}

const parentGate = { row_count: 1, master_count: 1, all_clubs_count: 0, hsop_only_count: 1 };
const darkGate = { row_count: 1, master_count: 0, all_clubs_count: 0, hsop_only_count: 0, empty_allowlist_count: 1 };
const aggregates = { statement_rows: 10, pdf_ready_rows: 4, delivery_attempt_rows: 0, full_time_payment_rows: 3, part_time_payment_rows: 2 };
const repairHistory = [{ version: "20260828150000", name: REPAIR_MIGRATION.name }];
const legacyDeliveryHistory = [{ version: "20260828140000", name: LEGACY_DELIVERY_MIGRATION_NAME }];

test("source policy pins only the forward repair migration", () => {
  assert.deepEqual(sourceProblems(root), []);
  const sql = readFileSync(resolve(root, REPAIR_MIGRATION.path), "utf8");
  assert.match(sql, /PAYROLL_DELIVERY_PARTIAL_DRIFT/);
  assert.doesNotMatch(sql, /update\s+public\.dealer_payroll_statement_rollout/i);
});

test("fully absent catalog plans exactly one forward repair by name", () => {
  assert.equal(catalogClass(catalog(false)), "absent");
  assert.deepEqual(repairDecision({ catalog: catalog(false), history: [], parentGate }), {
    action: "apply",
    reason: "exact_absent_contract",
  });
});

test("remote ledger versions are ignored while exact names remain authoritative", () => {
  const history = [
    { version: "20260828125638", name: "20270113000001_dealer_payroll_statement_ft_ui_contract" },
    { version: "not-the-source-version", name: REPAIR_MIGRATION.name },
  ];
  assert.equal(repairDecision({ catalog: catalog(true), history, parentGate }).action, "skip");
  assert.equal(historyDiagnostics(history).find((entry) => entry.name.includes("00001"))?.matches, 1);
});

test("exact legacy migration plus complete contract is a verified no-op", () => {
  assert.deepEqual(repairDecision({
    catalog: catalog(true),
    history: legacyDeliveryHistory,
    parentGate,
    deliveryGate: darkGate,
  }), {
    action: "skip",
    reason: "legacy_contract_verified_dark",
  });
});

test("legacy-complete adoption fails closed for missing, duplicate or unexpected rollout evidence", () => {
  assert.equal(repairDecision({ catalog: catalog(true), history: [], parentGate, deliveryGate: darkGate }).reason,
    "untracked_complete_contract");
  assert.equal(repairDecision({
    catalog: catalog(true),
    history: [...legacyDeliveryHistory, ...legacyDeliveryHistory],
    parentGate,
    deliveryGate: darkGate,
  }).reason, "legacy_history_duplicate");
  assert.equal(repairDecision({
    catalog: catalog(true),
    history: legacyDeliveryHistory,
    parentGate,
    deliveryGate: { ...darkGate, all_clubs_count: 1 },
  }).reason, "legacy_delivery_gate_unexpected");
});

test("partial schema, tracked-but-absent, duplicate repair name, dependency drift and wrong parent gate fail closed", () => {
  assert.equal(repairDecision({ catalog: { ...catalog(false), rollout_table_exists: true }, history: [], parentGate }).reason, "partial_catalog_drift");
  assert.equal(repairDecision({ catalog: catalog(false), history: repairHistory, parentGate }).reason, "repair_tracked_but_absent");
  assert.equal(repairDecision({ catalog: catalog(true), history: [...repairHistory, ...repairHistory], parentGate }).reason, "repair_history_duplicate");
  assert.equal(repairDecision({ catalog: { ...catalog(false), statements_ready: false }, history: [], parentGate }).reason, "dependency_unavailable");
  assert.equal(repairDecision({ catalog: catalog(false), history: [], parentGate: { ...parentGate, master_count: 0 } }).reason, "parent_gate_drift");
});

test("delivery gate accepts only dark defaults or exact HSOP", () => {
  assert.equal(deliveryGateClass(darkGate), "dark");
  assert.equal(deliveryGateClass({ ...darkGate, master_count: 1, hsop_only_count: 1, empty_allowlist_count: 0 }), "hsop");
  assert.equal(deliveryGateClass({ ...darkGate, all_clubs_count: 1 }), "unexpected");
});

test("ACL or overload drift makes an otherwise complete catalog partial", () => {
  assert.equal(catalogClass({ ...catalog(true), tables_anon_denied: false }), "partial");
  assert.equal(catalogClass({ ...catalog(true), claim_overloads: 2 }), "partial");
});

function mockFetch({
  loseApplyResponse = false,
  mutateAggregates = false,
  initialCatalogComplete = false,
  initialHistory = [],
} = {}) {
  let applied = initialCatalogComplete;
  let migrationPosts = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/database/migrations") && options.method === "GET") {
      return { ok: true, status: 200, json: async () => applied ? (initialHistory.length ? initialHistory : repairHistory) : [] };
    }
    if (url.endsWith("/database/migrations") && options.method === "POST") {
      migrationPosts += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.name, REPAIR_MIGRATION.name);
      assert.match(body.query, /PAYROLL_DELIVERY_PARTIAL_DRIFT/);
      applied = true;
      if (loseApplyResponse) throw new Error("connection lost after commit");
      return { ok: true, status: 201, json: async () => ({}) };
    }
    if (url.endsWith("/database/query/read-only")) {
      const query = JSON.parse(options.body).query;
      if (query === CATALOG_SQL) return { ok: true, status: 200, json: async () => [catalog(applied)] };
      if (query === PARENT_GATE_SQL) return { ok: true, status: 200, json: async () => [parentGate] };
      if (query === AGGREGATES_SQL) {
        return { ok: true, status: 200, json: async () => [{ ...aggregates, statement_rows: mutateAggregates && applied ? 11 : 10 }] };
      }
      if (query === DELIVERY_GATE_SQL) return { ok: true, status: 200, json: async () => [darkGate] };
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  return { fetchImpl, migrationPosts: () => migrationPosts };
}

test("repair posts only 00008 and verifies catalog, history, gates and unchanged aggregates", async () => {
  const mock = mockFetch();
  const result = await run(["--repair", "--source-root", root], {
    SUPABASE_ACCESS_TOKEN: "test-only-token",
    SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
    CONFIRM_PAYROLL_DELIVERY_REPAIR: CONFIRMATION,
  }, mock.fetchImpl);
  assert.equal(result.applied, true);
  assert.equal(mock.migrationPosts(), 1);
});

test("preflight and repair both preserve an exact legacy-complete contract without migration POST", async () => {
  for (const mode of ["--preflight", "--repair"]) {
    const mock = mockFetch({ initialCatalogComplete: true, initialHistory: legacyDeliveryHistory });
    const result = await run([mode, "--source-root", root], {
      SUPABASE_ACCESS_TOKEN: "test-only-token",
      SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
      CONFIRM_PAYROLL_DELIVERY_REPAIR: CONFIRMATION,
    }, mock.fetchImpl);
    assert.equal(result.applied, false);
    assert.equal(result.decision.reason, "legacy_contract_verified_dark");
    assert.equal(mock.migrationPosts(), 0);
  }
});

test("lost apply response performs catalog readback and never posts a second time", async () => {
  const mock = mockFetch({ loseApplyResponse: true });
  const result = await run(["--repair", "--source-root", root], {
    SUPABASE_ACCESS_TOKEN: "test-only-token",
    SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
    CONFIRM_PAYROLL_DELIVERY_REPAIR: CONFIRMATION,
  }, mock.fetchImpl);
  assert.equal(result.acknowledgement, "readback_required");
  assert.equal(mock.migrationPosts(), 1);
});

test("aggregate mutation blocks post-check", async () => {
  const mock = mockFetch({ mutateAggregates: true });
  await assert.rejects(() => run(["--repair", "--source-root", root], {
    SUPABASE_ACCESS_TOKEN: "test-only-token",
    SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
    CONFIRM_PAYROLL_DELIVERY_REPAIR: CONFIRMATION,
  }, mock.fetchImpl), /APPLY_OUTCOME_UNKNOWN_OR_POSTCHECK_FAILED/);
  assert.equal(mock.migrationPosts(), 1);
});

test("legacy broad apply is retired before credentials, source or network are touched", async () => {
  await assert.rejects(() => runLegacy(["--apply"], {}, async () => { throw new Error("network must not run"); }), /LEGACY_PAYROLL_STATEMENT_APPLY_RETIRED/);
});
