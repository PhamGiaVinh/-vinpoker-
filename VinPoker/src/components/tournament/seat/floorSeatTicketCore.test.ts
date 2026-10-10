import { describe, expect, it, vi } from "vitest";
import { fetchFloorSeatTicketWithClient, fetchCurrentFloorSeatTicketWithClient } from "./floorSeatTicketCore";

const context = { actorId: "actor", tournamentId: "tour", entryId: "entry" };
const proof = () => ({ ok: true, tournament_id: "tour", entry_id: "entry", receipt_code: "CODE", status: "issued",
  tournament_table_id: "logical", table_session_id: "session", seat_id: "seat", table_number: 2, seat_number: 3,
  player_name: "TEST Player", tournament_name: "TEST Tour", issued_at: "2026-10-10T08:00:00Z", stack_at_issue: 20000 });

describe("floor seat-ticket public reader boundary", () => {
  it("finds an existing current code only through the exact-seat authorized RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: proof(), error: null });
    const receipt = await fetchCurrentFloorSeatTicketWithClient({ rpc } as never, context, "seat");
    expect(rpc).toHaveBeenCalledWith("get_current_floor_seat_ticket_v1", {
      p_tournament_id: "tour", p_entry_id: "entry", p_seat_id: "seat",
    });
    expect(receipt).toMatchObject({ receiptCode: "CODE", startingStack: 20000, floorSeatContext: context });
  });
  it("rejects a finder response for another seat or missing server code", async () => {
    for (const patch of [{ seat_id: "old-seat" }, { receipt_code: "" }, { receipt_code: null }]) {
      const rpc = vi.fn().mockResolvedValue({ data: { ...proof(), ...patch }, error: null });
      await expect(fetchCurrentFloorSeatTicketWithClient({ rpc } as never, context, "seat")).rejects.toThrow();
    }
  });
  it("passes exact scope, no actor override, and uses audited stack rather than caller fallback", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: proof(), error: null });
    const receipt = await fetchFloorSeatTicketWithClient({ rpc } as never, context, "CODE");
    expect(rpc).toHaveBeenCalledWith("get_floor_seat_ticket_v1", {
      p_tournament_id: "tour", p_entry_id: "entry", p_receipt_code: "CODE",
    });
    expect(receipt).toMatchObject({ startingStack: 20000, tableNumber: 2, seatNumber: 3,
      receiptCode: "CODE", qrValue: "CODE", floorSeatContext: context });
    expect(receipt.totalPay).toBeUndefined();
  });
  it("does not treat transport or permission failure as a printable receipt", async () => {
    for (const result of [{ data: null, error: { message: "503" } }, { data: { ok: false, error: "actor_not_allowed" }, error: null }]) {
      const rpc = vi.fn().mockResolvedValue(result);
      await expect(fetchFloorSeatTicketWithClient({ rpc } as never, context, "CODE")).rejects.toThrow();
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects another scope, stale status, missing incarnation or malformed stack", async () => {
    for (const patch of [{ entry_id: "other-entry" }, { tournament_id: "other-tour" }, { receipt_code: "OTHER" },
      { status: "superseded" }, { table_session_id: null }, { stack_at_issue: -1 }, { stack_at_issue: "20000" }, { seat_number: 0 }]) {
      const rpc = vi.fn().mockResolvedValue({ data: { ...proof(), ...patch }, error: null });
      await expect(fetchFloorSeatTicketWithClient({ rpc } as never, context, "CODE")).rejects.toThrow("không khớp");
    }
  });
  it("does not query without the actor scope", async () => {
    const rpc = vi.fn();
    await expect(fetchFloorSeatTicketWithClient({ rpc } as never, { ...context, actorId: "" }, "CODE")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
