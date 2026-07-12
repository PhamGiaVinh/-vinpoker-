import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ResettlePreview } from "@/components/cashier/tournament-live/HandHistoryPanel";

describe("resettle manual-winner containment", () => {
  it("does not expose a client winner picker without server proof", () => {
    const { container, getByRole } = render(
      <ResettlePreview
        view={{
          result: {
            ok: false,
            safeToWrite: false,
            reason: "needs_manual_winner",
            hand_id: "hand-8",
            hand_number: 8,
            affected_player_ids: ["limitless", "kayhan"],
            message: "Thiếu dữ liệu showdown.",
          },
        }}
        busy={false}
        players={[
          { player_id: "limitless", display_name: "Limitless" },
          { player_id: "kayhan", display_name: "Kayhan Mokri" },
        ]}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(getByRole("button", { name: "Bổ sung dữ liệu & tính lại" })).toBeTruthy();
    expect(container.textContent).toContain("không cho client tự chia pot");
    expect(container.textContent).not.toContain("Chọn người thắng");
    expect(container.textContent).not.toContain("Xác nhận đổi chip");
  });
});
