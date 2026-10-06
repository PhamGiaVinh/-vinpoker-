import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAtomicMigrationQuery, classifyTarget, loadRelease, ORDER, PROJECT_REF, validateInvocation, verifyObjectContractSource } from "./protected-nine-release-gate.mjs";

const { entries, control } = loadRelease();
const first = entries[0];
const envFor = (entry) => ({ SUPABASE_PROJECT_REF: PROJECT_REF, TARGET_MIGRATION: entry.filename, TARGET_NORMALIZED_SHA256: entry.normalizedSqlSha256, CONFIRM_PROTECTED_NINE: `APPLY_PROTECTED_NINE_${entry.newVersion}_${entry.normalizedSqlSha256}` });

test("binds the complete migration-control release order and keeps production gates off", () => {
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
  assert.throws(() => classifyTarget([{ version: ORDER[0], name: "wrong", statements: [entries[0].sql] }], entries, ORDER[1]), /name drift/);
  assert.throws(() => classifyTarget([{ version: ORDER[0], name: entries[0].semanticName, statements: [] }], entries, ORDER[1]), /Malformed/);
  assert.throws(() => classifyTarget([{ version: ORDER[0], name: entries[0].semanticName, statements: ["select 'drift';"] }], entries, ORDER[1]), /SQL hash drift/);
});
test("unrelated historical multi-statement receipts do not block the protected release", () => {
  const unrelated = { version: "20260422080820", name: "historical_migration", statements: Array.from({ length: 46 }, (_, index) => `select ${index};`) };
  const predecessor = control.productionReceipts.find((receipt) => receipt.version === "20270115000018");
  const source = readFileSync("supabase/migrations/20270115000018_dealer_assignment_session_binding.sql", "utf8");
  assert.equal(classifyTarget([unrelated, { version: predecessor.version, name: predecessor.semanticName, statements: [source] }], entries, ORDER[0]), "pending");
  assert.throws(() => classifyTarget([unrelated, unrelated], entries, ORDER[0]), /Ambiguous live receipt/);
  assert.throws(() => classifyTarget([{ version: predecessor.version, name: predecessor.semanticName, statements: [source, source] }], entries, ORDER[0]), /Malformed live receipt/);
});
test("current immutable 00018/00019/00020 receipts allow exact one-at-a-time advancement", () => {
  const legacySource = {
    "20270115000018": readFileSync("supabase/migrations/20270115000018_dealer_assignment_session_binding.sql", "utf8"),
    "20270115000019": readFileSync("supabase/migrations/20270115000020_tracker_voice_floor_owner_authority.sql", "utf8"),
    "20270115000020": readFileSync("supabase/migrations/20270115000020_tracker_voice_floor_owner_authority.sql", "utf8"),
  };
  const legacy = control.productionReceipts.map((receipt) => ({ version: receipt.version, name: receipt.semanticName, statements: [legacySource[receipt.version]] }));
  const rows = [];
  for (let index = 0; index < entries.length; index += 1) {
    assert.equal(classifyTarget([...legacy, ...rows], entries, entries[index].newVersion), "pending");
    rows.push({ version: entries[index].newVersion, name: entries[index].semanticName, statements: [entries[index].sql] });
    assert.equal(classifyTarget([...legacy, ...rows], entries, entries[index].newVersion), "already-applied-exact");
  }
  assert.throws(() => classifyTarget([{ ...legacy[0], statements: ["select 'drift';"] }, ...legacy.slice(1)], entries, entries[0].newVersion), /predecessor receipt SQL hash drift/);
});
test("package contains no named live-data mutation", () => {
  const source = [JSON.stringify({ entries, control }), readFileSync("../.github/workflows/protected-nine-exact-apply.yml", "utf8"), readFileSync("docs/operations/PROTECTED_NINE_CUTOVER.md", "utf8")].join("\n");
  for (const forbidden of ["Phil", "Tom", "Bàn 8", "Ban 8"]) assert.equal(source.includes(forbidden), false);
});
test("TV v1 preflight matches the authenticated live legacy shape exactly", () => {
  const [query] = entries.find((entry) => entry.newVersion === "20270128000002").postcheck.preflightQueries;
  assert.match(query, /f5e98d5224cdee45586c69b789a14a7fc5fd8cd7cf23f78451ca68097a7a7bf8/);
  assert.match(query, /proconfig=ARRAY\['search_path=public'\]/);
  assert.match(query, /has_function_privilege\('anon'/);
  assert.match(query, /has_function_privilege\('authenticated'/);
});
test("object contract tampering is rejected before planning", () => {
  const contract = readFileSync("scripts/ops/protected-nine-object-contract.json", "utf8");
  assert.doesNotThrow(() => verifyObjectContractSource(contract));
  assert.throws(() => verifyObjectContractSource(`${contract} `), /object contract hash drift/);
});
test("plan and apply verify the prior-stage live contract before any mutation", () => {
  const runner = readFileSync("scripts/ops/protected-nine-release-gate.mjs", "utf8");
  const guard = runner.indexOf('if ((mode === "plan" || mode === "apply") && state === "pending" && entryIndex > 0)');
  const priorStageCheck = runner.indexOf("verifyLiveObjectContract(entries, objectContract, entryIndex - 1, token)", guard);
  const mutation = runner.indexOf('if (mode === "apply")', priorStageCheck);
  assert.ok(guard >= 0 && priorStageCheck > guard && mutation > priorStageCheck);
});
test("postcheck and exact-receipt reconciliation do not rerun old-state preflight or migration SQL", () => {
  const runner = readFileSync("scripts/ops/protected-nine-release-gate.mjs", "utf8");
  assert.match(runner, /if \(state === "pending" && \(mode === "plan" \|\| mode === "apply"\)\)/);
  assert.match(runner, /if \(state === "pending"\) \{\s+const result = await request\("\/database\/query", token, \{ method: "POST", body: JSON\.stringify\(\{ query: buildAtomicMigrationQuery\(entry\) \}\) \}\);/);
  assert.match(runner, /else if \(state !== "already-applied-exact"\)/);
});
test("atomic query owns a separate lock and inserts one immutable receipt", () => {
  for (const entry of entries) {
    const query = buildAtomicMigrationQuery(entry);
    assert.match(query, /pg_advisory_xact_lock\(280000, 9\)/);
    assert.equal((query.match(/INSERT INTO supabase_migrations\.schema_migrations/g) ?? []).length, 1);
    assert.doesNotMatch(query, /DELETE\s+FROM\s+supabase_migrations|UPDATE\s+supabase_migrations/i);
  }
});
test("release source excludes named-live repair and broad data repair", () => {
  const migrations = entries.map((entry) => entry.sql).join("\n");
  assert.doesNotMatch(migrations, /\b(?:Phil|Tom)\b|Bàn 8|Ban 8/iu);
  assert.doesNotMatch(migrations, /docs\/emergency_rollbacks|repair.*orphan/i);
});
test("workflow does not print credential values", () => {
  const workflow = readFileSync("../.github/workflows/protected-nine-exact-apply.yml", "utf8");
  assert.doesNotMatch(workflow, /echo[^\n]*(SUPABASE_ACCESS_TOKEN|SUPABASEACCESSTOKEN)/);
  assert.match(workflow, /environment: dealer-swing-production-critical/);
  assert.equal((workflow.match(/set -euo pipefail\r?\n\s+node scripts\/ops\/protected-nine-release-gate\.mjs (?:plan|apply|postcheck)/g) ?? []).length, 4);
});
