import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIRMATION,
  MIGRATION_PATH,
  MIGRATION_SHA256,
  PROJECT_REF,
  REVIEWED_BODY_HASHES,
  applyExactMigration,
  contractProblems,
  extractFunctionBody,
  managementQuery,
  postApplyProblems,
  preApplyDecision,
  predecessorProblems,
  validateMigration,
} from "./apply-floor-clock-control.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vinPokerRoot = resolve(scriptDirectory, "..", "..");
const repositoryRoot = resolve(vinPokerRoot, "..");
const migration = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
const workflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/floor-clock-control-apply.yml"),
  "utf8",
);
const validationWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/deployment-control-plane-validation.yml"),
  "utf8",
);

test("exact reviewed clock migration passes the immutable safety contract", () => {
  assert.equal(MIGRATION_SHA256.length, 64);
  assert.deepEqual(validateMigration(migration), []);
  assert.match(extractFunctionBody(migration, "floor_control_tournament_clock"), /stale_clock_state/);
  assert.notEqual(REVIEWED_BODY_HASHES.post.start, REVIEWED_BODY_HASHES.predecessor.start);
  assert.notEqual(REVIEWED_BODY_HASHES.post.get, REVIEWED_BODY_HASHES.predecessor.get);
});

test("migration validation rejects content drift and top-level destructive SQL", () => {
  assert.match(validateMigration(`${migration}\nDROP TABLE public.tournaments;`).join(" "), /checksum mismatch/);
  assert.match(validateMigration(`${migration}\nDROP TABLE public.tournaments;`).join(" "), /destructive DDL/);
});

test("live contract verification is fail-closed for ACL or overload drift", () => {
  const complete = {
    start_exists: true,
    get_exists: true,
    control_exists: true,
    start_overloads: 1,
    get_overloads: 1,
    control_overloads: 1,
    start_security_definer: true,
    get_security_definer: false,
    control_security_definer: true,
    start_owner: "postgres",
    get_owner: "postgres",
    control_owner: "postgres",
    start_argument_names: ["p_tournament_id"],
    get_argument_names: ["p_tournament_id"],
    control_argument_names: [
      "p_tournament_id",
      "p_action",
      "p_delta_seconds",
      "p_expected_control_revision",
    ],
    start_argument_types: "uuid",
    get_argument_types: "uuid",
    control_argument_types: "uuid, text, integer, text",
    start_argument_defaults: 0,
    get_argument_defaults: 0,
    control_argument_defaults: 2,
    start_return_type: "jsonb",
    get_return_type: "jsonb",
    control_return_type: "jsonb",
    start_language: "plpgsql",
    get_language: "plpgsql",
    control_language: "plpgsql",
    start_search_path: true,
    control_search_path: true,
    start_auth_uid: true,
    control_auth_uid: true,
    control_owner_scope: true,
    control_cashier_scope: true,
    control_floor_scope: true,
    start_floor_scope: true,
    get_control_revision: true,
    start_body_contract: true,
    get_body_contract: true,
    control_body_contract: true,
    start_authenticated_execute: true,
    get_authenticated_execute: true,
    get_anon_execute: true,
    get_service_role_execute: true,
    control_authenticated_execute: true,
    start_anon_execute: false,
    start_service_role_execute: false,
    control_anon_execute: false,
    control_service_role_execute: false,
    start_public_execute: false,
    get_public_execute: false,
    control_public_execute: false,
    start_execute_grantees: ["authenticated"],
    get_execute_grantees: ["anon", "authenticated", "service_role"],
    control_execute_grantees: ["authenticated"],
    start_hash: REVIEWED_BODY_HASHES.post.start,
    get_hash: REVIEWED_BODY_HASHES.post.get,
    control_hash: REVIEWED_BODY_HASHES.post.control,
    tournaments_acl_hash: "4".repeat(32),
    authenticated_tournaments_update: false,
    migration_registered: false,
  };
  assert.deepEqual(contractProblems(complete), []);
  assert.match(contractProblems({ ...complete, control_overloads: 2 }).join(" "), /control_overloads/);
  assert.match(contractProblems({ ...complete, control_anon_execute: true }).join(" "), /control_anon_execute/);
  assert.match(contractProblems({ ...complete, start_service_role_execute: true }).join(" "), /start_service_role_execute/);
  assert.match(contractProblems({ ...complete, get_security_definer: true }).join(" "), /get_security_definer/);
  assert.match(contractProblems({ ...complete, get_public_execute: true }).join(" "), /get_public_execute/);
  assert.match(contractProblems({ ...complete, get_service_role_execute: false }).join(" "), /get_service_role_execute/);
  assert.match(contractProblems({ ...complete, control_hash: "wrong" }).join(" "), /control_hash/);
  assert.match(contractProblems({ ...complete, start_owner: "untrusted" }).join(" "), /start_owner/);
  assert.match(
    contractProblems({ ...complete, control_argument_names: ["renamed"] }).join(" "),
    /control argument names/,
  );
  assert.match(contractProblems({ ...complete, get_return_type: "text" }).join(" "), /get return type/);
  assert.match(contractProblems({ ...complete, start_language: "sql" }).join(" "), /start language/);
  assert.match(
    contractProblems({ ...complete, control_execute_grantees: ["authenticated", "service_role"] }).join(" "),
    /control_execute_grantees/,
  );

  assert.equal(preApplyDecision(complete).action, "skip");
  assert.equal(preApplyDecision(complete).reason, "exact_post_unregistered");
  assert.equal(preApplyDecision({ ...complete, migration_registered: true }).action, "skip");
  assert.equal(
    preApplyDecision({ ...complete, migration_registered: true, control_anon_execute: true }).action,
    "block",
  );

  const predecessor = {
    ...complete,
    control_exists: false,
    control_overloads: 0,
    control_security_definer: false,
    control_owner: "",
    control_argument_names: [],
    control_argument_types: "",
    control_argument_defaults: 0,
    control_return_type: "",
    control_language: "",
    control_search_path: false,
    control_auth_uid: false,
    control_owner_scope: false,
    control_cashier_scope: false,
    control_floor_scope: false,
    get_control_revision: false,
    get_body_contract: false,
    control_body_contract: false,
    get_public_execute: true,
    control_authenticated_execute: false,
    get_execute_grantees: ["PUBLIC", "anon", "authenticated"],
    control_execute_grantees: [],
    start_hash: REVIEWED_BODY_HASHES.predecessor.start,
    get_hash: REVIEWED_BODY_HASHES.predecessor.get,
    control_hash: "",
  };
  assert.deepEqual(predecessorProblems(predecessor), []);
  assert.equal(preApplyDecision(predecessor).action, "apply");
  assert.equal(preApplyDecision(predecessor).reason, "exact_known_predecessor");
  assert.equal(
    preApplyDecision({ ...predecessor, get_hash: "9".repeat(32) }).reason,
    "unknown_live_drift",
  );
  assert.equal(
    preApplyDecision({ ...predecessor, start_service_role_execute: true }).reason,
    "unknown_live_drift",
  );
  assert.equal(
    preApplyDecision({ ...predecessor, control_exists: true }).action,
    "block",
  );

  assert.deepEqual(postApplyProblems(predecessor, complete), []);
  assert.match(postApplyProblems(predecessor, { ...complete, control_owner: "untrusted" }).join(" "), /control_owner/);
  assert.match(
    postApplyProblems(predecessor, { ...complete, tournaments_acl_hash: "5".repeat(32) }).join(" "),
    /tournaments table ACL changed/,
  );
});

test("Management API transport uses only the approved project and never places credentials in the URL", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => [{ ok: true }] };
  };
  await managementQuery({
    projectRef: PROJECT_REF,
    token: "test-token-not-logged",
    query: "select true as ok",
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`);
  assert.doesNotMatch(calls[0].url, /test-token-not-logged/);
  assert.equal(JSON.parse(calls[0].init.body).query, "select true as ok");
});

test("mutation transport ambiguity is classified as outcome unknown", async () => {
  await assert.rejects(
    applyExactMigration(
      { projectRef: PROJECT_REF, token: "test-token-not-logged" },
      "BEGIN; SELECT true; COMMIT;",
      async () => {
        throw new Error("socket closed after commit");
      },
    ),
    /APPLY_OUTCOME_UNKNOWN.*read-only preflight.*do not infer rollback/,
  );
});

test("workflow is manual-only, exact-SHA, protected and contains no broad deploy path", () => {
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request):/m);
  assert.match(workflow, /validate-critical-environment:/);
  assert.match(workflow, /any\(\.type == "required_reviewers"/);
  assert.match(workflow, /needs:\s*validate-critical-environment/);
  assert.match(workflow, /environment:\s*dealer-swing-production-critical/);
  assert.match(workflow, /ref: \$\{\{ inputs\.commit_sha \}\}/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, new RegExp(CONFIRMATION));
  assert.match(workflow, /secrets\.SUPABASEACCESSTOKEN/);
  assert.match(workflow, /secrets\.SUPABASE_PROJECT_REF/);
  assert.doesNotMatch(workflow, /supabase\s+db\s+(?:push|reset)/i);
  assert.doesNotMatch(workflow, /supabase\s+functions\s+deploy/i);
  assert.doesNotMatch(workflow, /vercel\s+(?:--prod|deploy)/i);
  assert.doesNotMatch(workflow, /schema_migrations/i);
  assert.match(validationWorkflow, /\.github\/workflows\/floor-clock-control-apply\.yml/);
});
