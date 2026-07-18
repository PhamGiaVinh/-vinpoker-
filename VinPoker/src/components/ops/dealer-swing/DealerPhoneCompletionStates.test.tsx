// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DealerPhoneCloseTablesSheet } from "@/components/ops/dealer-swing/DealerPhoneCloseTablesSheet";
import { DealerPhoneReconcileSheet } from "@/components/ops/dealer-swing/DealerPhoneReconcileSheet";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

describe("Dealer Swing phone completion states", () => {
  it("shows a bounded empty state for close tables", () => {
    render(
      <DealerPhoneCloseTablesSheet
        open
        activeClubId="22222222-2222-2222-2222-222222222222"
        tables={[]}
        onOpenChange={vi.fn()}
        onCompleted={vi.fn()}
        onConflict={vi.fn()}
        onRolloutDisabled={vi.fn()}
      />,
    );

    expect(screen.getByText("Không có bàn active để đóng.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Kiểm tra 0 bàn" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps reconcile apply unavailable until a real change is previewed", () => {
    render(
      <DealerPhoneReconcileSheet
        open
        activeClubId="22222222-2222-2222-2222-222222222222"
        initialTableId={null}
        tables={[]}
        dealers={[]}
        onOpenChange={vi.fn()}
        onApplied={vi.fn()}
        onRaceLost={vi.fn()}
        onRolloutDisabled={vi.fn()}
      />,
    );

    expect(screen.getByText(/Swap 2 bàn và cycle nhiều bàn/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Kiểm tra" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps an in-progress reconcile draft when realtime props refresh", () => {
    const props = {
      open: true,
      activeClubId: "22222222-2222-2222-2222-222222222222",
      initialTableId: null,
      dealers: [],
      onOpenChange: vi.fn(),
      onApplied: vi.fn(),
      onRaceLost: vi.fn(),
      onRolloutDisabled: vi.fn(),
    };
    const { rerender } = render(<DealerPhoneReconcileSheet {...props} tables={[]} />);
    const reason = screen.getByLabelText("Lý do sửa") as HTMLInputElement;
    fireEvent.change(reason, { target: { value: "Giữ lựa chọn khi realtime cập nhật" } });

    rerender(<DealerPhoneReconcileSheet {...props} tables={[].slice()} />);

    expect(reason.value).toBe("Giữ lựa chọn khi realtime cập nhật");
  });
});
