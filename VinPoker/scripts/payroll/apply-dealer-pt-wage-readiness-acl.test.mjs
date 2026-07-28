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
} from "./apply-dealer-pt-wage-readiness-acl.mjs";
import {
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  sourcePolicyProblems,
} from "./dealer-pt-wage-readiness-acl-migration-policy.mjs";

const vinPokerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const credentials = {
  SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
  SUPABASE_ACCESS_TOKEN: "test-token",
};

function exactV2DarkState() {
  return {
    global_policy_table_exists: true,
    rate_history_table_exists: true,
    readiness_exists: true,
    readiness_overloads: 1,
    readiness_argument_types: "timestamp with time zone",
    readiness_return_type: "void",
    readiness_security_definer: true,
    readiness_search_path: true,
    readiness_service_role_is_owner: false,
    readiness_service_role_execute: true,
    readiness_authenticated_execute: false,
    readiness_anon_execute: false,
    readiness_service_role_explicit_execute: true,
    readiness_public_execute: false,
    global_policy_rls_enabled: true,
    rate_history_rls_enabled: true,
    global_policy_authenticated_access: false,
    global_policy_anon_access: false,
    rate_history_authenticated_access: false,
    rate_history_anon_access: false,
    payment_snapshot_column_exists: true,
    rate_history_trigger_enabled: true,
    global_policy_row_count: 1,
    global_enabled_row_count: 0,
    global_enable_audit_count: 0,
    payment_row_count: 7,
    payment_rows_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    club_policy_row_count: 3,
    club_policy_rows_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    attendance_row_count: 11,
    attendance_rows_hash: "cccccccccccccccccccccccccccccccc",
    active_pt_dealer_count: 2,
    active_pt_baseline_count: 2,
  };
}

function exactPostState() {
  return {
    ...exactV2DarkState(),
    readiness_service_role_execute: false,
    readiness_service_role_explicit_execute: false,
  };
}

function history({ repair = false } = {}) {
  return [
    { version: "20270105000001", name: "platform-managed-baseline-name" },
    { version: "20270106000001", name: "20270106000001_dealer_pt_wage_global_continuous_accrual_v2" },
    ...(repair ? [{ version: MIGRATION_VERSION, name: MIGRATION_NAME }] : []),
  ];
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("source policy pins one narrow, transaction-wrapped readiness ACL repair", () => {
  assert.deepEqual(sourcePolicyProblems(vinPokerRoot), []);
  assert.equal(MIGRATION_PATH.endsWith("20270106000002_dealer_pt_wage_readiness_acl.sql"), true);
});

test("preflight accepts only v2 dark state with an explicit service role grant", () => {
  assert.equal(preApplyDecision(exactV2DarkState(), history()).action, "apply");
  assert.equal(preApplyDecision(exactPostState(), history({ repair: true })).action, "skip");
  assert.equal(
    preApplyDecision({ ...exactV2DarkState(), readiness_service_role_explicit_execute: false }, history()).reason,
    "unknown_pre_state",
  );
  assert.equal(
    preApplyDecision({ ...exactV2DarkState(), global_enabled_row_count: 1 }, history()).reason,
    "unknown_pre_state",
  );
  assert.equal(
    preApplyDecision(exactV2DarkState(), [...history(), { version: "20270105000002", name: "legacy" }]).reason,
    "history_conflict",
  );
});

test("read-only preflight never sends a migration write", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) return jsonResponse([exactV2DarkState()]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(history());
    throw new Error(`unexpected request ${options.method}`);
  };
  const result = await run(["--preflight"], credentials, fetchImpl);
  assert.equal(result.applied, false);
  assert.equal(calls.some((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations")), false);
});

test("apply writes exactly the ACL migration and verifies no payroll data drift", async () => {
  const calls = [];
  let applied = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) return jsonResponse([applied ? exactPostState() : exactV2DarkState()]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(history({ repair: applied }));
    if (url.endsWith("/database/migrations") && options.method === "POST") {
      applied = true;
      return jsonResponse({});
    }
    throw new Error(`unexpected request ${options.method}`);
  };
  const result = await run(["--apply"], {
    ...credentials,
    CONFIRM_APPLY_DEALER_PT_WAGE_READINESS_ACL: CONFIRMATION,
  }, fetchImpl);
  assert.equal(result.applied, true);
  const apply = calls.find((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations"));
  assert.deepEqual(JSON.parse(apply.options.body).name, MIGRATION_NAME);
  assert.equal(JSON.parse(apply.options.body).query.includes("revoke all on function"), true);
  assert.equal(JSON.parse(apply.options.body).query.includes("dealer_pt_wage_payments"), false);
});

test("post verification rejects a payout, policy, attendance, audit, or ACL regression", () => {
  const before = exactV2DarkState();
  assert.match(postApplyProblems(before, { ...exactPostState(), payment_row_count: 8 }).join("; "), /payment_row_count changed/);
  assert.match(postApplyProblems(before, { ...exactPostState(), club_policy_rows_hash: "dddddddddddddddddddddddddddddddd" }).join("; "), /club_policy_rows_hash changed/);
  assert.match(postApplyProblems(before, { ...exactPostState(), attendance_row_count: 12 }).join("; "), /attendance_row_count changed/);
  assert.match(postApplyProblems(before, { ...exactPostState(), global_enable_audit_count: 1 }).join("; "), /global_enable_audit_count/);
  assert.match(postApplyProblems(before, { ...exactPostState(), readiness_service_role_execute: true }).join("; "), /readiness_service_role_execute/);
});

test("unknown write outcome never infers rollback", async () => {
  await assert.rejects(
    applyManagedMigration({ projectRef: credentials.SUPABASE_PROJECT_REF, token: credentials.SUPABASE_ACCESS_TOKEN }, "select 1;", async () => {
      throw new Error("network");
    }),
    /APPLY_OUTCOME_UNKNOWN/,
  );
});

test("sanitized output drops raw payload fields", () => {
  const safe = safeState({
    ...exactV2DarkState(),
    payment_rows_hash: "not-a-hash",
    raw_message: "private UUID and URL",
  });
  assert.equal(safe.payment_rows_hash, "invalid");
  assert.equal(safe.raw_message, false);
});
