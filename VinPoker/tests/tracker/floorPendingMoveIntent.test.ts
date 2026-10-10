import { beforeEach, describe, expect, it } from "vitest";
import { clearPendingFloorMove, readPendingFloorMove, savePendingFloorMove, type PendingFloorMove } from "@/lib/floorPendingMoveIntent";

const pending = (): PendingFloorMove => ({ scope: "actor:tour:entry", intent: {
  entryId: "entry", fromTournamentTableId: "source", fromTableSessionId: "source-session",
  toTournamentTableId: "destination", toTableSessionId: "destination-session", toSeatNumber: 2,
  expectedSourceRevision: 7, expectedDestinationRevision: 8, expectedSourceEpoch: 3, expectedDestinationEpoch: 4,
  requestId: "request-1", reason: "Cân bàn",
}, sourceSeat: 1, stack: 20000, fromTableNumber: 1, toTableNumber: 2, meta: { name: "TEST", start_time: null } });

describe("pending floor move recovery boundary", () => {
  beforeEach(() => sessionStorage.clear());
  it("roundtrips the whole frozen intent and isolates actor/tour/entry scopes", () => {
    savePendingFloorMove(pending());
    expect(readPendingFloorMove(pending().scope)).toEqual(pending());
    expect(readPendingFloorMove("other-actor:tour:entry")).toBeNull();
    expect(readPendingFloorMove("actor:other-tour:entry")).toBeNull();
    expect(readPendingFloorMove("actor:tour:other-entry")).toBeNull();
  });
  it("allows identical retry but refuses another payload or key over an unresolved intent", () => {
    savePendingFloorMove(pending());
    expect(() => savePendingFloorMove(pending())).not.toThrow();
    for (const intent of [{ ...pending().intent, requestId: "request-2" }, { ...pending().intent, toSeatNumber: 3 }]) {
      expect(() => savePendingFloorMove({ ...pending(), intent })).toThrow("chưa xác minh");
    }
    expect(readPendingFloorMove(pending().scope)).toEqual(pending());
  });
  it("only clears the reconciled key, never a newer unresolved attempt", () => {
    savePendingFloorMove(pending());
    expect(() => clearPendingFloorMove({ ...pending(), intent: { ...pending().intent, requestId: "wrong-key" } })).toThrow();
    expect(readPendingFloorMove(pending().scope)).toEqual(pending());
    clearPendingFloorMove(pending());
    expect(readPendingFloorMove(pending().scope)).toBeNull();
  });
  it("does not silently discard corrupt or out-of-range journals", () => {
    const storageKey = `vp:floor-move-intent:v1:${encodeURIComponent(pending().scope)}`;
    for (const value of ["{invalid", JSON.stringify({ ...pending(), scope: "another-scope" }),
      JSON.stringify({ ...pending(), stack: -1 }), JSON.stringify({ ...pending(), intent: { ...pending().intent, toSeatNumber: 0 } })]) {
      sessionStorage.setItem(storageKey, value);
      expect(() => readPendingFloorMove(pending().scope)).toThrow();
      expect(sessionStorage.getItem(storageKey)).toBe(value);
    }
  });
});
