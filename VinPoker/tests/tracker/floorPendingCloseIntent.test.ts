import { beforeEach, describe, expect, it } from "vitest";
import { clearPendingFloorClose, readPendingFloorClose, savePendingFloorClose, type PendingFloorClose } from "@/lib/floorPendingCloseIntent";

const pending = (): PendingFloorClose => ({ scope: "actor:tour:table", tournamentId: "tour", tournamentTableId: "table",
  tableSessionId: "session", expectedRevision: 7, controlEpoch: 2, activeSeatCount: 1,
  requestId: "request-1", drawMode: "redraw_balanced", plan: {
    planHash: "hash", complete: true, sourceTournamentTableId: "table", sourceTableNumber: 4, expectedRevision: 7,
    moves: [{ entryId: "entry", playerName: "TEST", sourceSeatNumber: 1,
      destinationTournamentTableId: "destination", destinationTableNumber: 5, destinationSeatNumber: 2, transferMode: "immediate" }], blockers: [],
  } });

describe("pending floor close recovery boundary", () => {
  beforeEach(() => sessionStorage.clear());
  it("roundtrips complete frozen break or empty close and isolates scopes", () => {
    savePendingFloorClose(pending());
    expect(readPendingFloorClose(pending().scope)).toEqual(pending());
    expect(readPendingFloorClose("other-actor:tour:table")).toBeNull();
    expect(readPendingFloorClose("actor:other-tour:table")).toBeNull();
    expect(readPendingFloorClose("actor:tour:other-table")).toBeNull();
    clearPendingFloorClose(pending());
    const empty = { ...pending(), activeSeatCount: 0, plan: undefined };
    savePendingFloorClose(empty);
    expect(readPendingFloorClose(empty.scope)).toEqual(empty);
  });
  it("retains identical retries and refuses another key or payload", () => {
    savePendingFloorClose(pending());
    expect(() => savePendingFloorClose(pending())).not.toThrow();
    for (const replacement of [{ ...pending(), requestId: "new" }, { ...pending(), expectedRevision: 8 },
      { ...pending(), drawMode: "fill_lowest_table" as const }, { ...pending(), tableSessionId: "new-session" }]) {
      expect(() => savePendingFloorClose(replacement)).toThrow("chưa xác minh");
    }
    expect(readPendingFloorClose(pending().scope)).toEqual(pending());
  });
  it("only removes the reconciled key", () => {
    savePendingFloorClose(pending());
    expect(() => clearPendingFloorClose({ ...pending(), requestId: "wrong" })).toThrow();
    expect(readPendingFloorClose(pending().scope)).toEqual(pending());
    clearPendingFloorClose(pending());
    expect(readPendingFloorClose(pending().scope)).toBeNull();
  });
  it("never discards corrupt, incomplete or mismatched journals", () => {
    const storageKey = `vp:floor-close-intent:v1:${encodeURIComponent(pending().scope)}`;
    for (const value of ["{bad", JSON.stringify({ ...pending(), scope: "other" }),
      JSON.stringify({ ...pending(), expectedRevision: -1 }), JSON.stringify({ ...pending(), activeSeatCount: 0 }),
      JSON.stringify({ ...pending(), plan: { ...pending().plan, complete: false } }),
      JSON.stringify({ ...pending(), plan: { ...pending().plan, expectedRevision: 8 } }),
      JSON.stringify({ ...pending(), plan: { ...pending().plan, moves: [] } })]) {
      sessionStorage.setItem(storageKey, value);
      expect(() => readPendingFloorClose(pending().scope)).toThrow();
      expect(sessionStorage.getItem(storageKey)).toBe(value);
    }
  });
});
