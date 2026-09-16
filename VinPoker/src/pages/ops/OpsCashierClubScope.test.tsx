import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ selectedClubId: "club-a" }));

vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({
  useOpsWorkspace: () => ({ selectedClubId: workspace.selectedClubId }),
}));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: null }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => ({}) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => ({}) }));
vi.mock("@/ops/opsMutations", () => ({ OPS_CASHIER_MUTATIONS_ENABLED: true }));
vi.mock("./TourCashierWorkbench", async () => {
  const { useState } = await import("react");
  return { default: function MockTourCashierWorkbench() {
    const [amount, setAmount] = useState("");
    return <input aria-label="Số tiền đang nhập" value={amount}
      onChange={(event) => setAmount(event.target.value)} />;
  } };
});

import OpsCashier from "./OpsCashier";

describe("OpsCashier club scope", () => {
  beforeEach(() => { workspace.selectedClubId = "club-a"; });

  it("discards the previous club's in-progress cashier input when switching clubs", () => {
    const view = render(<OpsCashier />);
    const amount = screen.getByRole("textbox", { name: "Số tiền đang nhập" });
    fireEvent.change(amount, { target: { value: "5300000" } });
    expect(amount).toHaveValue("5300000");

    workspace.selectedClubId = "club-b";
    view.rerender(<OpsCashier />);
    expect(screen.getByRole("textbox", { name: "Số tiền đang nhập" })).toHaveValue("");
  });
});
