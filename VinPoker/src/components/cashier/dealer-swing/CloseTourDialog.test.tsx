import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import CloseTourDialog from "./CloseTourDialog";

const preview = {
  tourName: "Felt UAT",
  activeTables: 1,
  assignedDealers: 1,
  onBreakDealers: 0,
  reservedDealers: 0,
  archiveFilename: "felt.json",
};

describe("CloseTourDialog server gate", () => {
  it("shows the Floor blocker and disables the next step", () => {
    render(<CloseTourDialog open onOpenChange={vi.fn()} preview={preview}
      readiness={{ ok: true, ready: false, alreadyClosed: false, blockers: ["open_table_session"] }}
      onConfirm={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Còn phiên bàn đang mở");
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
  });

  it("allows the next step only after server readiness", () => {
    render(<CloseTourDialog open onOpenChange={vi.fn()} preview={preview}
      readiness={{ ok: true, ready: true, alreadyClosed: false, blockers: [] }}
      onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeEnabled();
  });
});
