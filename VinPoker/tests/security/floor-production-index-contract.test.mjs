import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20261243000000_floor_cleanup_rotation_schedule_index.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../../scripts/floor/apply-floor-cleanup-index.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../../.github/workflows/floor-production-canary.yml", import.meta.url), "utf8");

function executableSql(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

test("migration contains only the exact concurrent supporting index", () => {
  const sql = executableSql(migration);
  assert.match(sql, /^CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dealer_rotation_schedule_table_id ON public\.dealer_rotation_schedule \(table_id\);$/i);
  assert.doesNotMatch(sql, /\b(BEGIN|COMMIT|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|schema_migrations)\b/i);
});

test("runner is project-bound, allowlisted, and never edits the migration ledger", () => {
  assert.match(runner, /PRODUCTION_REF = "orlesggcjamwuknxwcpk"/);
  assert.match(runner, /CONFIRMATION = "CREATE_FLOOR_CLEANUP_INDEX"/);
  assert.match(runner, /migration_not_exact_allowlist/);
  assert.match(runner, /i\.indpred is null and am\.amname = 'btree'/);
  assert.match(runner, /database\/query/);
  assert.match(runner, /DROP INDEX CONCURRENTLY IF EXISTS public\.\$\{INDEX_NAME\}/);
  assert.doesNotMatch(runner, /console\.(log|error)\([^\n]*accessToken/);
});

test("workflow cannot re-enter the one-time index phase", () => {
  assert.match(workflow, /environment: floor-production-canary/);
  assert.doesNotMatch(workflow, /controlled production canary runner \[index\]/);
  assert.doesNotMatch(workflow, /^\s+- index$/m);
  assert.doesNotMatch(workflow, /apply-floor-cleanup-index/);
  assert.doesNotMatch(workflow, /CREATE_FLOOR_CLEANUP_INDEX/);
});
