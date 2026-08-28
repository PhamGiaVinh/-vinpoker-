import assert from "node:assert/strict";
import test from "node:test";
import {
  safeStatementGateState,
  transitionDecision,
} from "./set-dealer-payroll-statement-hsop-uat.mjs";

function gateState(overrides = {}) {
  return {
    master_enabled: false,
    all_clubs_enabled: false,
    allowlist_count: 0,
    hsop_allowed: false,
    hsop_only: false,
    ...overrides,
  };
}

test("enables statement rollout only from dark defaults", () => {
  assert.deepEqual(transitionDecision("enable_hsop", gateState()), { action: "enable", reason: "dark_defaults" });
});

test("does not broaden an already-HSOP statement rollout", () => {
  const state = gateState({ master_enabled: true, allowlist_count: 1, hsop_allowed: true, hsop_only: true });
  assert.deepEqual(transitionDecision("enable_hsop", state), { action: "skip", reason: "hsop_already_enabled" });
  assert.deepEqual(transitionDecision("disable_hsop", state), { action: "disable", reason: "hsop_scope_confirmed" });
});

test("refuses broad or unknown statement rollout state", () => {
  assert.deepEqual(
    transitionDecision("enable_hsop", gateState({ all_clubs_enabled: true })),
    { action: "block", reason: "unexpected_statement_runtime_gate_state" },
  );
  assert.deepEqual(
    transitionDecision("disable_hsop", gateState({ master_enabled: true, allowlist_count: 2 })),
    { action: "block", reason: "refusing_to_change_broad_or_unknown_scope" },
  );
});

test("preflight never mutates and safe state contains no raw identifiers", () => {
  const output = safeStatementGateState({ ...gateState(), club_id: "not-returned" });
  assert.deepEqual(transitionDecision("preflight", output), { action: "hold", reason: "read_only" });
  assert.equal(JSON.stringify(output).includes("not-returned"), false);
});

test("disables only the exact HSOP state", () => {
  assert.deepEqual(
    transitionDecision("disable_hsop", gateState({ master_enabled: true, allowlist_count: 1, hsop_allowed: true, hsop_only: true })),
    { action: "disable", reason: "hsop_scope_confirmed" },
  );
  assert.deepEqual(transitionDecision("disable_hsop", gateState()), { action: "skip", reason: "already_disabled" });
});
