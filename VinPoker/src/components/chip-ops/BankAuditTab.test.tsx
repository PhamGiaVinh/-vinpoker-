import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { BankAuditTab } from "./BankAuditTab";

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  h.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
  }));
});

describe("BankAuditTab", () => {
  it("does not present an authorization failure as an empty chip bank", async () => {
    h.rpc.mockResolvedValue({ data: { error: "Forbidden" }, error: null });
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);

    await screen.findByText(/Không tải được dữ liệu két chip\. Số tồn/);
    expect(screen.getByText(/Không thể xác nhận tồn kho/)).toBeTruthy();
    expect(screen.queryByText(/Chưa có mệnh giá trong CLB/)).toBeNull();
    expect(screen.getByRole("switch", { name: "Bật két tự động" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Đồng bộ kho két" }).hasAttribute("disabled")).toBe(true);
  });

  it("ignores a late bank response from a previously selected club", async () => {
    let resolveOld!: (value: unknown) => void;
    h.rpc.mockImplementation((_name: string, args: { p_club_id: string }) =>
      args.p_club_id === "club-a"
        ? new Promise((resolve) => { resolveOld = resolve; })
        : Promise.resolve({ data: { denominations: [], coupling_enabled: false }, error: null }));

    const view = render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);
    view.rerender(<BankAuditTab clubId="club-b" tournamentId="tour-b" />);
    await screen.findByText(/Chưa có mệnh giá trong CLB/);

    await act(async () => { resolveOld({ data: { error: "Forbidden" }, error: null }); });
    expect(screen.queryByText(/Không tải được dữ liệu két chip\. Số tồn/)).toBeNull();
  });
});
