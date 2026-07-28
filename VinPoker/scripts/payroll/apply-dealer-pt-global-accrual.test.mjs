import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyManagedMigration,
  CONFIRMATION,
  postApplyProblems,
  preApplyDecision,
  run,
  safeState,
} from "./apply-dealer-pt-global-accrual.mjs";
import {
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  sourcePolicyProblems,
} from "./dealer-pt-global-accrual-migration-policy.mjs";

const vinPokerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const credentials = {
  SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
  SUPABASE_ACCESS_TOKEN: "test-token",
};

function exactPreState() {
  return {
    clubs_exists: true,
    dealers_exists: true,
    attendance_exists: true,
    club_policy_table_exists: true,
    payments_table_exists: true,
    payroll_audit_table_exists: true,
    club_policy_writer_exists: true,
    global_policy_table_exists: false,
    rate_history_table_exists: false,
    global_policy_rls_enabled: false,
    rate_history_rls_enabled: false,
    global_policy_authenticated_access: false,
    global_policy_anon_access: false,
    global_policy_service_role_select: false,
    rate_history_authenticated_access: false,
    rate_history_anon_access: false,
    rate_history_service_role_select: false,
    payment_snapshot_column_exists: true,
    rate_history_trigger_enabled: false,
    rate_history_index_exists: false,
    get_global_exists: false,
    set_global_exists: false,
    readiness_exists: false,
    balance_exists: true,
    payment_exists: true,
    get_global_overloads: 0,
    set_global_overloads: 0,
    readiness_overloads: 0,
    get_global_argument_types: "",
    set_global_argument_types: "",
    readiness_argument_types: "",
    get_global_return_type: "",
    set_global_return_type: "",
    readiness_return_type: "",
    get_global_security_definer: false,
    set_global_security_definer: false,
    readiness_security_definer: false,
    get_global_search_path: false,
    set_global_search_path: false,
    readiness_search_path: false,
    get_global_authenticated_execute: false,
    get_global_anon_execute: false,
    set_global_authenticated_execute: false,
    set_global_anon_execute: false,
    readiness_service_role_execute: false,
    readiness_authenticated_execute: false,
    readiness_anon_execute: false,
    get_global_public_execute: false,
    set_global_public_execute: false,
    readiness_public_execute: false,
    balance_segment_contract: false,
    payment_snapshot_contract: false,
    payment_row_count: 7,
    payment_rows_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    club_policy_row_count: 3,
    enabled_club_policy_count: 1,
    club_policy_rows_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    attendance_row_count: 11,
    attendance_rows_hash: "cccccccccccccccccccccccccccccccc",
    global_enable_audit_count: 0,
    global_audit_count: 0,
    post_data_available: false,
    active_pt_baseline_count: 0,
    active_pt_dealer_count: 0,
    global_enabled_row_count: 0,
    global_policy_row_count: 0,
  };
}

function exactPostState() {
  return {
    ...exactPreState(),
    global_policy_table_exists: true,
    rate_history_table_exists: true,
    global_policy_rls_enabled: true,
    rate_history_rls_enabled: true,
    global_policy_service_role_select: true,
    rate_history_service_role_select: true,
    payment_snapshot_column_exists: true,
    rate_history_trigger_enabled: true,
    rate_history_index_exists: true,
    get_global_exists: true,
    set_global_exists: true,
    readiness_exists: true,
    get_global_overloads: 1,
    set_global_overloads: 1,
    readiness_overloads: 1,
    set_global_argument_types: "boolean, text",
    readiness_argument_types: "timestamp with time zone",
    get_global_return_type: "jsonb",
    set_global_return_type: "jsonb",
    readiness_return_type: "void",
    get_global_security_definer: true,
    set_global_security_definer: true,
    readiness_security_definer: true,
    get_global_search_path: true,
    set_global_search_path: true,
    readiness_search_path: true,
    get_global_authenticated_execute: true,
    set_global_authenticated_execute: true,
    balance_segment_contract: true,
    payment_snapshot_contract: true,
    post_data_available: true,
    active_pt_baseline_count: 2,
    active_pt_dealer_count: 2,
    global_policy_row_count: 1,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baselineHistory() {
  return [{ version: "20270105000001", name: "platform-managed-baseline-name" }];
}

test("source policy locks the unique superseding migration and immutable historical source", () => {
  assert.deepEqual(sourcePolicyProblems(vinPokerRoot), []);
  assert.equal(MIGRATION_PATH.endsWith("20270106000001_dealer_pt_wage_global_continuous_accrual_v2.sql"), true);
});

test("preflight accepts only the dark baseline and post-state accepts only the registered exact contract", () => {
  assert.equal(preApplyDecision(exactPreState(), baselineHistory()).action, "apply");
  assert.equal(
    preApplyDecision(exactPostState(), [
      ...baselineHistory(),
      { version: MIGRATION_VERSION, name: MIGRATION_NAME },
    ]).action,
    "skip",
  );
  assert.equal(
    preApplyDecision(exactPreState(), [
      ...baselineHistory(),
      { version: "20270105000002", name: "platform-managed-legacy-name" },
    ]).action,
    "block",
  );
  assert.equal(
    preApplyDecision({ ...exactPreState(), global_policy_table_exists: true }, baselineHistory()).reason,
    "unknown_pre_state",
  );
  assert.equal(
    preApplyDecision({ ...exactPreState(), global_audit_count: 1 }, baselineHistory()).reason,
    "unknown_pre_state",
  );
});

test("read-only preflight has no managed migration write", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) return jsonResponse([exactPreState()]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(baselineHistory());
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  const result = await run(["--preflight"], credentials, fetchImpl);
  assert.equal(result.applied, false);
  assert.equal(calls.some((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations")), false);
});

test("apply writes only the exact reviewed migration and verifies dark post-state", async () => {
  const calls = [];
  let applied = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) {
      const isPostDataQuery = JSON.parse(options.body).query.includes("dealer_pt_wage_rate_history h");
      if (!applied) return jsonResponse([exactPreState()]);
      return jsonResponse([isPostDataQuery ? {
        active_pt_baseline_count: 2,
        active_pt_dealer_count: 2,
        global_enabled_row_count: 0,
        global_policy_row_count: 1,
      } : exactPostState()]);
    }
    if (url.endsWith("/database/migrations") && options.method === "GET") {
      return jsonResponse(applied
        ? [...baselineHistory(), { version: MIGRATION_VERSION, name: MIGRATION_NAME }]
        : baselineHistory());
    }
    if (url.endsWith("/database/migrations") && options.method === "POST") {
      applied = true;
      return jsonResponse({});
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  const result = await run(["--apply"], {
    ...credentials,
    CONFIRM_APPLY_DEALER_PT_GLOBAL_ACCRUAL: CONFIRMATION,
  }, fetchImpl);
  assert.equal(result.applied, true);
  const apply = calls.find((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations"));
  assert.deepEqual(JSON.parse(apply.options.body).name, MIGRATION_NAME);
  assert.equal(JSON.parse(apply.options.body).query.includes("20270105000002_dealer_pt_wage"), true);
});

test("a changed payment, policy, attendance, or global enable audit fails post-apply verification", () => {
  const before = exactPreState();
  const after = { ...exactPostState(), payment_row_count: before.payment_row_count + 1 };
  assert.match(postApplyProblems(before, after).join("; "), /payment_row_count changed/);
  assert.match(
    postApplyProblems(before, { ...exactPostState(), global_enable_audit_count: 1 }).join("; "),
    /global_enable_audit_count changed/,
  );
});

test("unknown migration write outcome never permits an inferred rollback", async () => {
  await assert.rejects(
    applyManagedMigration(
      { projectRef: "orlesggcjamwuknxwcpk", token: "test-token" },
      "select 1;",
      async () => { throw new Error("network"); },
    ),
    /APPLY_OUTCOME_UNKNOWN/,
  );
});

test("sanitized state output cannot carry a raw response payload", () => {
  const output = safeState({
    ...exactPreState(),
    payment_rows_hash: "not-a-hash",
    set_global_argument_types: "boolean, text",
    raw_message: "private",
  });
  assert.equal(output.payment_rows_hash, "invalid");
  assert.equal(output.set_global_argument_types, "boolean, text");
  assert.equal(output.raw_message, false);
});
