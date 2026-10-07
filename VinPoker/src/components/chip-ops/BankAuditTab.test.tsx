import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { BankAuditTab } from "./BankAuditTab";

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  sessionStorage.clear();
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

  it("retries a persisted uncertain adjustment with the original request and payload", async () => {
    sessionStorage.setItem("vinpoker:chip-bank-pending:club-a", JSON.stringify({
      clubId: "club-a", tournamentId: "tour-a", denominationId: "denom-a",
      direction: "thu", count: 12, oldVersion: 3, requestId: "original-request",
    }));
    h.rpc.mockImplementation(async (name: string) => name === "get_chip_bank"
      ? { data: { denominations: [{ denomination_id: "denom-a", value: 100, color: null,
        on_hand_count: 8, version: 3 }], coupling_enabled: false }, error: null }
      : { data: { status: "ok", idempotent: true }, error: null });

    render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);
    await screen.findByText(/Có lệnh Thu 12 chip chưa rõ kết quả/);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại lệnh cũ" }));

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("chip_ops_bank_adjust", {
      p_club_id: "club-a", p_denomination_id: "denom-a", p_direction: "thu", p_count: 12,
      p_tournament_id: "tour-a", p_old_version: 3, p_idempotency_key: "original-request",
    }));
    await waitFor(() => expect(sessionStorage.getItem("vinpoker:chip-bank-pending:club-a")).toBeNull());
  });

  it("does not dispatch the same pending adjustment twice on a rapid double-click", async () => {
    sessionStorage.setItem("vinpoker:chip-bank-pending:club-a", JSON.stringify({
      clubId: "club-a", tournamentId: null, denominationId: "denom-a",
      direction: "xuat", count: 2, oldVersion: 1, requestId: "one-request",
    }));
    let resolveAdjust!: (value: unknown) => void;
    h.rpc.mockImplementation((name: string) => name === "get_chip_bank"
      ? Promise.resolve({ data: { denominations: [], coupling_enabled: false }, error: null })
      : new Promise((resolve) => { resolveAdjust = resolve; }));

    render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);
    await screen.findByText(/Có lệnh Xuất 2 chip chưa rõ kết quả/);
    const retry = screen.getByRole("button", { name: "Thử lại lệnh cũ" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(h.rpc.mock.calls.filter(([name]) => name === "chip_ops_bank_adjust")).toHaveLength(1);
    await act(async () => { resolveAdjust({ data: { status: "ok" }, error: null }); });
  });
});
