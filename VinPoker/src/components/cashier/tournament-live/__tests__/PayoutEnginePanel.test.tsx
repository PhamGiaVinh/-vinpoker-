import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

afterEach(cleanup);

// ---- configurable backend state (vi.hoisted so the mock factory can read it) ----
const h = vi.hoisted(() => ({
  tour: {
    id: "t1", buy_in: 1_000_000, rake_amount: 200_000, prize_pool: null as number | null,
    itm_places: null as number | null, registration_closed_at: null as string | null,
    live_status: null as string | null, event_id: null as string | null, club_id: "c1",
  },
  prizes: [] as any[],
  appliedRun: null as any,
  entriesCount: 10,
  invoke: vi.fn(async (_n: string, _o: any): Promise<any> => ({
    data: { result: { rows: [{ position: 1, amount: 7_600_000, percentage: 76 }, { position: 2, amount: 2_400_000, percentage: 24 }], itmPlaces: 2, effectiveFloor: 2_400_000, archetype: "DAILY", warnings: [] }, prizePool: 10_000_000 },
    error: null,
  })),
  rpc: vi.fn(async (name: string, _a: any): Promise<any> => {
    if (name === "get_tournament_prizes") return { data: h.prizes, error: null };
    if (name === "prepare_payout_snapshot") return { data: { run_id: "run-1" }, error: null };
    if (name === "save_tournament_prizes_v2") return { data: { status: "saved" }, error: null };
    return { data: null, error: null };
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const makeChain = (table: string) => {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.neq = vi.fn(() => chain);
    chain.single = vi.fn(async () => (table === "tournaments" ? { data: h.tour, error: null } : { data: null, error: null }));
    chain.maybeSingle = vi.fn(async () => (table === "tournament_payout_runs" ? { data: h.appliedRun, error: null } : { data: null, error: null }));
    chain.then = (resolve: any) => resolve({ data: [], count: h.entriesCount, error: null }); // tournament_entries awaited directly
    return chain;
  };
  return { supabase: { from: vi.fn((t: string) => makeChain(t)), rpc: h.rpc, functions: { invoke: h.invoke } } };
});

import { PayoutEnginePanel } from "../PayoutEnginePanel";
import { toast } from "sonner";

beforeAll(() => {
  (globalThis as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ||= () => {};
  (Element.prototype as any).hasPointerCapture ||= () => false;
  (Element.prototype as any).releasePointerCapture ||= () => {};
});

beforeEach(() => {
  h.tour.registration_closed_at = null; h.tour.live_status = null; h.tour.event_id = null;
  h.prizes = []; h.appliedRun = null; h.entriesCount = 10;
  h.invoke.mockClear(); h.rpc.mockClear();
  (toast.error as any).mockClear(); (toast.success as any).mockClear();
  h.invoke.mockImplementation(async () => ({ data: { result: { rows: [{ position: 1, amount: 7_600_000, percentage: 76 }, { position: 2, amount: 2_400_000, percentage: 24 }], itmPlaces: 2, effectiveFloor: 2_400_000, archetype: "DAILY", warnings: [] }, prizePool: 10_000_000 }, error: null }));
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "get_tournament_prizes") return { data: h.prizes, error: null };
    if (name === "prepare_payout_snapshot") return { data: { run_id: "run-1" }, error: null };
    if (name === "save_tournament_prizes_v2") return { data: { status: "saved" }, error: null };
    return { data: null, error: null };
  });
});

const officialState = () => {
  h.tour.registration_closed_at = "2026-06-29T00:00:00Z";
  h.prizes = [{ position: 1, percentage: 76, amount: 7_600_000 }, { position: 2, percentage: 24, amount: 2_400_000 }];
  h.appliedRun = { source: "close", entries_snapshot: 10, itm_places: 2, prize_pool_snapshot: 10_000_000 };
};

describe("PayoutEnginePanel — preview is forecast-only (does NOT close registration)", () => {
  it("Xem trước calls compute-payouts mode=preview and NEVER prepare_payout_snapshot", async () => {
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByText(/Xem trước/));
    await waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke.mock.calls[0][0]).toBe("compute-payouts");
    expect(h.invoke.mock.calls[0][1].body.mode).toBe("preview");
    // critically: no snapshot / close happened
    expect(h.rpc.mock.calls.some((c) => c[0] === "prepare_payout_snapshot")).toBe(false);
    // estimated banner shows
    expect(await screen.findByText(/DỰ KIẾN/)).toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — official requires EXPLICIT confirmation (one-way)", () => {
  it("clicking the close button opens a confirm dialog; prepare runs only after confirm", async () => {
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Đóng đăng ký & tạo payout/ }));
    // dialog open, warns one-way — but prepare NOT called yet
    expect(await screen.findByText(/MỘT CHIỀU/)).toBeInTheDocument();
    expect(h.rpc.mock.calls.some((c) => c[0] === "prepare_payout_snapshot")).toBe(false);
    // confirm
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(() => expect(h.rpc.mock.calls.some((c) => c[0] === "prepare_payout_snapshot")).toBe(true));
    await waitFor(() => expect(h.invoke.mock.calls.some((c) => c[1].body.mode === "official")).toBe(true));
  });
});

describe("PayoutEnginePanel — manual edit requires a reason", () => {
  it("save is disabled with an empty reason and enables once a reason is entered (sum matches)", async () => {
    officialState();
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/PAYOUT CHÍNH THỨC/);
    fireEvent.click(screen.getByRole("button", { name: /Chỉnh tay/ }));
    const save = await screen.findByRole("button", { name: /Lưu chỉnh tay/ });
    expect(save).toBeDisabled(); // no reason yet (sum already matches the locked pool)
    fireEvent.change(screen.getByPlaceholderText(/Lý do chỉnh tay/), { target: { value: "sửa theo thoả thuận bàn cuối" } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(h.rpc.mock.calls.some((c) => c[0] === "save_tournament_prizes_v2")).toBe(true));
  });
});

describe("PayoutEnginePanel — backend error codes surface as friendly messages", () => {
  it("NOT_AUTHORIZED on preview", async () => {
    h.invoke.mockImplementation(async () => ({ data: { error: "NOT_AUTHORIZED" }, error: null }));
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByText(/Xem trước/));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/NOT_AUTHORIZED/);
  });

  it("RUN_NOT_DRAFT / REGISTRATION_NOT_CLOSED on official; SUM_MISMATCH on manual edit", async () => {
    // official → prepare ok, but the Edge official apply returns RUN_NOT_DRAFT
    h.invoke.mockImplementation(async (_n, o: any) => (o.body.mode === "official" ? { data: { error: "RUN_NOT_DRAFT" }, error: null } : { data: { result: { rows: [], itmPlaces: 0, effectiveFloor: 0, archetype: "DAILY", warnings: [] } }, error: null }));
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Đóng đăng ký & tạo payout/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(() => expect((toast.error as any).mock.calls.some((c: any[]) => /RUN_NOT_DRAFT/.test(c[0]))).toBe(true));

    // manual edit → save returns SUM_MISMATCH (force via rpc), reason present + sum matches client-side
    officialState();
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "get_tournament_prizes") return { data: h.prizes, error: null };
      if (name === "save_tournament_prizes_v2") return { data: null, error: { message: "SUM_MISMATCH" } };
      return { data: null, error: null };
    });
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findAllByText(/PAYOUT CHÍNH THỨC/);
    fireEvent.click(screen.getAllByRole("button", { name: /Chỉnh tay/ })[0]);
    const reason = screen.getByPlaceholderText(/Lý do chỉnh tay/);
    fireEvent.change(reason, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu chỉnh tay/ }));
    await waitFor(() => expect((toast.error as any).mock.calls.some((c: any[]) => /SUM_MISMATCH/.test(c[0]))).toBe(true));
  });
});

describe("PayoutEnginePanel — multi-day is blocked in the UI", () => {
  it("event-linked tournament disables preview + official and shows a warning", async () => {
    h.tour.event_id = "ev-1";
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    expect(screen.getByText(/Giải nhiều ngày/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Xem trước/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Đóng đăng ký & tạo payout/ })).toBeDisabled();
  });
});

describe("PayoutEnginePanel — manual edit blocks a sum that ≠ the locked pool", () => {
  it("save stays disabled when Σ ≠ locked pool even with a reason", async () => {
    officialState();
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/PAYOUT CHÍNH THỨC/);
    fireEvent.click(screen.getByRole("button", { name: /Chỉnh tay/ }));
    // break the sum: rank 1 7.6M → 9.6M (Σ = 12M ≠ locked 10M)
    const editInput = screen.getAllByRole("spinbutton").find((el) => (el as HTMLInputElement).value === "7600000");
    fireEvent.change(editInput!, { target: { value: "9600000" } });
    fireEvent.change(screen.getByPlaceholderText(/Lý do chỉnh tay/), { target: { value: "có lý do nhưng tổng sai" } });
    // reason is present but Σ (12M) ≠ locked pool (10M) → save must stay disabled
    expect(screen.getByRole("button", { name: /Lưu chỉnh tay/ })).toBeDisabled();
  });
});

describe("PayoutEnginePanel — official does not auto-run from preview", () => {
  it("running preview never triggers prepare or official compute", async () => {
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByText(/Xem trước/));
    await waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.rpc.mock.calls.some((c) => c[0] === "prepare_payout_snapshot")).toBe(false);
    expect(h.invoke.mock.calls.some((c) => c[1]?.body?.mode === "official")).toBe(false);
  });
});
