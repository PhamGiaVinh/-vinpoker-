import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { requireContext } from "../../scripts/floor/floor-uat-test-provision.mjs";

const valid = {
  FLOOR_UAT_ENV: "production-test",
  FLOOR_UAT_CONFIRM: "PROVISION_FLOOR_UAT_TEST_USERS",
  FLOOR_UAT_OPERATION: "provision",
  SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
  SUPABASE_URL: "https://orlesggcjamwuknxwcpk.supabase.co",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  GITHUB_REF: "refs/heads/codex/floor-production-canary",
};

test("accepts only the protected non-main production TEST provisioning context", () => {
  assert.equal(requireContext(valid).operation, "provision");
});

test("fails closed for main, another project, or an unsafe confirmation", () => {
  for (const [field, value, expected] of [
    ["GITHUB_REF", "refs/heads/main", "floor_uat_must_not_run_from_main"],
    ["SUPABASE_PROJECT_REF", "other", "production_project_ref_mismatch"],
    ["FLOOR_UAT_CONFIRM", "anything", "floor_uat_confirmation_missing"],
  ]) assert.throws(() => requireContext({ ...valid, [field]: value }), new RegExp(expected));
});

test("cleanup requires one exact UAT run identifier", () => {
  assert.throws(
    () => requireContext({ ...valid, FLOOR_UAT_OPERATION: "cleanup", FLOOR_UAT_RUN_ID: "all" }),
    /floor_uat_cleanup_run_id_invalid/,
  );
  assert.equal(requireContext({
    ...valid,
    FLOOR_UAT_OPERATION: "cleanup",
    FLOOR_UAT_RUN_ID: "CODEX_FLOOR_UAT_20990101120000_aaaaaaaa",
  }).operation, "cleanup");
});

test("uses a TEST cashier membership and authenticated actor JWT for confirmation", async () => {
  const source = await readFile(new URL("../../scripts/floor/floor-uat-test-provision.mjs", import.meta.url), "utf8");
  assert.match(source, /from\("club_cashiers"\)\.insert/);
  assert.match(source, /from\("club_cashiers"\)\.delete/);
  assert.match(source, /client\.auth\.signInWithPassword/);
  assert.match(source, /provisioner\.client\.rpc\("confirm_registration_and_assign_seat"/);
  assert.doesNotMatch(source, /user_roles/);
});
