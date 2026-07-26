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
      if (fn === "set_dealer_pt_wage_accrual_policy") {
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
});
