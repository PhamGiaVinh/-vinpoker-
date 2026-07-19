import { describe, expect, it } from "vitest";
import {
  isCurrentMassOpenRequest,
  readOpenOperationProgress,
  resolveMassOpenGate,
  shouldContinueOpenOperation,
} from "./dealerMassOpen";

describe("dealer mass-open client contract", () => {
  it("fails closed except for a known pre-migration missing RPC", () => {
    expect(resolveMassOpenGate({ allowed: true }, null)).toBe("enabled");
    expect(resolveMassOpenGate({ allowed: false }, null)).toBe("disabled");
    expect(resolveMassOpenGate(null, { code: "42501", message: "denied" })).toBe("disabled");
    expect(resolveMassOpenGate(null, {
      code: "PGRST202",
      message: "get_dealer_mass_open_rollout missing from schema cache",
    })).toBe("legacy");
  });

  it("ignores a stale club response by request generation", () => {
    expect(isCurrentMassOpenRequest(4, 4)).toBe(true);
    expect(isCurrentMassOpenRequest(3, 4)).toBe(false);
  });

  it("continues only while assignment makes measurable progress", () => {
    const current = {
      operationId: "operation",
      requested: 30,
      assigned: 19,
      remaining: 11,
      status: "waiting_for_dealer",
    };
    const next = readOpenOperationProgress(
      { requested: 30, assigned: 25, remaining: 5, operation_status: "waiting_for_dealer" },
      "operation",
      current,
    );
    expect(shouldContinueOpenOperation(current, next, 6)).toBe(true);
    expect(shouldContinueOpenOperation(next, next, 0)).toBe(false);
  });
});
