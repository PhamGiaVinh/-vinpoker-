import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);
const test = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, client: { rpc }, onRedeemed: vi.fn(), onBusyChange: vi.fn() };
});
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => test.client,
}));
vi.mock("@/ops/opsMutations", () => ({ OPS_CASHIER_MUTATIONS_ENABLED: true }));
import { SatelliteTicketRedemption } from "./SatelliteTicketRedemption";

const code = "a1111111-1111-4111-8111-111111111111";
const target = "b2222222-2222-4222-8222-222222222222";
const other = "c3333333-3333-4333-8333-333333333333";
const ticket = { ok: true, serial: 7, status: "issued", targetTournamentId: target,
  targetTournamentName: "Main Event 1C", entryPriceVnd: "6600000", buyInVnd: "6000000", feesVnd: "600000" };

beforeEach(() => {
  test.rpc.mockReset(); test.onRedeemed.mockReset(); test.onBusyChange.mockReset();
  test.rpc.mockImplementation(async (name: string) => {
    if (name === "satellite_lookup_ticket_v1") return { data: ticket, error: null };
    if (name === "satellite_find_bearer_v1") return { data: { ok: true, players: [] }, error: null };
    if (name === "satellite_redeem_ticket_v1") return { data: {
      ok: true, idempotent: false, serial: 7, playerName: "Bearer One", cashReceivedVnd: "0",
      seat: { receipt_code: "T1-S3-ABC", table_number: 1, seat_number: 3 },
    }, error: null };
    return { data: null, error: { message: "unexpected RPC" } };
  });
});

describe("Satellite ticket redemption", () => {
  it("refuses a valid code for another target without consuming it", async () => {
    test.rpc.mockResolvedValueOnce({ data: { ...ticket, targetTournamentId: other }, error: null });
    render(<SatelliteTicketRedemption tournamentId={target} enabled onRedeemed={test.onRedeemed} onBusyChange={test.onBusyChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Private QR/ }), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Check ticket" }));
    expect((await screen.findByRole("alert")).textContent).toContain("different tournament");
    expect(test.rpc).not.toHaveBeenCalledWith("satellite_redeem_ticket_v1", expect.anything());
  });

  it("redeems only after review, with zero cash and a seat receipt", async () => {
    render(<SatelliteTicketRedemption tournamentId={target} enabled onRedeemed={test.onRedeemed} onBusyChange={test.onBusyChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Private QR/ }), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Check ticket" }));
    expect(await screen.findByText(/Serial #7/)).toBeTruthy();
    const redeem = screen.getByRole("button", { name: "Redeem + register + seat" });
    expect(redeem).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "Bearer name" }), { target: { value: "Bearer One" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(redeem);
    await waitFor(() => expect(test.rpc).toHaveBeenCalledWith("satellite_redeem_ticket_v1", {
      p_redemption_code: code, p_target_tournament_id: target,
      p_player_id: null, p_player_name: "Bearer One",
    }));
    expect(await screen.findByText(/Ticket redeemed and seat assigned/)).toBeTruthy();
    expect(screen.getByText(/Cash received here: 0 VND/)).toBeTruthy();
    expect(test.onRedeemed).toHaveBeenCalledTimes(1);
    expect(test.onBusyChange).toHaveBeenCalledWith(true);
    expect(test.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the write action disabled when Cashier is unavailable", async () => {
    render(<SatelliteTicketRedemption tournamentId={target} enabled={false} onRedeemed={test.onRedeemed} onBusyChange={test.onBusyChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Private QR/ }), { target: { value: code } });
    expect(screen.getByRole("button", { name: "Check ticket" })).toHaveProperty("disabled", true);
    expect(test.rpc).not.toHaveBeenCalled();
  });
});
