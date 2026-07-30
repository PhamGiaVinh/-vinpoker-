import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TRACKER_OPS_ROLE_CAPABILITIES,
  TRACKER_READINESS_BLOCKER_CODES,
  TRACKER_READINESS_WARNING_CODES,
  TRACKER_STACK_CORRECTION_REASON_CODES,
} from "@/lib/tracker-unified-ops/contracts";
import {
  TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE,
  TRACKER_IDENTITY_ERROR_FIXTURES,
  TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE,
  TRACKER_READY_CONTEXT_FIXTURE,
  TRACKER_TABLE_LIST_FIXTURE,
} from "@/lib/tracker-unified-ops/fixtures";
import {
  TRACKER_CONTEXT_HASH_VECTOR_V1_INPUT,
  TRACKER_CONTEXT_HASH_VECTOR_V1_CANONICAL_JSON,
  TRACKER_CONTEXT_HASH_VECTOR_V1_SHA256,
} from "@/lib/tracker-unified-ops/contextHashVectors";

function canonicalJsonForVector(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonForVector).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonForVector(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("Tracker Unified Ops V2 contract", () => {
  it("keeps blocker and warning codes disjoint", () => {
    const blockers = new Set<string>(TRACKER_READINESS_BLOCKER_CODES);
    expect(TRACKER_READINESS_WARNING_CODES.every((code) => !blockers.has(code))).toBe(true);
    expect(TRACKER_READINESS_WARNING_CODES).toContain("clock_paused");
    expect(TRACKER_READINESS_BLOCKER_CODES).toContain("tournament_break_active");
  });

  it("locks the narrow stack-correction reason allowlist", () => {
    expect(TRACKER_STACK_CORRECTION_REASON_CODES).toEqual([
      "physical_recount",
      "operator_entry_correction",
      "post_table_move_reconciliation",
    ]);
  });

  it("keeps Floor and ChipMaster out of the hand writer", () => {
    expect(TRACKER_OPS_ROLE_CAPABILITIES.floor).not.toContain("start_hand");
    expect(TRACKER_OPS_ROLE_CAPABILITIES.floor).not.toContain("record_hand");
    expect(TRACKER_OPS_ROLE_CAPABILITIES.chipmaster).not.toContain("correct_stack");
    expect(TRACKER_OPS_ROLE_CAPABILITIES.tracker).toContain("start_hand");
  });

  it("locks all three between-hand stack projections in the ready fixture", () => {
    for (const seat of TRACKER_READY_CONTEXT_FIXTURE.roster) {
      expect(seat.seat_stack).toBe(seat.tracker_stack);
      expect(seat.tracker_stack).toBe(seat.entry_stack);
    }
  });

  it("groups fixture tables into ready, active hand and Floor remediation", () => {
    expect(TRACKER_TABLE_LIST_FIXTURE.tables.map((table) => table.launcher_group)).toEqual([
      "ready",
      "active_hand",
      "needs_floor",
    ]);
    expect(TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE.active_hand?.allowed_action).toBe("resume");
    expect(TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.readiness.blockers[0]).toMatchObject({
      code: "tracker_mode_required",
      owner: "floor",
      remediation: "open_floor_mode",
    });
  });

  it("fails closed for unresolved legacy table identity", () => {
    expect(TRACKER_IDENTITY_ERROR_FIXTURES.notFound.error).toBe("table_not_found");
    expect(TRACKER_IDENTITY_ERROR_FIXTURES.ambiguous.error).toBe(
      "ambiguous_table_identity",
    );
  });

  it("publishes a stable cross-language SHA-256 context vector", () => {
    expect(canonicalJsonForVector(TRACKER_CONTEXT_HASH_VECTOR_V1_INPUT)).toBe(
      TRACKER_CONTEXT_HASH_VECTOR_V1_CANONICAL_JSON,
    );
    const actual = createHash("sha256")
      .update(TRACKER_CONTEXT_HASH_VECTOR_V1_CANONICAL_JSON, "utf8")
      .digest("hex");
    expect(actual).toBe(TRACKER_CONTEXT_HASH_VECTOR_V1_SHA256);
  });
});
