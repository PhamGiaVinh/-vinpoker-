import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

afterEach(cleanup);

// Mutable hook stub — tests drive loading / notApplied / data per scenario.
const REC: { loading: boolean; error: string | null; notApplied: boolean; data: any; reload: () => void } = {
  loading: false, error: null, notApplied: false, data: null, reload: vi.fn(),
};
vi.mock("@/hooks/useTournamentPayoutRecipients", () => ({
  useTournamentPayoutRecipients: () => REC,
}));

// supabase.rpc for the write path (record_tournament_prize_payment).
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a) } }));

// toast spies.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PrizePayoutTrackingSection } from "../PrizePayoutTrackingSection";
import { toast } from "sonner";

const nfc = (s: string) => s.normalize("NFC");
const bodyText = () => document.body.textContent!.normalize("NFC");
const has = (s: string) => bodyText().includes(nfc(s));
const clickBtn = (label: string) => {
  const btns = Array.from(document.body.querySelectorAll("button"));
  const btn = btns.find((b) => (b.textContent ?? "").normalize("NFC").includes(nfc(label)));
  if (!btn) throw new Error("button not found: " + label);
  fireEvent.click(btn);
};

const DATA = {
  tournamentId: "t1", itmPlaces: 3, owedTotal: 6_000_000, paidTotal: 2_000_000,
  paidCount: 1, totalCount: 2,
  places: [
    { finishedPlace: 1, recipientName: "Nguyễn Văn A", prizeAmount: 4_000_000, isPaid: false, paidAt: null, method: null },
    { finishedPlace: 2, recipientName: "Trần B", prizeAmount: 2_000_000, isPaid: true, paidAt: "2026-07-04T10:00:00Z", method: "cash" },
  ],
};

beforeEach(() => {
  REC.loading = false; REC.error = null; REC.notApplied = false; REC.data = null;
  REC.reload = vi.fn();
  rpc.mockReset();
  (toast.success as any).mockReset?.();
  (toast.error as any).mockReset?.();
});

describe("PrizePayoutTrackingSection (W3-B2)", () => {
  it("lists payable places: paid badge for paid, record button for unpaid", () => {
    REC.data = DATA;
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("Đã trả thưởng")).toBe(true);
    expect(has("Nguyễn Văn A")).toBe(true);
    expect(has("Trần B")).toBe(true);
    expect(has("#1")).toBe(true);
    expect(has("#2")).toBe(true);
    // paid place → badge; unpaid place → record button
    const btns = Array.from(document.body.querySelectorAll("button")).map((b) => (b.textContent ?? "").normalize("NFC"));
    expect(btns.some((t) => t.includes(nfc("Ghi nhận đã trả")))).toBe(true);
    // summary "1/2 suất"
    expect(has("1/2")).toBe(true);
  });

  it("notApplied → 'Cần áp dụng', no record button (RPC never reachable)", () => {
    REC.notApplied = true;
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("Cần áp dụng")).toBe(true);
    const btns = Array.from(document.body.querySelectorAll("button")).map((b) => (b.textContent ?? "").normalize("NFC"));
    expect(btns.some((t) => t.includes(nfc("Ghi nhận đã trả")))).toBe(false);
  });

  it("empty finalized places → honest 'chưa thể ghi nhận trả', not a 0", () => {
    REC.data = { ...DATA, places: [], totalCount: 0, paidCount: 0, owedTotal: 0, paidTotal: 0 };
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    expect(has("chưa thể ghi nhận trả")).toBe(true);
  });

  it("record → confirm → success toast; RPC sends only place + method (server derives amount)", async () => {
    REC.data = DATA;
    rpc.mockResolvedValue({ data: { ok: true, outcome: "recorded", prize_amount: 4_000_000 }, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    expect(has("Xác nhận đã trả thưởng")).toBe(true); // dialog restates the money-action
    clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("record_tournament_prize_payment", {
      p_tournament_id: "t1", p_finished_place: 1, p_method: "cash",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("already_paid → idempotent SUCCESS (never a red error)", async () => {
    REC.data = DATA;
    rpc.mockResolvedValue({ data: { ok: true, outcome: "already_paid", prize_amount: 4_000_000 }, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect((toast.success as any).mock.calls[0][0]).toContain(nfc("trước đó"));
  });

  it("business error (place_not_finalized) → mapped VI error toast, no success", async () => {
    REC.data = DATA;
    rpc.mockResolvedValue({ data: { ok: false, error: "place_not_finalized" }, error: null });
    render(<PrizePayoutTrackingSection tournamentId="t1" />);
    clickBtn("Ghi nhận đã trả");
    clickBtn("Xác nhận đã trả");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls[0][0]).toContain(nfc("chưa chốt"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
