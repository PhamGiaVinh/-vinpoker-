import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAtomicMigrationQuery, classifyTarget, loadRelease, ORDER, PROJECT_REF, validateInvocation } from "./protected-nine-release-gate.mjs";

const { entries, control } = loadRelease();
const first = entries[0];
const envFor = (entry) => ({ SUPABASE_PROJECT_REF: PROJECT_REF, TARGET_MIGRATION: entry.filename, TARGET_NORMALIZED_SHA256: entry.normalizedSqlSha256, CONFIRM_PROTECTED_NINE: `APPLY_PROTECTED_NINE_${entry.newVersion}_${entry.normalizedSqlSha256}` });

test("binds exactly nine migration-control reservations and keeps production gates off", () => {
  assert.deepEqual(entries.map((entry) => entry.newVersion), ORDER);
  assert.ok(Object.values(control.safety).every((value) => value === false));
});
test("default or unauthorized invocation cannot apply", () => assert.throws(() => validateInvocation({}, first, "apply"), /project reference/));
test("wrong project, name, and hash are rejected", () => {
  assert.throws(() => validateInvocation({ ...envFor(first), SUPABASE_PROJECT_REF: "wrong" }, first, "apply"), /project/);
  assert.throws(() => validateInvocation({ ...envFor(first), TARGET_MIGRATION: "wrong.sql" }, first, "apply"), /filename/);
  assert.throws(() => validateInvocation({ ...envFor(first), TARGET_NORMALIZED_SHA256: "0".repeat(64) }, first, "apply"), /hash/);
});
test("wrong order and receipt-name drift are rejected", () => {
  assert.throws(() => classifyTarget([], entries, ORDER[1]), /Earlier/);
  assert.throws(() => classifyTarget([{ version: ORDER[0], name: "wrong" }], entries, ORDER[1]), /name drift/);
  assert.throws(() => classifyTarget([], entries, ORDER[0]), /predecessor receipt missing/);
});
test("TV Stage B requires compatible frontend SHA and authenticated UAT", () => {
  const stageB = entries[2];
  assert.throws(() => validateInvocation(envFor(stageB), stageB, "apply"), /authenticated UAT/);
  assert.doesNotThrow(() => validateInvocation({ ...envFor(stageB), TV_STAGE_A_FRONTEND_SHA: "a".repeat(40), TV_STAGE_A_AUTH_UAT: "PASS" }, stageB, "apply"));
});
test("package contains no named live-data mutation", () => {
  const source = [JSON.stringify({ entries, control }), readFileSync("../.github/workflows/protected-nine-exact-apply.yml", "utf8"), readFileSync("docs/operations/PROTECTED_NINE_CUTOVER.md", "utf8")].join("\n");
  for (const forbidden of ["Phil", "Tom", "Bàn 8", "Ban 8"]) assert.equal(source.includes(forbidden), false);
});
test("atomic query owns a separate lock and inserts one immutable receipt", () => {
  const query = buildAtomicMigrationQuery(first);
  assert.match(query, /pg_advisory_xact_lock\(280000, 9\)/);
  assert.equal((query.match(/INSERT INTO supabase_migrations\.schema_migrations/g) ?? []).length, 1);
  assert.doesNotMatch(query, /DELETE\s+FROM\s+supabase_migrations|UPDATE\s+supabase_migrations/i);
});
test("workflow does not print credential values", () => {
  const workflow = readFileSync("../.github/workflows/protected-nine-exact-apply.yml", "utf8");
  assert.doesNotMatch(workflow, /echo[^\n]*(SUPABASE_ACCESS_TOKEN|SUPABASEACCESSTOKEN)/);
  assert.match(workflow, /environment: dealer-swing-production-critical/);
});
