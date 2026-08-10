import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealerSalaryScreen } from "./DealerSalaryScreen";

const testState = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/hooks/dealer/useDealerLink", () => ({
  useDealerLink: () => ({
    dealer: {
      dealerId: "dealer-1",
      clubName: "HSOP",
      fullName: "Dealer Demo",
    },
    isDealer: true,
    loading: false,
    source: "live",
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => testState.rpc(...args) },
}));

describe("DealerSalaryScreen live PT balance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T08:00:00.000Z"));
    testState.rpc.mockReset();
    testState.rpc.mockResolvedValue({
      data: {
        employment_type: "part_time",
        hourly_rate_vnd: 100_000,
        accrued_minutes: 60,
        balance_vnd: 100_000,
        current_shift_open: true,
        current_shift_start: "2026-08-10T07:00:00.000Z",
        accrual_mode: "continuous_standby",
        standby_accrual_enabled: true,
        live_accrual_active: true,
        recent_payments: [],
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-renders the server-backed wage after one second", async () => {
    render(<DealerSalaryScreen />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("dealer-live-wage-balance")).toHaveTextContent("100.000");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByTestId("dealer-live-wage-balance")).toHaveTextContent("100.027");
    expect(screen.getByText(/Đang tăng khoảng/)).toHaveTextContent("28");
  });
});
