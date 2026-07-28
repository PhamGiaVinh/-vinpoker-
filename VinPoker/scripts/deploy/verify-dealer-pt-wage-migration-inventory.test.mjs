import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const script = readFileSync(resolve(root, "scripts/deploy/verify-dealer-pt-wage-migration-inventory.mjs"), "utf8");

test("payroll migration inventory fails only on a target-version collision", () => {
  assert.match(script, /20270106000001/);
  assert.match(script, /20270105000002_dealer_pt_wage_global_continuous_accrual\.sql/);
  assert.match(script, /20270105000003_dealer_pt_wage_rate_history\.sql/);
  assert.match(script, /PAYROLL_MIGRATION_VERSION_COLLISION/);
  assert.match(script, /PAYROLL_HISTORICAL_MIGRATION_MUTATED/);
  assert.match(script, /existing_timestamp_collision_count/);
});
