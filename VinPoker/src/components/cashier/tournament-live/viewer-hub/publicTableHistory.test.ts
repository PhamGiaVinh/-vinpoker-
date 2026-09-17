import { describe, expect, it } from "vitest";
import { parsePublicTableCurrentResponse, parsePublicTableHistoryPage } from "./publicTableHistory";

describe("public current-table RPC parser", () => {
  it("keeps a confirmed last-completed hand separate from waiting", () => {
    expect(parsePublicTableCurrentResponse({
      access: "public", tableId: "table-a", tableSessionId: "session-a", state: "last_completed", hand: { id: "hand-12" },
    })).toMatchObject({ state: "last_completed", hand: { id: "hand-12" } });
    expect(parsePublicTableCurrentResponse({
      access: "public", tableId: "table-a", tableSessionId: "session-a", state: "waiting", hand: null,
    })).toMatchObject({ state: "waiting", hand: null });
  });

  it("fails closed for a malformed state and clears on access revocation", () => {
    expect(parsePublicTableCurrentResponse({ access: "public", state: "idle" })).toBeNull();
    expect(parsePublicTableCurrentResponse({ access: "revoked" })).toMatchObject({ access: "revoked", hand: null });
  });
});

describe("public table history parser", () => {
  it("preserves tuple cursor identity for same-timestamp pages", () => {
    const page = parsePublicTableHistoryPage({
      access: "public",
      items: [
        { handId: "z", tableSessionId: "session-2", handNumber: 12, createdAt: "2026-09-17T01:00:00Z", board: ["AS"], pot: 200, bigBlind: 100, ante: 25 },
        { handId: "y", tableSessionId: "session-1", handNumber: 11, createdAt: "2026-09-17T01:00:00Z", board: [], pot: 100, bigBlind: null },
      ],
      nextCursor: { createdAt: "2026-09-17T01:00:00Z", id: "y" },
    }, "tour", "table");
    expect(page?.items.map((item) => item.handId)).toEqual(["z", "y"]);
    expect(page?.nextCursor).toEqual({ createdAt: "2026-09-17T01:00:00Z", handId: "y" });
    expect(page?.items[1].bigBlind).toBeNull();
    expect(page?.items[0].ante).toBe(25);
  });

  it("does not accept a page with a cursor that cannot perform strict tuple pagination", () => {
    expect(parsePublicTableHistoryPage({ access: "public", items: [], nextCursor: { createdAt: "same" } }, "tour", "table")).toBeNull();
  });
});
