import assert from "node:assert/strict";
import test from "node:test";
import {
  HSOP_CLUB_ID,
  safeRuntimeGateState,
  transitionDecision,
} from "./set-dealer-payroll-statement-delivery-hsop-uat.mjs";
import { receiptProblems } from "./verify-dealer-payroll-statement-delivery-receipts.mjs";

const targetSha = "a".repeat(40);

function gateState(overrides = {}) {
  return {
    statement_master_enabled: true,
    statement_all_clubs_enabled: false,
    statement_allowlist_count: 1,
    statement_hsop_allowed: true,
    delivery_master_enabled: false,
    delivery_all_clubs_enabled: false,
    delivery_allowlist_count: 0,
    delivery_hsop_only: false,
    ...overrides,
  };
}

test("enables only from dark delivery defaults after the statement gate allows HSOP", () => {
  assert.deepEqual(transitionDecision("enable_hsop", gateState()), { action: "enable", reason: "dark_defaults" });
});

test("does not broaden an already-HSOP delivery gate", () => {
  const state = gateState({
    delivery_master_enabled: true,
    delivery_allowlist_count: 1,
    delivery_hsop_only: true,
  });
  assert.deepEqual(transitionDecision("enable_hsop", state), { action: "skip", reason: "hsop_already_enabled" });
  assert.deepEqual(transitionDecision("disable_hsop", state), { action: "disable", reason: "hsop_scope_confirmed" });
});

test("refuses delivery enable when the parent statement gate does not allow HSOP", () => {
  assert.deepEqual(
    transitionDecision("enable_hsop", gateState({ statement_hsop_allowed: false })),
    { action: "block", reason: "statement_hsop_rollout_disabled" },
  );
});

test("refuses any broad or malformed delivery runtime state", () => {
  assert.deepEqual(
    transitionDecision("enable_hsop", gateState({ delivery_all_clubs_enabled: true })),
    { action: "block", reason: "unexpected_delivery_runtime_gate_state" },
  );
  assert.deepEqual(
    transitionDecision("disable_hsop", gateState({ delivery_allowlist_count: 2 })),
    { action: "block", reason: "refusing_to_change_broad_or_unknown_scope" },
  );
});

test("sanitized gate state never includes raw club identifiers", () => {
  const output = safeRuntimeGateState({
    ...gateState(),
    allowed_club_ids: [HSOP_CLUB_ID],
    other_identifier: "not-returned",
  });
  assert.equal(JSON.stringify(output).includes(HSOP_CLUB_ID), false);
  assert.equal(JSON.stringify(output).includes("other_identifier"), false);
});

test("requires exact successful receipts for the frontend and both payroll Edge functions", () => {
  const receipts = {
    frontend: { sha: targetSha },
    functions: {
      "render-payroll-statement": { sha: targetSha },
      "send-payroll-statement": { sha: targetSha },
    },
  };
  assert.deepEqual(receiptProblems(receipts, targetSha), []);
  assert.deepEqual(
    receiptProblems({ ...receipts, functions: { ...receipts.functions, "send-payroll-statement": { sha: "b".repeat(40) } } }, targetSha),
    ["send-payroll-statement receipt SHA mismatch"],
  );
});
