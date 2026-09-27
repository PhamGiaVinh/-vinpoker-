import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { STATE_SQL, stateProblems } from "./verify-public-table-history.mjs";

const root = resolve(import.meta.dirname, "..", "..", "..");
const workflow = readFileSync(resolve(root, ".github/workflows/public-table-history-exact-apply.yml"), "utf8");

test("table-history workflow is exact, protected, hashed and versioned", () => {
  assert.match(workflow, /environment: dealer-swing-production-critical/);
  assert.match(workflow, /APPLY_TABLE_HISTORY_20260925115949/);
  assert.match(workflow, /20260925115949_public_table_history_verified_results\.sql/);
  assert.match(workflow, /9429ab4fcaf2b38f9bb425023fdb20e74f94da6465878bff3a676eeb50793bc7/);
  assert.match(workflow, /EXACT_SCOPE_DRY_RUN=PASS/);
  assert.match(workflow, /supabase db push --linked --include-all --yes/);
  assert.match(workflow, /options: \[preflight, verify, apply\]/);
  assert.match(workflow, /20270115000015_tracker_voice_dealer_handoff_authority\.sql/);
  assert.match(workflow, /20270115000016_tracker_correction_uat_release2\.sql/);
  assert.match(workflow, /20270115000017_tracker_completed_hand_correction_uat\.sql/);
  assert.doesNotMatch(workflow, /migration repair|schema_migrations.*(?:insert|update|delete)/i);
});

test("postcheck requires the exact ledger receipt and public RPC boundary", () => {
  assert.deepEqual(stateProblems({
    migration_registered: true,
    security_definer: true,
    empty_search_path: true,
    anon_execute: true,
    authenticated_execute: true,
    service_role_execute: true,
    public_execute: false,
    reads_verified_outcome: true,
    returns_net_delta: true,
  }), []);
  assert.match(stateProblems({})[0], /migration_registered/);
  assert.match(STATE_SQL, /version = '20260925115949'/);
  assert.match(STATE_SQL, /name = 'public_table_history_verified_results'/);
  assert.match(STATE_SQL, /a\.grantee = 0/);
});
