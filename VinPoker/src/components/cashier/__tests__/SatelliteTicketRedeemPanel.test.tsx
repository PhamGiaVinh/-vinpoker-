import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import { SatelliteTicketRedeemPanel } from "../SatelliteTicketRedeemPanel";

const code = "fa000000-0000-4000-8000-000000000001";
const winner = "fa000000-0000-4000-8000-000000000002";
const bearer = "fa000000-0000-4000-8000-000000000003";
beforeAll(() => {
  globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ||= () => {};
  Element.prototype.hasPointerCapture ||= () => false;
  Element.prototype.releasePointerCapture ||= () => {};
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true,
    value: () => "fa000000-0000-4000-8000-000000000004" });
});
beforeEach(() => {
  h.rpc.mockReset(); h.from.mockReset();
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "satellite_verify_ticket_v1") return { data: { ok: true,
      ticketId: "ticket", status: "issued", serial: 1, winnerPlayerId: winner,
      targetTournamentId: "target", targetEntryPriceVnd: "6600000",
      targetBuyInVnd: "6000000", targetFeeVnd: "600000" }, error: null };
    if (name === "satellite_redeem_ticket_v1") return { data: { ok: true }, error: null };
    if (name === "satellite_get_redemption_receipt_v1") return { data: {
      ok: true, status: "redeemed", ticketId: "ticket", winnerPlayerId: winner,
      redeemedForPlayerId: bearer, registrationId: "registration", entryId: "entry",
      receiptId: "receipt", receiptCode: "R-1", buyInVnd: "6000000", feeVnd: "600000",
    }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  h.from.mockImplementation((name: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "ilike", "eq", "order"]) chain[method] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => ({ data: name === "profiles"
      ? [{ user_id: bearer, display_name: "Bearer" }] : [], error: null }));
    return chain;
  });
});
afterEach(cleanup);

describe("Satellite cashier ticket", () => {
  it("verifies privately, selects a bearer distinct from winner, and reloads server receipt", async () => {
    render(<SatelliteTicketRedeemPanel />);
    fireEvent.change(screen.getByLabelText("Private ticket code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Verify ticket" }));
    expect(await screen.findByText(/Ticket #1 · issued/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find actual bearer"), { target: { value: "Be" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Actual bearer" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Bearer/ }));
    expect(await screen.findByText(new RegExp(`Bearer: ${bearer}`))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Redeem for selected bearer" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_redeem_ticket_v1", {
      p_current_code: code, p_request_id: "fa000000-0000-4000-8000-000000000004",
      p_redeemed_for_player_id: bearer, p_source_entry_id: null,
    }));
    expect(await screen.findByText(/Server receipt · redeemed/)).toBeTruthy();
    expect(screen.getByText(/6000000 VND buy-in \+ 600000 VND fees/)).toBeTruthy();
    expect((screen.getByLabelText("Private ticket code") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Reload receipt" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_get_redemption_receipt_v1", {
      p_request_id: "fa000000-0000-4000-8000-000000000004",
    }));
  });
  it("does not offer Redeem for a reversed ticket", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, ticketId: "ticket", status: "reversed",
      serial: 1, winnerPlayerId: winner, targetEntryPriceVnd: "6600000",
      targetBuyInVnd: "6000000", targetFeeVnd: "600000" }, error: null });
    render(<SatelliteTicketRedeemPanel />);
    fireEvent.change(screen.getByLabelText("Private ticket code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Verify ticket" }));
    expect(await screen.findByText(/cannot be redeemed again/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Redeem for selected bearer" })).toBeNull();
  });
});
