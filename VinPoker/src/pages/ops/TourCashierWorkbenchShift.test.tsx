import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  tours: [] as Array<{ id: string; name: string; start_time: string; status: string }>,
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    rpc: mock.rpc,
    from: (table: string) => {
      let closed = false;
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        not: () => { closed = true; return query; },
        order: () => query,
        limit: () => Promise.resolve({ data: table === "tournaments" ? mock.tours : [
          { id: "shift-a", opened_at: "2026-09-15T08:00:00Z", closed_at: "2026-09-15T16:00:00Z", counted_cash: 100, variance_cash: 0 },
          { id: "shift-b", opened_at: "2026-09-14T08:00:00Z", closed_at: "2026-09-14T16:00:00Z", counted_cash: 200, variance_cash: 0 },
        ], error: null }),
        maybeSingle: () => Promise.resolve({ data: closed ? null : null, error: null }),
      };
      return query;
    },
  };
  return { useSupabaseClient: () => client };
});
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({
    loading: false, scopeError: null, isSuperAdmin: false,
    cashierClubIds: ["club-a"], clubs: [{ id: "club-a", name: "Club A" }],
  }),
}));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({
  useOpsWorkspace: () => ({ selectedClubId: "club-a" }),
}));
vi.mock("@/ops/opsMutations", () => ({
  assertMutationOk: (data: unknown) => data,
}));
vi.mock("@/lib/featureFlags", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/featureFlags")>(),
  OPS_TOUR_CASHIER_ENABLED: true,
}));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));

import TourCashierWorkbench from "./TourCashierWorkbench";

describe("closed Cashier shift correction", () => {
  beforeEach(() => {
    mock.tours = [];
    sessionStorage.removeItem("cashier-tour:club-a");
    mock.rpc.mockReset();
    mock.rpc.mockImplementation((name: string, args: { p_shift_id?: string }) => {
      if (name === "cashier_shift_summary_v1") return Promise.resolve({ data: {
        ok: true, shift_id: args.p_shift_id, totals: { cash_adjustments: 0 },
      }, error: null });
      if (name === "cashier_tour_issues_v1") return Promise.resolve({ data: {
        ok: true, sepay_unavailable: false, shown: 0, rows: [],
      }, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    });
  });

  it("targets the selected historical shift, not only the latest closed shift", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TourCashierWorkbench />);
    const selector = await screen.findByRole("combobox", { name: "Chọn ca đã chốt" });
    fireEvent.change(selector, { target: { value: "shift-b" } });
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("cashier_shift_summary_v1", { p_shift_id: "shift-b" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Số tiền (VND)" }), { target: { value: "100000" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Lý do" }), { target: { value: "Sửa sai kiểm đếm" } });
    fireEvent.click(screen.getByRole("button", { name: "Ghi điều chỉnh" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("cashier_adjust_shift_v1", expect.objectContaining({
      p_shift_id: "shift-b", p_direction: "in", p_amount: 100000,
    })));
    vi.restoreAllMocks();
  });

  it("shows a confirmed registration without a receipt as requiring review, never another payment", async () => {
    mock.tours = [{ id: "tour-a", name: "Tour A", start_time: "2026-09-15T10:00:00Z", status: "registering" }];
    sessionStorage.setItem("cashier-tour:club-a", "tour-a");
    mock.rpc.mockImplementation((name: string, args: { p_bucket?: string; p_shift_id?: string }) => {
      if (name === "cashier_tour_worklist_v1") return Promise.resolve({ data: {
        ok: true, enabled: true, updated_at: "2026-09-15T09:00:00Z",
        counts: { counter: 0, completed: 0, waiting_seat: 0, needs_review: 1, total: 1 },
        rows: args.p_bucket === "needs_review" ? [{
          id: "registration-a", status: "confirmed", player_name: "Người chơi cũ",
          phone: null, member_card_id: null, reference_code: "TEST-REF", total_pay: 2300000,
          received: 0, bucket: "needs_review", receipt_code: null, table_number: null,
          seat_number: null, legacy_detail_missing: true, cashier_seating_error: null,
        }] : [],
      }, error: null });
      if (name === "cashier_tour_issues_v1") return Promise.resolve({ data: {
        ok: true, sepay_unavailable: false, shown: 0, rows: [],
      }, error: null });
      return Promise.resolve({ data: { ok: true, shift_id: args.p_shift_id, totals: { cash_adjustments: 0 } }, error: null });
    });
    render(<TourCashierWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "Cần xử lý · 1" }));
    fireEvent.click(await screen.findByRole("button", { name: /Người chơi cũ/ }));
    await screen.findByText("Chỉ hoàn đúng khoản đã ghi trong sổ giao dịch. Floor phải xử lý chip và kết thúc lượt trước khi chi hoàn.");
    expect(screen.getByText("Đăng ký đã xác nhận nhưng không tìm thấy phiếu hiện hành. Không thu thêm tiền; báo Floor và đối soát kiểm tra.")).toBeInTheDocument();
    expect(screen.getByText("Không thu thêm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ghi nhận tiền mặt" })).not.toBeInTheDocument();
  });
});
