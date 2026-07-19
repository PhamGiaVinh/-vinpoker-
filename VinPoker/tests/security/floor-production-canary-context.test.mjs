import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createRunId,
  discoverCleanupScope,
  requireProductionCanaryContext,
} from "../../scripts/floor/floor-production-canary.mjs";

const canarySource = readFileSync(new URL("../../scripts/floor/floor-production-canary.mjs", import.meta.url), "utf8");

const valid = {
  FLOOR_CANARY_ENV: "production",
  FLOOR_CANARY_CONFIRM: "RUN_FLOOR_PRODUCTION_CANARY",
  FLOOR_CANARY_PREFIX: "CODEX_FLOOR_CANARY_",
  FLOOR_CANARY_MODE: "run",
  SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
  SUPABASE_URL: "https://orlesggcjamwuknxwcpk.supabase.co",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  GITHUB_REF: "refs/heads/codex/floor-production-canary",
};

test("accepts only an explicit non-main production canary context", () => {
  assert.equal(requireProductionCanaryContext(valid).projectRef, valid.SUPABASE_PROJECT_REF);
  assert.match(createRunId(valid.FLOOR_CANARY_PREFIX), /^CODEX_FLOOR_CANARY_\d{14}_[a-f0-9]{8}$/);
});

test("fails closed for main, wrong project, or an unsafe fixture prefix", () => {
  for (const [field, value, expected] of [
    ["GITHUB_REF", "refs/heads/main", "floor_canary_must_not_run_from_main"],
    ["SUPABASE_PROJECT_REF", "not-production", "production_project_ref_mismatch"],
    ["FLOOR_CANARY_PREFIX", "fixture_", "floor_canary_prefix_invalid"],
  ]) {
    assert.throws(() => requireProductionCanaryContext({ ...valid, [field]: value }), new RegExp(expected));
  }
});

test("fails closed for an unknown canary mode", () => {
  assert.throws(
    () => requireProductionCanaryContext({ ...valid, FLOOR_CANARY_MODE: "provision" }),
    /floor_canary_mode_invalid/,
  );
});

test("cleanup mode branches before provisioning or browser execution", () => {
  const cleanupBranch = canarySource.indexOf('if (context.mode === "cleanup")');
  assert.notEqual(cleanupBranch, -1);
  const cleanupBody = canarySource.slice(cleanupBranch, canarySource.indexOf("const runId", cleanupBranch));
  assert.match(cleanupBody, /await runCleanupCanary\(admin\)/);
  assert.doesNotMatch(cleanupBody, /createUser|createActor|createFixture|createCrossClub|runApiCanary|runBrowserManifest|invokeFunction|chromium/);
});

function cleanupDiscoveryAdmin(rows) {
  return {
    from(table) {
      assert.equal(table, "clubs");
      return {
        select() { return this; },
        like() { return this; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
      };
    },
  };
}

const cleanupRows = [
  { id: "10000000-0000-4000-8000-000000000001", owner_id: "20000000-0000-4000-8000-000000000001", name: "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa_ACCESS", region: "TEST" },
  { id: "10000000-0000-4000-8000-000000000002", owner_id: "20000000-0000-4000-8000-000000000002", name: "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa_CROSS_CLUB", region: "TEST" },
];

test("cleanup discovery accepts exactly one strict failed run group with two TEST clubs", async () => {
  const scopes = await discoverCleanupScope(cleanupDiscoveryAdmin(cleanupRows));
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes.map((scope) => scope.clubs.length), [2]);
  const deletedActorScopes = await discoverCleanupScope(cleanupDiscoveryAdmin(cleanupRows.map((row) => ({ ...row, owner_id: null }))));
  assert.equal(deletedActorScopes.length, 1);
});

test("cleanup discovery rejects unexpected run counts, suffixes, regions, and club counts", async () => {
  for (const rows of [
    [],
    [...cleanupRows, { id: "10000000-0000-4000-8000-000000000003", owner_id: "20000000-0000-4000-8000-000000000003", name: "CODEX_FLOOR_CANARY_20990101140000_cccccccc_ACCESS", region: "TEST" }],
    cleanupRows.map((row, index) => index === 0 ? { ...row, region: "VN" } : row),
    cleanupRows.map((row, index) => index === 0 ? { ...row, name: `${row.name}_UNKNOWN` } : row),
    cleanupRows.slice(0, 1),
  ]) {
    await assert.rejects(discoverCleanupScope(cleanupDiscoveryAdmin(rows)), /CLEANUP_SCOPE_UNEXPECTED/);
  }
});

test("cleanup implementation remains exact-ID only and bounded", () => {
  assert.match(canarySource, /CLEANUP_GAME_TABLE_BATCH_SIZE = 50/);
  assert.match(canarySource, /CLEANUP_MAX_BATCH_ATTEMPTS = 3/);
  assert.match(canarySource, /nextAttempt === CLEANUP_MAX_BATCH_ATTEMPTS[\s\S]{0,80}\? 1/);
  assert.match(canarySource, /deleteExactBatches\(admin, "game_tables", ledger\.gameTableIds/);
  assert.match(canarySource, /deleteExactAuthUser[\s\S]{0,120}attempt <= 3/);
  assert.match(canarySource, /cleanup_tournaments[\s\S]{0,500}cleanup_generated_audit/);
  assert.match(canarySource, /table: "dealer_rotation_schedule"[\s\S]{0,180}indexed: true/);
  assert.match(canarySource, /auth\.admin\.getUserById\(id\)/);
  assert.doesNotMatch(canarySource, /auth\.admin\.listUsers/);
  assert.doesNotMatch(canarySource, /delete\(\)[\s\S]{0,120}\.like\(/);
  assert.doesNotMatch(canarySource, /truncate|session_replication_role|schema_migrations/i);
});

test("scenario fixtures share one owned TEST club and finally uses an exact reconstructed ledger", () => {
  const fixtureBody = canarySource.slice(
    canarySource.indexOf("async function createFixture"),
    canarySource.indexOf("async function createCrossClub"),
  );
  assert.doesNotMatch(fixtureBody, /from\("clubs"\)\.insert/);
  assert.match(canarySource, /const primaryClubId = await createPrimaryClub/);
  assert.match(canarySource, /createFixture\(admin, runId, scenario, primaryClubId, owned\)/);
  assert.match(canarySource, /await buildCleanupLedger\(admin, \{ runId, clubs \}, userIds\)/);
  assert.match(canarySource, /finally \{[\s\S]{0,120}await cleanupCurrentRun\(admin, runId, owned\)/);
});

test("workflow has fail-closed run, cleanup, and hold modes", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/floor-production-canary.yml", import.meta.url), "utf8");
  assert.match(workflow, /type: choice/);
  assert.match(workflow, /- cleanup/);
  assert.match(workflow, /- hold/);
  assert.match(workflow, /title == 'test\(floor\): controlled production canary runner \[cleanup\]'/);
  assert.match(workflow, /if: env\.FLOOR_CANARY_MODE == 'run'/);
  assert.match(workflow, /FLOOR_CANARY_MODE:/);
});
