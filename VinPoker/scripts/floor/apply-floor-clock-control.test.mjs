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
  contractProblems,
  managementQuery,
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

test("exact reviewed clock migration passes the immutable safety contract", () => {
  assert.equal(MIGRATION_SHA256.length, 64);
  assert.deepEqual(validateMigration(migration), []);
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
    control_security_definer: true,
    start_search_path: true,
    control_search_path: true,
    start_auth_uid: true,
    control_auth_uid: true,
    control_owner_scope: true,
    control_cashier_scope: true,
    control_floor_scope: true,
    start_floor_scope: true,
    get_control_revision: true,
    start_authenticated_execute: true,
    control_authenticated_execute: true,
    start_anon_execute: false,
    control_anon_execute: false,
    start_public_execute: false,
    control_public_execute: false,
  };
  assert.deepEqual(contractProblems(complete), []);
  assert.match(contractProblems({ ...complete, control_overloads: 2 }).join(" "), /control_overloads/);
  assert.match(contractProblems({ ...complete, control_anon_execute: true }).join(" "), /control_anon_execute/);
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

test("workflow is manual-only, exact-SHA, protected and contains no broad deploy path", () => {
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request):/m);
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
});
