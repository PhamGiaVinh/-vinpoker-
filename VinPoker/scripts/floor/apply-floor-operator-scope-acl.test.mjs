import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIRMATION,
  MIGRATION_PATH,
  MIGRATION_SHA256,
  REVIEWED_SCOPE_BODY_HASH,
  contractProblems,
  postApplyProblems,
  preApplyDecision,
  validateMigration,
} from "./apply-floor-operator-scope-acl.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vinPokerRoot = resolve(scriptDirectory, "..", "..");
const repositoryRoot = resolve(vinPokerRoot, "..");
const migration = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
const workflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/floor-operator-scope-acl-apply.yml"),
  "utf8",
);
const validationWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/deployment-control-plane-validation.yml"),
  "utf8",
);

function exactPostState() {
  return {
    scope_exists: true,
    scope_overloads: 1,
    scope_owner: "postgres",
    scope_hash: REVIEWED_SCOPE_BODY_HASH,
    scope_security_definer: true,
    scope_search_path: true,
    scope_stable: true,
    scope_zero_inputs: true,
    scope_returns_set: true,
    scope_result:
      "TABLE(club_id uuid, can_owner boolean, can_cashier boolean, can_floor boolean)",
    scope_language: "sql",
    authenticated_execute: true,
    anon_execute: false,
    service_role_execute: false,
    public_execute: false,
    execute_grantees: ["authenticated"],
    migration_registered: false,
    prerequisites_ok: true,
  };
}

test("exact operator-scope ACL migration passes the immutable policy", () => {
  assert.equal(MIGRATION_SHA256.length, 64);
  assert.deepEqual(validateMigration(migration), []);
  assert.equal(REVIEWED_SCOPE_BODY_HASH.length, 32);
  assert.match(migration, /FROM PUBLIC, anon, service_role;/);
  assert.doesNotMatch(migration, /TO\s+service_role\s*;/i);
});

test("migration policy rejects drift and non-ACL mutation", () => {
  const changed = `${migration}\nALTER TABLE public.clubs ADD COLUMN unsafe text;`;
  assert.match(validateMigration(changed).join(" "), /checksum mismatch/);
  assert.match(validateMigration(changed).join(" "), /non-ACL mutation/);
});

test("live state accepts only exact predecessor or exact post ACL", () => {
  const post = exactPostState();
  assert.deepEqual(contractProblems(post, "post"), []);
  assert.equal(preApplyDecision(post).action, "skip");

  const pre = {
    ...post,
    service_role_execute: true,
    execute_grantees: ["authenticated", "service_role"],
  };
  assert.deepEqual(contractProblems(pre, "pre"), []);
  assert.equal(preApplyDecision(pre).action, "apply");
  assert.equal(preApplyDecision(pre).reason, "exact_known_predecessor");

  assert.equal(preApplyDecision({ ...pre, scope_hash: "0".repeat(32) }).action, "block");
  assert.equal(preApplyDecision({ ...pre, public_execute: true }).action, "block");
  assert.equal(
    preApplyDecision({ ...pre, execute_grantees: ["PUBLIC", "authenticated", "service_role"] }).action,
    "block",
  );
  assert.equal(
    preApplyDecision({ ...pre, migration_registered: true }).reason,
    "registered_contract_drift",
  );
  assert.deepEqual(postApplyProblems(pre, post), []);
  assert.match(
    postApplyProblems(pre, { ...post, scope_owner: "untrusted" }).join(" "),
    /scope_owner/,
  );
});

test("workflow is manual-only, protected, exact-SHA, and contains no broad deploy path", () => {
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request):/m);
  assert.match(workflow, /validate-critical-environment:/);
  assert.match(workflow, /any\(\.type == "required_reviewers"/);
  assert.match(workflow, /needs:\s*validate-critical-environment/);
  assert.match(workflow, /environment:\s*dealer-swing-production-critical/);
  assert.match(workflow, /timeout-minutes:\s*20/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(workflow, /ref: \$\{\{ inputs\.commit_sha \}\}/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, new RegExp(CONFIRMATION));
  assert.doesNotMatch(workflow, /supabase\s+db\s+(?:push|reset)/i);
  assert.doesNotMatch(workflow, /supabase\s+functions\s+deploy/i);
  assert.doesNotMatch(workflow, /vercel\s+(?:--prod|deploy)/i);
  assert.doesNotMatch(workflow, /schema_migrations/i);
  assert.match(validationWorkflow, /floor-operator-scope-acl-apply\.yml/);
  assert.match(validationWorkflow, /apply-floor-operator-scope-acl\.test\.mjs/);
});
