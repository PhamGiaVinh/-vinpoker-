import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const runner = readFileSync(resolve(root, "scripts/deploy/test-dealer-pt-wage-disposable.ps1"), "utf8");

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
