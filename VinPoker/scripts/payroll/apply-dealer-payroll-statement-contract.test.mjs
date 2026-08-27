import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  CONFIRMATION,
  MIGRATIONS,
  applyPlan,
  finalPostProblems,
  pdfPostProblems,
  preStateProblems,
  run,
  sourceProblems,
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

test("source policy pins the two exact payroll migrations", () => {
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

test("complete state skips without another migration request", () => {
  const state = finalState();
  assert.deepEqual(finalPostProblems(state), []);
  assert.deepEqual(applyPlan(state, []), { action: "skip", reason: "exact_post_verified", migrations: [] });
});

test("unknown partial state blocks instead of guessing a repair", () => {
  const state = { ...preState(), pdf_hash: true };
  assert.equal(applyPlan(state, []).action, "block");
});

test("apply sends only the exact migrations in order and verifies each post-state", async () => {
  let reads = 0;
  const calls = [];
  const states = [preState(), pdfState(), finalState()];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/database/migrations") && options.method === "GET") {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.endsWith("/database/migrations") && options.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url.endsWith("/database/query/read-only")) {
      return { ok: true, status: 200, json: async () => [states[Math.min(reads++, states.length - 1)]] };
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await run(
    ["--apply", "--source-root", resolve(import.meta.dirname, "../..")],
    {
      SUPABASE_ACCESS_TOKEN: "test-only-token",
      SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
      CONFIRM_APPLY_DEALER_PAYROLL_STATEMENT_CONTRACT: CONFIRMATION,
    },
    fetchImpl,
  );
  assert.equal(result.applied, true);
  const applyCalls = calls.filter((call) => call.url.endsWith("/database/migrations") && call.options.method === "POST");
  assert.equal(applyCalls.length, 2);
  assert.deepEqual(applyCalls.map((call) => JSON.parse(call.options.body).name), MIGRATIONS.map((migration) => migration.name));
});

test("workflow uses the protected environment and the exact runner", () => {
  const workflow = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/dealer-payroll-statement-contract-apply.yml"), "utf8");
  assert.match(workflow, /dealer-swing-production-critical/);
  assert.match(workflow, /apply-dealer-payroll-statement-contract\.mjs/);
  assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.doesNotMatch(workflow, /db push|include-all|SUPABASE_DB_PASSWORD/i);
});
