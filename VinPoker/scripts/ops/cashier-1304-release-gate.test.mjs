import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "./cashier-1304-release-gate.mjs";

const baseHistory = [
  { version: "20270115000003", name: "cashier_tour_money_v1" },
  { version: "20270115000004", name: "floor_free_sit_v1" },
  { version: "20270115000005", name: "tracker_dealer_floor_operational_alerts" },
];
const priorState = {
  function_md5: "b3c619f7cfb4c28580a4beada0c273e8",
  anon_execute: false,
  authenticated_execute: true,
};
const appliedState = {
  ...priorState,
  function_md5: "new",
  verified_payment_guard: true,
  waiting_state_guard: true,
  floor_guard: true,
  active_seat_guard: true,
};
const appliedHistory = [
  ...baseHistory,
  { version: "20270115000011", name: "cashier_refund_without_floor_clearance" },
];

test("preflight allows only the old function and absent migration 11", () => {
  assert.equal(classify(baseHistory, priorState, "preflight"), "apply");
});

test("preflight routes an exact existing migration 11 to postcheck", () => {
  assert.equal(classify(appliedHistory, appliedState, "preflight"), "postcheck");
});

test("postcheck requires the exact ledger and function guards", () => {
  assert.equal(classify(appliedHistory, appliedState, "postcheck"), "complete");
  assert.throws(() => classify(appliedHistory, { ...appliedState, waiting_state_guard: false }, "postcheck"));
});

test("versions 06 through 10 always fail closed", () => {
  assert.throws(() => classify([
    ...baseHistory,
    { version: "20270115000010", name: "unexpected" },
  ], priorState, "preflight"));
});
