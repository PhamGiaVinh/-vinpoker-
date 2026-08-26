import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const runner = readFileSync(resolve(root, "scripts/deploy/test-dealer-pt-wage-disposable.ps1"), "utf8");
const disposableBootstrap = readFileSync(
  resolve(root, "scripts/deploy/disposable-public-schema-bootstrap.sql"),
  "utf8",
);
const readinessAclMigration = readFileSync(
  resolve(root, "supabase/migrations/20270106000002_dealer_pt_wage_readiness_acl.sql"),
  "utf8",
);
const payrollFixtures = [
  "dealer_pt_global_continuous_accrual.sql",
  "dealer_pt_global_continuous_accrual_activation_gap.sql",
  "dealer_pt_global_continuous_accrual_activation_ready.sql",
  "dealer_pt_global_continuous_accrual_readiness_acl_setup.sql",
  "dealer_pt_global_continuous_accrual_readiness_acl.sql",
  "dealer_pt_global_continuous_accrual_concurrency.sql",
  "disposable-payroll-baseline.sql",
  "dealer_payroll_statements.sql",
  "dealer_payroll_statements_concurrency.sql",
  "dealer_payroll_statement_ft_ui.sql",
  "dealer_payroll_statement_ft_ui_concurrency.sql",
];

test("PT wage disposable runner applies the exact payroll migration chain", () => {
  assert.match(runner, /\[ValidateSet\('16', '17'\)\]/);
  assert.match(runner, /dealer_pt_wage_global_continuous_accrual_v2\.sql/);
  assert.doesNotMatch(runner, /2027010500000[23]_dealer_pt_wage/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/activation-gap\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/v2\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/activation-ready\.sql'/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/v2\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/lifecycle\.sql'/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/readiness-acl-setup\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/readiness-acl-repair\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/readiness-acl\.sql'/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/support\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-baseline\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/activation-gap\.sql'/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/payroll-statements-v1\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-statements-v1\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-statements\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-statements-concurrency\.sql'/);
  assert.match(runner, /Invoke-ContainerPsql '\/tmp\/payroll-pdf-storage\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-ft-ui\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-ft-ui\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-ft-ui-test\.sql'[\s\S]*Invoke-ContainerPsql '\/tmp\/payroll-ft-ui-concurrency\.sql'/);
  assert.equal(
    [...runner.matchAll(/Invoke-ContainerPsql '\/tmp\/readiness-acl-repair\.sql'/g)].length,
    2,
    "readiness ACL repair is applied twice in the disposable proof",
  );
  assert.match(runner, /verify-dealer-pt-wage-migration-inventory\.mjs/);
});

test("payroll statement disposable fixtures exercise immutable statement and PT reservation paths", () => {
  const migration = readFileSync(
    resolve(root, "supabase/migrations/20270112000000_dealer_payroll_statements_v1.sql"),
    "utf8",
  );
  const lifecycle = readFileSync(resolve(root, "supabase/tests/dealer_payroll_statements.sql"), "utf8");

  assert.match(migration, /create table if not exists public\.dealer_payroll_statements/i);
  assert.match(migration, /create table if not exists public\.dealer_pt_wage_settlements/i);
  assert.match(migration, /pay_finalized_part_time_payroll_statement/i);
  assert.match(lifecycle, /PT_FINALIZED_STATEMENT_PENDING_PAYMENT/);
  assert.match(lifecycle, /later source-row mutation cannot recalculate an existing statement/);
});

test("readiness helper ACL repair is transaction-wrapped and cannot write payroll data", () => {
  assert.match(readinessAclMigration, /^\s*--[\s\S]*\bbegin\s*;/i);
  assert.match(readinessAclMigration, /commit\s*;\s*$/i);
  assert.match(
    readinessAclMigration,
    /revoke\s+all\s+on\s+function\s+public\.assert_dealer_pt_wage_global_activation_ready\(timestamptz\)\s+from\s+public,\s+anon,\s+authenticated,\s+service_role/i,
  );
  assert.match(readinessAclMigration, /has_function_privilege\([\s\S]*'service_role'/i);
  assert.doesNotMatch(readinessAclMigration, /\b(?:insert|update|delete|truncate|grant)\b/i);
});

test("PT wage disposable runner never links to or mutates a production project", () => {
  assert.doesNotMatch(runner, /supabase\s+(?:link|db\s+(?:push|reset)|functions\s+deploy)/i);
  assert.doesNotMatch(runner, /VERCEL|SUPABASE_(?:ACCESS|DB_PASSWORD|SERVICE)/i);
  assert.match(runner, /postgres:\$PostgresMajor/);
});

test("disposable bootstrap mirrors Supabase ownership roles from the storage schema dump", () => {
  assert.match(disposableBootstrap, /CREATE ROLE supabase_admin NOLOGIN/i);
  assert.match(disposableBootstrap, /CREATE ROLE supabase_storage_admin NOLOGIN/i);
  assert.doesNotMatch(disposableBootstrap, /\bLOGIN\b/i);
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
