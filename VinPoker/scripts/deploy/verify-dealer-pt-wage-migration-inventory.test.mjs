import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const script = readFileSync(resolve(root, "scripts/deploy/verify-dealer-pt-wage-migration-inventory.mjs"), "utf8");

test("payroll migration inventory pins archived sources and fails closed on active catalog collisions", () => {
  assert.match(script, /20270106000001/);
  assert.match(script, /20270112000000/);
  assert.match(script, /migration-archive\/superseded\/remote-alias/);
  assert.match(script, /migration-archive\/historical-never-replay/);
  assert.match(script, /20270105000002_dealer_pt_wage_global_continuous_accrual\.sql/);
  assert.match(script, /20270105000003_dealer_pt_wage_rate_history\.sql/);
  assert.match(script, /PAYROLL_MIGRATION_VERSION_COLLISION/);
  assert.match(script, /PAYROLL_HISTORICAL_MIGRATION_MISSING/);
  assert.match(script, /PAYROLL_HISTORICAL_MIGRATION_MUTATED/);
  assert.match(script, /MIGRATION_CATALOG_VERSION_COLLISION/);
  assert.match(script, /existing_timestamp_collision_count/);
});

test("current reconciled migration catalog passes the pinned inventory checker", () => {
  const result = spawnSync(process.execPath, [
    resolve(root, "scripts/deploy/verify-dealer-pt-wage-migration-inventory.mjs"),
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.archived_payroll_versions_active_count, 0);
  assert.equal(output.payroll_versions_unique, true);
  assert.equal(output.historical_migrations_immutable, true);
});
