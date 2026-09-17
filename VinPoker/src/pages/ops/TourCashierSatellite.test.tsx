import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { satelliteAwardsV1: true } }));
vi.mock("./SatelliteTicketRedemption", () => ({ SatelliteTicketRedemption: () => <div>Ticket counter</div> }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    rpc: mock.rpc,
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain, is: () => chain,
        not: () => chain, order: () => chain,
        limit: () => Promise.resolve({ data: table === "tournaments" ? [{
          id: "tour-1", name: "Main 1C", status: "live", start_time: null, registration_closed_at: null,
        }] : [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    },
  };
  return { useSupabaseClient: () => client };
});
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({ loading: false, scopeError: null, isSuperAdmin: false,
    cashierClubIds: ["club-a"], clubs: [{ id: "club-a", name: "Club A" }] }),
}));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({
  useOpsWorkspace: () => ({ selectedClubId: "club-a" }),
}));
vi.mock("@/ops/opsMutations", () => ({
  OPS_CASHIER_MUTATIONS_ENABLED: true, assertMutationOk: (data: unknown) => data,
}));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));
import TourCashierWorkbench from "./TourCashierWorkbench";

beforeEach(() => {
  sessionStorage.setItem("cashier-tour:club-a", "tour-1");
  mock.rpc.mockReset();
  mock.rpc.mockImplementation(async (name: string) => {
    if (name === "cashier_tour_worklist_v1") return { data: {
      ok: true, enabled: true, updated_at: new Date().toISOString(),
      counts: { counter: 0, completed: 1, waiting_seat: 0, needs_review: 0, total: 1 },
      rows: [{ id: "reg-1", status: "confirmed", player_name: "Người chơi",
        phone: null, member_card_id: null, reference_code: "SAT-REF", total_pay: 6600000,
        received: 0, bucket: "completed", receipt_code: "T1-S3-AAA", table_number: 1,
        seat_number: 3, legacy_detail_missing: true, cashier_seating_error: null }],
    }, error: null };
    if (name === "satellite_redemptions_for_worklist_v1") return { data: {
      ok: true, rows: [{ registrationId: "reg-1", serial: 7,
        sourceTournamentName: "Satellite 1C", bearerName: "Voucher Guest" }],
    }, error: null };
    if (name === "cashier_tour_issues_v1") return { data: {
      ok: true, sepay_unavailable: false, shown: 0, rows: [],
    }, error: null };
    return { data: { ok: true }, error: null };
  });
});

describe("Cashier Satellite tender overlay", () => {
  it("shows ticket tender instead of missing cash and hides cash-refund action", async () => {
    render(<TourCashierWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: /Đã tự hoàn tất/ }));
    expect(await screen.findByText(/Satellite ticket #7 · Satellite 1C/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Voucher Guest/ }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /Voucher Guest/ })).toBeTruthy());
    expect(screen.getByText(/no cash received/)).toBeTruthy();
    expect(screen.getByText(/Do not use cash refund/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Gửi yêu cầu hoàn/ })).toBeNull();
  });
});
