import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

import {
  requireContext,
  validateMigration,
} from "../../scripts/floor/apply-floor-chip-cas-rpc.mjs";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20270104000001_floor_chip_cas_rpc.sql",
    import.meta.url,
  ),
  "utf8",
);
const applyRunner = readFileSync(
  new URL("../../scripts/floor/apply-floor-chip-cas-rpc.mjs", import.meta.url),
  "utf8",
);
const smokeRunner = readFileSync(
  new URL("../../scripts/floor/floor-chip-cas-smoke.mjs", import.meta.url),
  "utf8",
);
const edgeMetadata = readFileSync(
  new URL(
    "../../scripts/floor/floor-chip-cas-edge-metadata.mjs",
    import.meta.url,
  ),
  "utf8",
);
const workflow = readFileSync(
  new URL(
    "../../../.github/workflows/floor-production-canary.yml",
    import.meta.url,
  ),
  "utf8",
);

const valid = {
  SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
  SUPABASE_ACCESS_TOKEN: "test-access",
  GITHUB_REF: "refs/pull/912/merge",
  GITHUB_HEAD_REF: "codex/floor-production-canary",
  FLOOR_CHIP_CAS_CONFIRM: "APPLY_FLOOR_CHIP_CAS_RPC",
};

test("exact migration hash and write boundary are allowlisted", () => {
  assert.equal(validateMigration(migration), migration);
  assert.match(applyRunner, /EXPECTED_SHA256/);
  assert.match(applyRunner, /migration_write_count_mismatch/);
  assert.match(applyRunner, /migration_write_boundary_mismatch/);
  assert.doesNotMatch(migration, /CREATE POLICY/i);
});

test("rollout context is production-project bound but refuses main", () => {
  assert.equal(requireContext(valid).projectRef, valid.SUPABASE_PROJECT_REF);
  for (const [field, value, code] of [
    ["SUPABASE_PROJECT_REF", "preview", "project_ref_mismatch"],
    ["GITHUB_REF", "refs/heads/main", "rollout_must_not_run_from_main"],
    ["GITHUB_HEAD_REF", "another-branch", "head_ref_mismatch"],
    ["FLOOR_CHIP_CAS_CONFIRM", "wrong", "rollout_confirmation_missing"],
  ]) {
    assert.throws(
      () => requireContext({ ...valid, [field]: value }),
      new RegExp(code),
    );
  }
});

test("DB runner uses exact query transport and preserves migration ledger", () => {
  assert.match(applyRunner, /database\/query/);
  assert.match(applyRunner, /read_only: readOnly/);
  assert.match(applyRunner, /LEDGER_UNCHANGED/);
  assert.match(applyRunner, /migration_ledger_changed/);
  assert.match(applyRunner, /APPLY_FAILURE rollback_confirmed=/);
  assert.match(applyRunner, /ROLLBACK_PASS exact_function_removed=true edge_deployed=false/);
  assert.match(applyRunner, /if \(preExact === 0\)[\s\S]{0,120}rollbackNewFunction/);
  assert.doesNotMatch(applyRunner, /db push|include-all|migration up/i);
  assert.doesNotMatch(applyRunner, /console\.(log|error)\([^\n]*accessToken/);
  assert.doesNotMatch(applyRunner, /rolsuper|rolbypassrls/);
  assert.doesNotMatch(applyRunner, /as chip_only_write\s+from exact_fn/);
});

test("smoke covers roles, stale, concurrent, cross-club and exact cleanup", () => {
  for (const marker of [
    "owner_first_write",
    "cashier_first_write",
    "floor_first_write",
    "stale_write_denied",
    "cross_club_denied",
    "concurrent_exactly_one_success",
    "inactive_seat_denied",
    "entry_mismatch_denied",
    "refresh_reads_committed_server_state",
    "cleanupCurrentRun",
  ]) {
    assert.match(smokeRunner, new RegExp(marker));
  }
  assert.match(smokeRunner, /finally \{/);
  assert.doesNotMatch(smokeRunner, /auth\.admin\.listUsers|truncate|schema_migrations/i);
});

test("workflow orders exact apply before exact draw deploy and rollback", () => {
  const guards = workflow.indexOf("Run rollout guards before production mutation");
  const apply = workflow.indexOf("Apply and verify exact Floor chip CAS RPC migration");
  const rpcSmoke = workflow.indexOf("Run direct RPC behavior smoke before Edge deploy");
  const backup = workflow.indexOf("Record draw metadata and private rollback source");
  const deploy = workflow.indexOf("Deploy exact tournament-live-draw");
  const sourceVerify = workflow.indexOf("Verify deployed draw exact source hash");
  const edgeSmoke = workflow.indexOf("Run targeted Edge chip CAS canary");
  const rollback = workflow.indexOf("Roll back draw consumer after rollout failure");
  assert.ok(guards > 0 && guards < apply && apply < rpcSmoke && rpcSmoke < backup && backup < deploy);
  assert.ok(deploy < sourceVerify && sourceVerify < edgeSmoke && edgeSmoke < rollback);
  assert.match(workflow, /supabase functions deploy tournament-live-draw/);
  assert.match(workflow, /--no-verify-jwt/);
  assert.match(workflow, /supabase functions download tournament-live-draw/);
  assert.match(workflow, /upload=false/);
  assert.match(workflow, /FLOOR_DRAW_ROLLBACK_HASH/);
  assert.match(workflow, /test "\$deployed_hash" = "\$expected_hash"/);
  assert.match(workflow, /test "\$verified_hash" = "\$FLOOR_DRAW_ROLLBACK_HASH"/);
  assert.match(workflow, /always\(\)/);
  assert.match(workflow, /supabase\/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1/);
  assert.match(workflow, /version: 2\.105\.0/);
  assert.doesNotMatch(workflow, /supabase db push|--include-all/);
  assert.doesNotMatch(workflow, /functions deploy tournament-live-clock/);
});

test("workflow binds rollout to Draft PR 912 and scopes credentials to smoke steps", () => {
  const parsed = YAML.parse(workflow);
  const job = parsed.jobs.canary;
  assert.doesNotMatch(String(job.if), /refs\/heads\/main/);
  assert.match(String(job.if), /pull_request\.number == 912/);
  assert.match(String(job.if), /pull_request\.draft == true/);
  assert.match(String(job.if), /pull_request\.base\.ref == 'main'/);
  assert.equal(job.env.SUPABASE_ANON_KEY, undefined);
  assert.equal(job.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  const byName = new Map(job.steps.filter((step) => step.name).map((step) => [step.name, step]));
  for (const name of [
    "Run direct RPC behavior smoke before Edge deploy",
    "Run targeted Edge chip CAS canary and exact cleanup",
    "Validate canary context and execute isolated API matrix",
  ]) {
    assert.ok(byName.get(name)?.env?.SUPABASE_ANON_KEY);
    assert.ok(byName.get(name)?.env?.SUPABASE_SERVICE_ROLE_KEY);
  }
  for (const name of [
    "Install Supabase CLI for exact draw deployment",
    "Deploy exact tournament-live-draw with preserved JWT posture",
  ]) {
    assert.equal(byName.get(name)?.env?.SUPABASE_SERVICE_ROLE_KEY, undefined);
  }
  assert.match(workflow, /merge-base --is-ancestor eb9d49bde25cecac92dd1f48985825e189a5a122 origin\/main/);
});

test("Edge metadata requires ACTIVE verify_jwt=false and version increase", () => {
  assert.match(edgeMetadata, /payload\?\.verify_jwt !== false/);
  assert.match(edgeMetadata, /edge_version_not_incremented/);
  assert.match(edgeMetadata, /ROLLBACK_POST/);
  assert.match(edgeMetadata, /state\?\.deployed \?\? state\?\.pre/);
  assert.match(edgeMetadata, /JSON\.stringify\(\{ pre: state\.pre, deployed: current \}\)/);
  assert.doesNotMatch(edgeMetadata, /console\.(log|error)\([^\n]*accessToken/);
});
