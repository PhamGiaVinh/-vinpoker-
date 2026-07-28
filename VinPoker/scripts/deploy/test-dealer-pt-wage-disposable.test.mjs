import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const runner = readFileSync(resolve(root, "scripts/deploy/test-dealer-pt-wage-disposable.ps1"), "utf8");
const payrollFixtures = [
  "dealer_pt_global_continuous_accrual.sql",
  "dealer_pt_global_continuous_accrual_activation_gap.sql",
  "dealer_pt_global_continuous_accrual_activation_ready.sql",
  "dealer_pt_global_continuous_accrual_concurrency.sql",
];

test("PT wage disposable runner applies only the superseding Draft migration", () => {
  assert.match(runner, /\[ValidateSet\('16', '17'\)\]/);
  assert.match(runner, /dealer_pt_wage_global_continuous_accrual_v2\.sql/);
  assert.doesNotMatch(runner, /2027010500000[23]_dealer_pt_wage/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/activation-gap\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/v2\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/activation-ready\.sql'/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/v2\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/lifecycle\.sql'/);
  assert.match(runner, /verify-dealer-pt-wage-migration-inventory\.mjs/);
});

test("PT wage disposable runner never links to or mutates a production project", () => {
  assert.doesNotMatch(runner, /supabase\s+(?:link|db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(runner, /VERCEL|SUPABASE_(?:ACCESS|DB_PASSWORD|SERVICE)/i);
  assert.match(runner, /postgres:\$PostgresMajor/);
});

test("PT wage disposable SQL fixtures use canonical UUID literals", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f-]+$/;

  for (const file of payrollFixtures) {
    const fixture = readFileSync(resolve(root, "supabase/tests", file), "utf8");
    const quotedValues = [...fixture.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const value of quotedValues.filter((candidate) => uuidLike.test(candidate))) {
      assert.match(value, uuid, `${file} contains a malformed UUID fixture literal: ${value}`);
    }
  }
});

test("PT wage concurrency fixture consumes typed dblink results", () => {
  const fixture = readFileSync(
    resolve(root, "supabase/tests/dealer_pt_global_continuous_accrual_concurrency.sql"),
    "utf8",
  );

  assert.doesNotMatch(fixture, /select\s+dblink_get_result\s*\(/i);
  assert.equal(
    [...fixture.matchAll(/dblink_get_result\('[^']+'\)\s+as\s+t\(response text\)/g)].length,
    4,
    "every dblink result is consumed with an explicit record shape",
  );
});
