import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DealerPtWageTab from "./DealerPtWageTab";

const testState = vi.hoisted(() => ({
  auth: { isAdmin: true, isClubAdmin: false, isClubOwner: false },
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => testState.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => testState.rpc(...args) },
}));

const clubs = [{ id: "club-1", name: "HSOP" }];

describe("DealerPtWageTab policy control", () => {
  beforeEach(() => {
    testState.auth = { isAdmin: true, isClubAdmin: false, isClubOwner: false };
    testState.rpc.mockReset();
    testState.rpc.mockImplementation((fn: string) => {
      if (fn === "get_club_pt_wages") {
        return Promise.resolve({
          data: {
            dealers: [],
            accrual_mode: "capped_24h",
            standby_accrual_enabled: false,
          },
          error: null,
        });
      }
      if (fn === "get_dealer_pt_wage_global_accrual_policy") {
        return Promise.resolve({ data: { future_club_enabled: false }, error: null });
      }
      if (fn === "set_dealer_pt_wage_accrual_policy") {
        return Promise.resolve({ data: {}, error: null });
      }
      if (fn === "set_all_approved_dealer_pt_wage_accrual") {
        return Promise.resolve({ data: {}, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    });
  });

  it("keeps the policy control out of the routine cashier view", async () => {
    testState.auth = { isAdmin: false, isClubAdmin: false, isClubOwner: false };
    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);

    await screen.findByText("Chưa có dealer part-time đang hoạt động");
    expect(screen.queryByRole("button", { name: "Bật tích lũy liên tục" })).not
      .toBeInTheDocument();
  });

  it("sends an owner-confirmed continuous policy request without a client balance", async () => {
    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);

    await screen.findByText("Chưa có dealer part-time đang hoạt động");
    fireEvent.click(
      screen.getByRole("button", { name: "Bật tích lũy liên tục" }),
    );
    fireEvent.change(screen.getByLabelText("Lý do thay đổi"), {
      target: { value: "Owner UAT for open PT attendance" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bật" }));

    await waitFor(() => {
      expect(testState.rpc).toHaveBeenCalledWith(
        "set_dealer_pt_wage_accrual_policy",
        {
          p_club_id: "club-1",
          p_standby_accrual_enabled: true,
          p_effective_from: null,
          p_reason: "Owner UAT for open PT attendance",
        },
      );
    });
  });

  it("shows the all-club control only after the super-admin global read succeeds", async () => {
    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);

    await screen.findByRole("button", { name: "Bật toàn bộ CLB" });
    fireEvent.click(screen.getByRole("button", { name: "Bật toàn bộ CLB" }));
    fireEvent.change(screen.getByLabelText("Lý do thay đổi"), {
      target: { value: "Activate forward-only PT accrual" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bật toàn bộ" }));

    await waitFor(() => {
      expect(testState.rpc).toHaveBeenCalledWith(
        "set_all_approved_dealer_pt_wage_accrual",
        {
          p_standby_accrual_enabled: true,
          p_reason: "Activate forward-only PT accrual",
        },
      );
    });
  });

  it("fails closed by hiding the all-club control when the privileged read fails", async () => {
    testState.rpc.mockImplementation((fn: string) => {
      if (fn === "get_club_pt_wages") {
        return Promise.resolve({ data: { dealers: [] }, error: null });
      }
      if (fn === "get_dealer_pt_wage_global_accrual_policy") {
        return Promise.resolve({ data: null, error: { message: "missing migration" } });
      }
      return Promise.resolve({ data: {}, error: null });
    });

    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);
    await screen.findByText("Chưa có dealer part-time đang hoạt động");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Bật toàn bộ CLB" })).not.toBeInTheDocument();
    });
  });

  it("keeps the customer preview read-only", async () => {
    testState.rpc.mockImplementation((fn: string) => {
      if (fn === "get_club_pt_wages") {
        return Promise.resolve({
          data: {
            dealers: [{
              dealer_id: "dealer-1",
              full_name: "Dealer Demo",
              hourly_rate_vnd: 100_000,
              accrued_minutes: 60,
              balance_vnd: 100_000,
              last_reset_at: null,
              current_shift_open: true,
              current_shift_start: new Date().toISOString(),
              live_accrual_active: true,
              last_payment: null,
            }],
            accrual_mode: "continuous_standby",
            standby_accrual_enabled: true,
          },
          error: null,
        });
      }
      if (fn === "get_dealer_pt_wage_global_accrual_policy") {
        return Promise.resolve({ data: { future_club_enabled: true }, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    });

    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} readOnly />);

    await screen.findByText("Dealer Demo");
    expect(screen.queryByRole("button", { name: "Thanh toán" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dừng tích lũy liên tục" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tắt toàn bộ CLB" })).not.toBeInTheDocument();
    expect(testState.rpc).not.toHaveBeenCalledWith("pay_part_time_balance", expect.anything());
  });
});
