import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyManagedMigration,
  preApplyDecision,
  run,
} from "./apply-phone-completion-migrations.mjs";
import {
  CONFIRMATION,
  MIGRATIONS,
  createMigrationRequest,
  sourcePolicyProblems,
} from "./phone-completion-migration-policy.mjs";

const vinPokerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspaceRoot = resolve(vinPokerRoot, "..");

function exactState(phase = "none") {
  const bootstrap = phase === "bootstrap" || phase === "complete";
  const complete = phase === "complete";
  return {
    rollout_table_exists: bootstrap,
    checkin_requests_table_exists: bootstrap,
    close_requests_table_exists: complete,
    rollout_rls_enabled: bootstrap,
    checkin_requests_rls_enabled: bootstrap,
    close_requests_rls_enabled: complete,
    get_rollout_exists: bootstrap,
    checkin_exists: bootstrap,
    close_state_exists: complete,
    legacy_close_exists: true,
    guarded_close_exists: complete,
    canonical_reconcile_exists: true,
    phone_reconcile_exists: complete,
    record_checkin_exists: true,
    pool_enabled_exists: true,
    pool_bridge_exists: true,
    pool_config_enabled: true,
    pool_bridge_job_exists: true,
    get_rollout_overloads: bootstrap ? 1 : 0,
    checkin_overloads: bootstrap ? 1 : 0,
    close_overloads: complete ? 2 : 1,
    phone_reconcile_overloads: complete ? 1 : 0,
    get_rollout_authenticated_execute: bootstrap,
    get_rollout_anon_execute: false,
    checkin_authenticated_execute: bootstrap,
    checkin_anon_execute: false,
    guarded_close_authenticated_execute: complete,
    guarded_close_anon_execute: false,
    phone_reconcile_authenticated_execute: complete,
    phone_reconcile_anon_execute: false,
    get_rollout_security_definer: bootstrap,
    checkin_security_definer: bootstrap,
    guarded_close_security_definer: complete,
    phone_reconcile_security_definer: complete,
    rollout: bootstrap ? {
      master_disabled: true,
      all_clubs_disabled: true,
      allowlist_empty: true,
    } : null,
  };
}

function history(phase) {
  if (phase === "none") return [];
  if (phase === "bootstrap") return [{ version: "1", name: MIGRATIONS[0].name }];
  return MIGRATIONS.map((migration, index) => ({ version: String(index + 1), name: migration.name }));
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("locks source selection to the two reviewed phone migrations", () => {
  assert.deepEqual(sourcePolicyProblems(vinPokerRoot), []);
  assert.equal(MIGRATIONS.length, 2);
  assert.deepEqual(createMigrationRequest(MIGRATIONS[0], "select 1;"), {
    query: "select 1;",
    name: "20270102000000_operator_dealer_checkin",
  });
});

test("preflight chooses only exact absent or exact post states", () => {
  assert.equal(preApplyDecision(exactState("none"), history("none")).action, "apply_both");
  assert.equal(preApplyDecision(exactState("bootstrap"), history("bootstrap")).action, "apply_close");
  assert.equal(preApplyDecision(exactState("complete"), history("complete")).action, "skip");
  assert.equal(
    preApplyDecision({ ...exactState("none"), pool_bridge_job_exists: false }, history("none")).reason,
    "missing_prerequisite",
  );
  assert.equal(
    preApplyDecision({ ...exactState("bootstrap"), close_requests_table_exists: true }, history("none")).reason,
    "unregistered_phone_objects",
  );
});

test("runner preflights read-only then applies exactly bootstrap followed by close", async () => {
  const calls = [];
  let phase = "none";
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) {
      const query = JSON.parse(options.body).query;
      return jsonResponse([query.includes("FROM public.dealer_swing_phone_rollout")
        ? exactState(phase).rollout
        : exactState(phase)]);
    }
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(history(phase));
    if (url.endsWith("/database/migrations") && options.method === "POST") {
      const request = JSON.parse(options.body);
      if (request.name === MIGRATIONS[0].name) phase = "bootstrap";
      if (request.name === MIGRATIONS[1].name) phase = "complete";
      return jsonResponse({});
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  const env = { SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk", SUPABASE_ACCESS_TOKEN: "test-token" };

  const preflight = await run(["--preflight"], env, fetchImpl);
  assert.deepEqual(preflight.applied, []);
  assert.equal(calls.some((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations")), false);

  const applied = await run(["--apply"], {
    ...env,
    CONFIRM_APPLY_DEALER_SWING_PHONE_COMPLETION: CONFIRMATION,
  }, fetchImpl);
  assert.deepEqual(applied.applied, MIGRATIONS.map((migration) => migration.name));
  const writes = calls
    .filter((call) => call.options.method === "POST" && call.url.endsWith("/database/migrations"))
    .map((call) => JSON.parse(call.options.body).name);
  assert.deepEqual(writes, MIGRATIONS.map((migration) => migration.name));
});

test("apply endpoint is immutable and has no fallback database path", async () => {
  const calls = [];
  await applyManagedMigration(
    { projectRef: "orlesggcjamwuknxwcpk", token: "test-token" },
    MIGRATIONS[0],
    "select 1;",
    async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({});
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith("/database/migrations"), true);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), createMigrationRequest(MIGRATIONS[0], "select 1;"));
});

test("protected workflow has no db push, Edge, or frontend deployment step", () => {
  const workflow = readFileSync(resolve(workspaceRoot, ".github/workflows/dealer-swing-phone-completion-apply.yml"), "utf8");
  assert.match(workflow, /dealer-swing-production-critical/);
  assert.match(workflow, /CONFIRM_APPLY_DEALER_SWING_PHONE_COMPLETION/);
  assert.doesNotMatch(workflow, /supabase db push|functions deploy|vercel deploy/i);
});
