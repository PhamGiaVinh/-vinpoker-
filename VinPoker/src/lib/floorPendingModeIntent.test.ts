import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingFloorModeIntent, readPendingFloorModeIntent, savePendingFloorModeIntent,
  type PendingFloorModeIntent } from "./floorPendingModeIntent";
const intent: PendingFloorModeIntent = { scope: "actor:tour:table:session", args: {
  tournamentTableId: "table", tableSessionId: "session", controlMode: "tracker",
  expectedRevision: 3, expectedEpoch: 7, requestId: "fixed-request",
} };
beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
describe("pending mode intent journal", () => {
  it("round-trips one immutable intent and does not share it across actor/session scopes", () => {
    savePendingFloorModeIntent(intent);
    expect(readPendingFloorModeIntent(intent.scope)).toEqual(intent);
    expect(readPendingFloorModeIntent("other-actor:tour:table:session")).toBeNull();
    expect(readPendingFloorModeIntent("actor:tour:table:new-session")).toBeNull();
    clearPendingFloorModeIntent(intent);
    expect(readPendingFloorModeIntent(intent.scope)).toBeNull();
  });
  it("rejects same scope with a changed key, mode or revision", () => {
    savePendingFloorModeIntent(intent);
    for (const args of [{ ...intent.args, requestId: "new-key" },
      { ...intent.args, controlMode: "manual" as const }, { ...intent.args, expectedRevision: 4 }]) {
      expect(() => savePendingFloorModeIntent({ ...intent, args })).toThrow("Còn yêu cầu");
    }
    expect(readPendingFloorModeIntent(intent.scope)).toEqual(intent);
  });
  it("does not clear a different unresolved intent", () => {
    savePendingFloorModeIntent(intent);
    expect(() => clearPendingFloorModeIntent({ ...intent, args: { ...intent.args, requestId: "other" } })).toThrow("bị thay đổi");
    expect(readPendingFloorModeIntent(intent.scope)).toEqual(intent);
  });
  it("detects malformed and silently refused storage", () => {
    const storageKey = `vp:floor-mode-intent:v1:${encodeURIComponent(intent.scope)}`;
    sessionStorage.setItem(storageKey, JSON.stringify({ ...intent, args: { ...intent.args, expectedEpoch: -1 } }));
    expect(() => readPendingFloorModeIntent(intent.scope)).toThrow("không hợp lệ");
    sessionStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(() => savePendingFloorModeIntent(intent)).toThrow("Không lưu được");
  });
});
