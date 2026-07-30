import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TRACKER_IDEMPOTENT_MUTATION_OPERATIONS,
  TRACKER_OPS_FAILURE_CODES,
  TRACKER_OPS_ROLE_CAPABILITIES,
  TRACKER_READINESS_BLOCKER_CODES,
  TRACKER_READINESS_WARNING_CODES,
  TRACKER_STACK_CORRECTION_REASON_CODES,
  type TrackerOpsReceiptV2,
} from "@/lib/tracker-unified-ops/contracts";
import {
  TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE,
  TRACKER_IDENTITY_ERROR_FIXTURES,
  TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE,
  TRACKER_READY_CONTEXT_FIXTURE,
  TRACKER_READINESS_BLOCKED_FAILURE_FIXTURES,
  TRACKER_TABLE_LIST_FIXTURE,
  TRACKER_UNIFIED_FIXTURE_IDS,
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

  it("keeps readiness blockers out of generic mutation failure codes", () => {
    const mutationFailures = new Set<string>(TRACKER_OPS_FAILURE_CODES);
    expect(mutationFailures.has("readiness_blocked")).toBe(false);
    expect(mutationFailures.has("tracker_mode_required")).toBe(false);
    expect(mutationFailures.has("tournament_break_active")).toBe(false);
    expect(mutationFailures.has("not_enough_players")).toBe(false);
    expect(TRACKER_OPS_FAILURE_CODES).toContain("idempotency_mismatch");
    expect(TRACKER_OPS_FAILURE_CODES).toContain("invalid_button_seat");
  });

  it("returns machine-readable readiness failures for manual mode and break", () => {
    expect(TRACKER_READINESS_BLOCKED_FAILURE_FIXTURES.manualMode).toMatchObject({
      ok: false,
      error: "readiness_blocked",
      context_version: TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE.context_version,
      readiness: {
        state: "blocked",
      },
    });
    expect(
      TRACKER_READINESS_BLOCKED_FAILURE_FIXTURES.manualMode.readiness.blockers,
    ).toContainEqual(
      expect.objectContaining({ code: "tracker_mode_required" }),
    );
    expect(TRACKER_READINESS_BLOCKED_FAILURE_FIXTURES.breakActive).toMatchObject({
      ok: false,
      error: "readiness_blocked",
      context_version: "ctx_v1_fixture_break_56c112",
      readiness: {
        state: "blocked",
      },
    });
    expect(
      TRACKER_READINESS_BLOCKED_FAILURE_FIXTURES.breakActive.readiness.blockers,
    ).toContainEqual(
      expect.objectContaining({ code: "tournament_break_active" }),
    );
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
    expect(TRACKER_OPS_ROLE_CAPABILITIES.chipmaster).not.toContain("read_context");
    expect(TRACKER_OPS_ROLE_CAPABILITIES.tracker).toContain("start_hand");
  });

  it("locks idempotency to named mutation operations and replayable receipts", () => {
    expect(TRACKER_IDEMPOTENT_MUTATION_OPERATIONS).toEqual([
      "start_hand",
      "correct_stack",
      "ack_stack_correction",
      "void_hand",
    ]);
    const receipt = {
      receipt_id: "receipt-1",
      operation: "start_hand",
      actor_user_id: TRACKER_UNIFIED_FIXTURE_IDS.trackerUser,
      tournament_id: TRACKER_UNIFIED_FIXTURE_IDS.tournament,
      idempotency_key: "start-key-1",
      request_hash: "sha256-request",
      replayed: true,
    } as const satisfies TrackerOpsReceiptV2;
    expect(receipt).toMatchObject({
      operation: "start_hand",
      replayed: true,
      actor_user_id: TRACKER_UNIFIED_FIXTURE_IDS.trackerUser,
    });
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
    expect(TRACKER_CONTEXT_HASH_VECTOR_V1_CANONICAL_JSON).toContain(
      '"lock_version":7',
    );
    expect(TRACKER_CONTEXT_HASH_VECTOR_V1_CANONICAL_JSON).not.toContain(
      "locked_at",
    );
  });
});
