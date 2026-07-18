import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createRunId,
  requireProductionCanaryContext,
} from "../../scripts/floor/floor-production-canary.mjs";

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
  const source = readFileSync(new URL("../../scripts/floor/floor-production-canary.mjs", import.meta.url), "utf8");
  const cleanupBranch = source.indexOf('if (context.mode === "cleanup")');
  assert.notEqual(cleanupBranch, -1);
  const cleanupBody = source.slice(cleanupBranch, source.indexOf("const runId", cleanupBranch));
  assert.match(cleanupBody, /await runCleanupCanary\(admin\)/);
  assert.doesNotMatch(cleanupBody, /createActor|createFixture|runApiCanary|runBrowserManifest|invokeFunction/);
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
