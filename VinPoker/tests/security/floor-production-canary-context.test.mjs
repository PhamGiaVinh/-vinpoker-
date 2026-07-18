import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunId,
  requireProductionCanaryContext,
} from "../../scripts/floor/floor-production-canary.mjs";

const valid = {
  FLOOR_CANARY_ENV: "production",
  FLOOR_CANARY_CONFIRM: "RUN_FLOOR_PRODUCTION_CANARY",
  FLOOR_CANARY_PREFIX: "CODEX_FLOOR_CANARY_",
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
