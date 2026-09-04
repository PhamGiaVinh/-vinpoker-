import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyState,
  CONFIRMATION,
  DISABLE_ROYAL_SQL,
  REPAIR_STORED_CONFLICT_SQL,
  run,
  safeState,
  STATE_SQL,
} from "./apply-sepay-scope-q0.mjs";
import {
  EXPECTED_ACCOUNT_FINGERPRINT,
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  sourcePolicyProblems,
} from "./sepay-scope-q0-policy.mjs";

const vinPokerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const darkSourceRoot = mkdtempSync(join(tmpdir(), "sepay-q0-dark-source-"));
mkdirSync(resolve(darkSourceRoot, "supabase/pending-migrations"), { recursive: true });
mkdirSync(resolve(darkSourceRoot, "src/lib"), { recursive: true });
copyFileSync(resolve(vinPokerRoot, MIGRATION_PATH), resolve(darkSourceRoot, MIGRATION_PATH));
writeFileSync(resolve(darkSourceRoot, "src/lib/featureFlags.ts"), "opsQuantDataHealthQ0: false\n", "utf8");
after(() => rmSync(darkSourceRoot, { recursive: true, force: true }));
const credentials = {
  SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
  SUPABASE_ACCESS_TOKEN: "test-token",
};

function state(overrides = {}) {
  return {
    center_club_count: 1,
    royal_club_count: 1,
    center_active_mapping_count: 1,
    center_account_fingerprint: EXPECTED_ACCOUNT_FINGERPRINT,
    royal_replacement_candidate_count: 0,
    center_active_config_count: 1,
    royal_active_conflict_count: 1,
    royal_disabled_conflict_count: 0,
    royal_api_vault_pointer_count: 1,
    third_club_active_claim_count: 0,
    null_stored_club_count: 102,
    repairable_stored_conflict_count: 1,
    total_stored_conflict_count: 1,
    settlement_club_conflict_count: 0,
    resolver_overloads: 0,
    pace_overloads: 0,
    sepay_overloads: 0,
    pace_authenticated_execute: false,
    sepay_authenticated_execute: false,
    pace_anon_execute: false,
    sepay_anon_execute: false,
    resolver_authenticated_execute: false,
    resolver_service_role_execute: false,
    ...overrides,
  };
}

const history = (applied = false) => applied ? [{ version: MIGRATION_VERSION, name: MIGRATION_NAME }] : [];

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("source policy pins Q0 migration and separately enforces the apply-time dark flag", () => {
  assert.deepEqual(sourcePolicyProblems(vinPokerRoot, { requireDarkFlag: false }), []);
  assert.deepEqual(sourcePolicyProblems(vinPokerRoot), ["Q0 source flag must remain false during DB apply"]);
  assert.deepEqual(sourcePolicyProblems(darkSourceRoot), []);
  assert.equal(MIGRATION_PATH, `supabase/pending-migrations/${MIGRATION_NAME}.sql`);
});

test("state machine permits only disable, exact conflict repair, Q0 apply, then complete", () => {
  assert.equal(classifyState(state()).action, "disable_royal");
  assert.equal(classifyState(state({ royal_active_conflict_count: 0, royal_disabled_conflict_count: 1 })).action, "repair_stored_conflict");
  assert.equal(classifyState(state({
    royal_active_conflict_count: 0,
    royal_disabled_conflict_count: 1,
    repairable_stored_conflict_count: 0,
    total_stored_conflict_count: 0,
  })).action, "apply_q0");
  assert.equal(classifyState(state({
    royal_active_conflict_count: 0,
    royal_disabled_conflict_count: 1,
    repairable_stored_conflict_count: 0,
    total_stored_conflict_count: 0,
    resolver_overloads: 1,
    pace_overloads: 1,
    sepay_overloads: 1,
    pace_authenticated_execute: true,
    sepay_authenticated_execute: true,
  }), history(true)).action, "complete");
});

test("state machine blocks candidates, mixed conflicts, ACL drift and fingerprint drift", () => {
  for (const bad of [
    { royal_replacement_candidate_count: 1 },
    { total_stored_conflict_count: 2, repairable_stored_conflict_count: 1 },
    { resolver_overloads: 1 },
    { center_account_fingerprint: "000000000000" },
    { settlement_club_conflict_count: 1 },
    { resolver_overloads: 1, pace_overloads: 1, sepay_overloads: 1 },
  ]) assert.equal(classifyState(state(bad)).action, "block");
});

test("read-only preflight emits no write request and safe state exposes no account", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) return jsonResponse([state()]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(history());
    throw new Error("unexpected request");
  };
  const result = await run(["--preflight", "--source-root", darkSourceRoot], credentials, fetchImpl);
  assert.equal(result.applied, false);
  assert.equal(calls.some((call) => call.url.endsWith("/database/query") || call.options.method === "POST" && call.url.endsWith("/database/migrations")), false);
  assert.equal(JSON.stringify(safeState(state())).includes("account_number"), false);
  assert.equal(STATE_SQL.includes("account_holder"), false);
});

test("rolled-out source permits only a completed live no-op", async () => {
  const calls = [];
  const completeState = state({
    royal_active_conflict_count: 0,
    royal_disabled_conflict_count: 1,
    repairable_stored_conflict_count: 0,
    total_stored_conflict_count: 0,
    resolver_overloads: 1,
    pace_overloads: 1,
    sepay_overloads: 1,
    pace_authenticated_execute: true,
    sepay_authenticated_execute: true,
  });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) return jsonResponse([completeState]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(history(true));
    throw new Error(`unexpected write ${options.method}`);
  };
  const result = await run(["--preflight"], credentials, fetchImpl);
  assert.equal(result.applied, false);
  assert.equal(result.decision.action, "complete");
  assert.equal(calls.some((call) => call.url.endsWith("/database/query")), false);
});

test("rolled-out source blocks an incomplete live state before any write", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) return jsonResponse([state()]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(history());
    throw new Error(`unexpected write ${options.method}`);
  };
  await assert.rejects(
    run(["--apply"], { ...credentials, CONFIRM_APPLY_SEPAY_SCOPE_Q0: CONFIRMATION }, fetchImpl),
    /Q0 source flag must remain false during DB apply/u,
  );
  assert.equal(calls.some((call) => call.url.endsWith("/database/query")), false);
});

test("apply performs three separately acknowledged steps and supports deterministic resume", async () => {
  const calls = [];
  let phase = 0;
  const states = [
    state(),
    state({ royal_active_conflict_count: 0, royal_disabled_conflict_count: 1 }),
    state({ royal_active_conflict_count: 0, royal_disabled_conflict_count: 1, repairable_stored_conflict_count: 0, total_stored_conflict_count: 0 }),
    state({
      royal_active_conflict_count: 0,
      royal_disabled_conflict_count: 1,
      repairable_stored_conflict_count: 0,
      total_stored_conflict_count: 0,
      resolver_overloads: 1,
      pace_overloads: 1,
      sepay_overloads: 1,
      pace_authenticated_execute: true,
      sepay_authenticated_execute: true,
    }),
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/query/read-only")) return jsonResponse([states[phase]]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse(history(false));
    if (url.endsWith("/database/query") && options.method === "POST") {
      phase += 1;
      return jsonResponse([]);
    }
    throw new Error(`unexpected request ${url}`);
  };
  const result = await run(
    ["--apply", "--source-root", darkSourceRoot],
    { ...credentials, CONFIRM_APPLY_SEPAY_SCOPE_Q0: CONFIRMATION },
    fetchImpl,
  );
  assert.equal(result.applied, true);
  assert.equal(phase, 3);
  assert.equal(calls.filter((call) => call.url.endsWith("/database/query") && call.options.method === "POST").length, 3);
  assert.equal(calls.filter((call) => call.url.endsWith("/database/migrations") && call.options.method === "POST").length, 0);
});

test("guarded SQL changes only Royal activation or the exact conflict club scope", () => {
  assert.match(DISABLE_ROYAL_SQL, /set is_active=false/iu);
  assert.match(DISABLE_ROYAL_SQL, /Q0_ALREADY_PRESENT_BEFORE_SCOPE_REPAIR/u);
  assert.match(DISABLE_ROYAL_SQL, /STORED_CONFLICT_COUNT_DRIFT/u);
  assert.doesNotMatch(DISABLE_ROYAL_SQL, /delete|truncate|set\s+master_account_number/iu);
  assert.match(REPAIR_STORED_CONFLICT_SQL, /set club_id='22222222-2222-2222-2222-222222222222'/u);
  assert.match(REPAIR_STORED_CONFLICT_SQL, /Q0_ALREADY_PRESENT_BEFORE_SCOPE_REPAIR/u);
  assert.match(REPAIR_STORED_CONFLICT_SQL, /not exists \(select 1 from public\.payment_settlements/iu);
  assert.doesNotMatch(REPAIR_STORED_CONFLICT_SQL, /set amount|set status|delete|truncate/iu);
});

test("missing exact confirmation blocks before the first write", async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/database/query/read-only")) return jsonResponse([state()]);
    if (url.endsWith("/database/migrations") && options.method === "GET") return jsonResponse([]);
    throw new Error(`unexpected write ${options.method}`);
  };
  await assert.rejects(
    run(["--apply", "--source-root", darkSourceRoot], credentials, fetchImpl),
    /Exact apply confirmation is missing/u,
  );
});
