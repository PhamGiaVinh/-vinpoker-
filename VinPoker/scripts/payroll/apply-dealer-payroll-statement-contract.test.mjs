import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  CONFIRMATION,
  MIGRATIONS,
  applyPlan,
  deliveryPostProblems,
  deliveryPreProblems,
  DELIVERY_ROLLOUT_STATE_SQL,
  DELIVERY_STATE_SQL,
  finalPostProblems,
  pdfPostProblems,
  preStateProblems,
  ROLLOUT_STATE_SQL,
  run,
  sourceProblems,
  STATE_SQL,
} from "./apply-dealer-payroll-statement-contract.mjs";

function preState() {
  return {
    statements_table_exists: true,
    lines_table_exists: true,
    buckets_table_exists: true,
    payroll_bucket_private: false,
    rollout_table_exists: false,
    mark_exists: false,
    pdf_hash: false,
    pdf_storage_path: false,
    pdf_render_version: false,
    pdf_rendered_at: false,
    statement_version: false,
    pdf_status: false,
    pdf_generation_request_id: false,
    pdf_generation_token: false,
    rollout_exists: false,
    preview_exists: false,
    list_exists: false,
    finalize_exists: false,
    claim_exists: false,
    complete_exists: false,
    fail_exists: false,
  };
}

function pdfState() {
  return {
    ...preState(),
    payroll_bucket_private: true,
    mark_exists: true,
    pdf_hash: true,
    pdf_storage_path: true,
    pdf_render_version: true,
    pdf_rendered_at: true,
    mark_service_execute: true,
    mark_authenticated_execute: false,
    mark_anon_execute: false,
    mark_overloads: 1,
  };
}

function finalState() {
  return {
    ...pdfState(),
    rollout_table_exists: true,
    rollout_rls_enabled: true,
    statement_version: true,
    pdf_status: true,
    pdf_generation_request_id: true,
    pdf_generation_token: true,
    rollout_exists: true,
    preview_exists: true,
    list_exists: true,
    finalize_exists: true,
    claim_exists: true,
    complete_exists: true,
    fail_exists: true,
    rollout_overloads: 1,
    preview_overloads: 1,
    list_overloads: 1,
    finalize_overloads: 1,
    claim_overloads: 1,
    complete_overloads: 1,
    fail_overloads: 1,
    rollout_authenticated_execute: true,
    rollout_anon_execute: false,
    preview_authenticated_execute: true,
    preview_anon_execute: false,
    list_authenticated_execute: true,
    list_anon_execute: false,
    finalize_authenticated_execute: true,
    finalize_anon_execute: false,
    claim_service_execute: true,
    claim_authenticated_execute: false,
    complete_service_execute: true,
    complete_authenticated_execute: false,
    fail_service_execute: true,
    fail_authenticated_execute: false,
    rollout_row_count: 1,
    rollout_master_enabled_count: 0,
    rollout_all_clubs_enabled_count: 0,
    rollout_allowlist_count: 0,
  };
}

function deliveryPreState() {
  return {
    ...finalState(),
    delivery_rollout_table_exists: false,
    delivery_operations_table_exists: false,
    delivery_targets_table_exists: false,
    delivery_assert_exists: false,
    delivery_rollout_exists: false,
    delivery_create_exists: false,
    delivery_get_exists: false,
    delivery_claim_exists: false,
    delivery_complete_exists: false,
    delivery_fail_exists: false,
    delivery_assert_overloads: 0,
    delivery_rollout_overloads: 0,
    delivery_create_overloads: 0,
    delivery_get_overloads: 0,
    delivery_claim_overloads: 0,
    delivery_complete_overloads: 0,
    delivery_fail_overloads: 0,
    delivery_rollout_row_count: 0,
    delivery_rollout_master_enabled_count: 0,
    delivery_rollout_all_clubs_enabled_count: 0,
    delivery_rollout_allowlist_count: 0,
  };
}

function deliveryState() {
  return {
    ...deliveryPreState(),
    delivery_rollout_table_exists: true,
    delivery_operations_table_exists: true,
    delivery_targets_table_exists: true,
    delivery_rollout_rls_enabled: true,
    delivery_operations_rls_enabled: true,
    delivery_targets_rls_enabled: true,
    delivery_assert_exists: true,
    delivery_rollout_exists: true,
    delivery_create_exists: true,
    delivery_get_exists: true,
    delivery_claim_exists: true,
    delivery_complete_exists: true,
    delivery_fail_exists: true,
    delivery_assert_overloads: 1,
    delivery_rollout_overloads: 1,
    delivery_create_overloads: 1,
    delivery_get_overloads: 1,
    delivery_claim_overloads: 1,
    delivery_complete_overloads: 1,
    delivery_fail_overloads: 1,
    delivery_assert_service_execute: true,
    delivery_assert_authenticated_execute: false,
    delivery_assert_anon_execute: false,
    delivery_rollout_authenticated_execute: true,
    delivery_rollout_anon_execute: false,
    delivery_create_authenticated_execute: true,
    delivery_create_anon_execute: false,
    delivery_get_authenticated_execute: true,
    delivery_get_anon_execute: false,
    delivery_claim_service_execute: true,
    delivery_claim_authenticated_execute: false,
    delivery_complete_service_execute: true,
    delivery_complete_authenticated_execute: false,
    delivery_fail_service_execute: true,
    delivery_fail_authenticated_execute: false,
    delivery_rollout_row_count: 1,
  };
}

test("source policy pins the three exact payroll migrations", () => {
  assert.deepEqual(sourceProblems(resolve(import.meta.dirname, "../..")), []);
});

test("preflight accepts only the exact absent state", () => {
  const state = preState();
  assert.deepEqual(preStateProblems(state), []);
  assert.deepEqual(applyPlan(state, []), {
    action: "apply",
    reason: "exact_pre_state",
    migrations: MIGRATIONS,
  });
});

test("partial first-migration state schedules only the second migration", () => {
  const state = pdfState();
  assert.deepEqual(pdfPostProblems(state), []);
  assert.equal(applyPlan(state, []).migrations[0].version, "20270113000001");
});

test("statement-ready state schedules only the delivery migration", () => {
  const state = deliveryPreState();
  assert.deepEqual(deliveryPreProblems(state), []);
  assert.deepEqual(applyPlan(state, []).migrations.map((migration) => migration.version), ["20270113000004"]);
});

test("complete state skips without another migration request", () => {
  const state = deliveryState();
  assert.deepEqual(deliveryPostProblems(state), []);
  assert.deepEqual(applyPlan(state, []), { action: "skip", reason: "exact_post_verified", migrations: [] });
});

test("unknown partial state blocks instead of guessing a repair", () => {
  const state = { ...preState(), pdf_hash: true };
  assert.equal(applyPlan(state, []).action, "block");
});

test("pre-migration catalog query does not reference the absent rollout relation", () => {
  assert.doesNotMatch(STATE_SQL, /from\s+public\.dealer_payroll_statement_rollout/i);
  assert.match(ROLLOUT_STATE_SQL, /from\s+public\.dealer_payroll_statement_rollout/i);
});

test("private storage bucket is reported with the correct boolean polarity", () => {
  assert.match(STATE_SQL, /select\s+not\s+bucket\.public\s+from\s+storage\.buckets\s+bucket/i);
});

test("legacy broad apply is retired before any network request", async () => {
  let called = false;
  await assert.rejects(
    () => run(["--apply"], {}, async () => { called = true; throw new Error("unexpected network"); }),
    /LEGACY_PAYROLL_STATEMENT_APPLY_RETIRED/,
  );
  assert.equal(called, false);
});

test("workflow uses the protected environment and the exact runner", () => {
  const workflow = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/dealer-payroll-statement-contract-apply.yml"), "utf8");
  assert.match(workflow, /dealer-swing-production-critical/);
  assert.match(workflow, /apply-dealer-payroll-statement-contract\.mjs/);
  assert.match(workflow, /secrets\.SUPABASEACCESSTOKEN/);
  assert.doesNotMatch(workflow, /secrets\.SUPABASEACCESTOKEN/);
  assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.doesNotMatch(workflow, /db push|include-all|SUPABASE_DB_PASSWORD/i);
  assert.match(workflow, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(workflow, /printf '%s\\n' "- Source SHA: \$SOURCE_SHA"/);
  assert.doesNotMatch(workflow, /--apply/);
  assert.match(workflow, /legacy read-only preflight/);
  assert.doesNotMatch(workflow, /`\$\{\{ inputs\.source_sha \}\}`/);
});

test("management API failures expose only sanitized method, path, status, and provider code", async () => {
  await assert.rejects(
    () => run(["--preflight", "--source-root", resolve(import.meta.dirname, "../..")], {
      SUPABASE_ACCESS_TOKEN: "test-only-token",
      SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
    }, async (url, options) => ({
      ok: false,
      status: 400,
      json: async () => ({ code: "PGRST200", message: "private message with UUID" }),
      url,
      options,
    })),
    (error) => {
      assert.match(error.message, /Management API request failed: POST \/database\/query\/read-only status 400 provider_code PGRST200/);
      assert.doesNotMatch(error.message, /private message|UUID|message/);
      return true;
    },
  );
});
