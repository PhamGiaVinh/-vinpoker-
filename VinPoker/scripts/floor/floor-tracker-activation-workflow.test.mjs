import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { stateProblems } from "./verify-floor-tracker-activation.mjs";

const root = resolve(import.meta.dirname, "..", "..", "..");
const workflow = readFileSync(resolve(root, ".github/workflows/floor-tracker-move-activation-apply.yml"), "utf8");

test("activation workflow is exact, protected, and versioned", () => {
  assert.match(workflow, /environment: dealer-swing-production-critical/);
  assert.match(workflow, /APPLY_FLOOR_TRACKER_MOVE_20270115000012/);
  assert.match(workflow, /20270115000012_floor_tracker_move_activation_v1\.sql/);
  assert.match(workflow, /EXACT_SCOPE_DRY_RUN=PASS/);
  assert.match(workflow, /supabase db push --linked --include-all --yes/);
  assert.doesNotMatch(workflow, /migration repair|schema_migrations.*(?:insert|update|delete)/i);
});

test("postcheck requires ledger and narrow role ACL", () => {
  assert.deepEqual(stateProblems({
    migration_registered: true,
    authenticated_execute: true,
    anon_execute: false,
    service_role_execute: false,
    public_execute: false,
  }), []);
  assert.match(stateProblems({})[0], /migration_registered/);
});
