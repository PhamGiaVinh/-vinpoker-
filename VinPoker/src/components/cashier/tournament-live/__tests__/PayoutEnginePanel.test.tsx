import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

afterEach(cleanup);

// ---- configurable backend state (vi.hoisted so the mock factory can read it) ----
const h = vi.hoisted(() => ({
  tour: {
    id: "t1", buy_in: 1_000_000, rake_amount: 200_000, prize_pool: null as number | null,
    itm_places: null as number | null, registration_closed_at: null as string | null,
    live_status: null as string | null, event_id: null as string | null, club_id: "c1",
    operations_mode: "standard",
    planned_itm_percent: null as number | null, planned_payout_archetype: null as string | null,
    planned_min_cash_x: null as number | null, planned_rounding_unit: null as number | null,
  },
  prizes: [] as any[],
  appliedRun: null as any,
  entriesCount: 10,
  tourRead: null as null | ((id: string) => Promise<any>),
  prizesError: null as { message: string } | null,
  runError: null as { message: string } | null,
  entriesError: null as { message: string } | null,
  tournamentsUpdateError: null as { message: string } | null,
  // RETURNING rows của UPDATE tournaments (RLS lọc → []). Mặc định 1 row = update thành công.
  tournamentsUpdateRows: [{ id: "t1" }] as { id: string }[],
  lastTournamentsUpdatePayload: null as any,
  invoke: vi.fn(async (_n: string, _o: any): Promise<any> => ({
    data: { result: { rows: [{ position: 1, amount: 7_600_000, percentage: 76 }, { position: 2, amount: 2_400_000, percentage: 24 }], itmPlaces: 2, effectiveFloor: 2_400_000, archetype: "DAILY", warnings: [] }, prizePool: 10_000_000 },
    error: null,
  })),
  rpc: vi.fn(async (name: string, _a: any): Promise<any> => {
    if (name === "get_tournament_prizes") return { data: h.prizes, error: h.prizesError };
    if (name === "prepare_payout_snapshot") return { data: { run_id: "run-1" }, error: null };
    if (name === "save_tournament_prizes_v2") return { data: { status: "saved" }, error: null };
    return { data: null, error: null };
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Mutable feature flags — the panel reads FEATURES.payoutCustomMode for the CUSTOM gate.
const flags = vi.hoisted(() => ({ payoutCustomMode: false, payoutCustomTemplates: false, payoutPlannedSettings: false, satelliteAwardsV1: false }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: flags }));
vi.mock("../SatelliteAwardPlanPanel", () => ({ SatelliteAwardPlanPanel: () => <div>Satellite awards isolated</div> }));
vi.mock("@/integrations/supabase/client", () => {
  const makeChain = (table: string) => {
    const chain: any = {};
    let isUpdate = false;
    let id = "";
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((key: string, value: string) => { if (key === "id") id = value; return chain; });
    chain.neq = vi.fn(() => chain);
    chain.single = vi.fn(async () => (table === "tournaments" ? h.tourRead ? h.tourRead(id) : { data: h.tour, error: null } : { data: null, error: null }));
    chain.maybeSingle = vi.fn(async () => (table === "tournament_payout_runs" ? { data: h.appliedRun, error: h.runError } : { data: null, error: null }));
    chain.order = vi.fn(() => chain);
    chain.insert = vi.fn(async () => ({ data: null, error: null }));
    chain.update = vi.fn((payload: any) => { isUpdate = true; if (table === "tournaments") h.lastTournamentsUpdatePayload = payload; return chain; });
    chain.delete = vi.fn(() => chain);
    chain.then = (resolve: any) => resolve(
      table === "tournaments" && isUpdate
        ? { data: h.tournamentsUpdateError ? null : h.tournamentsUpdateRows, error: h.tournamentsUpdateError }
        : { data: [], count: h.entriesCount, error: table === "tournament_entries" ? h.entriesError : null },
    ); // entries/templates/planned-save awaited directly
    return chain;
  };
  return { supabase: { from: vi.fn((t: string) => makeChain(t)), rpc: h.rpc, functions: { invoke: h.invoke }, auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })) } } };
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
  h.tour.registration_closed_at = null; h.tour.live_status = null; h.tour.event_id = null; h.tour.operations_mode = "standard";
  h.tour.planned_itm_percent = null; h.tour.planned_payout_archetype = null;
  h.tour.planned_min_cash_x = null; h.tour.planned_rounding_unit = null;
  h.prizes = []; h.appliedRun = null; h.entriesCount = 10; h.tournamentsUpdateError = null;
  h.prizesError = null; h.runError = null; h.entriesError = null;
  h.tourRead = null;
  h.tournamentsUpdateRows = [{ id: "t1" }];
  flags.payoutCustomMode = false; flags.payoutCustomTemplates = false; flags.payoutPlannedSettings = false; flags.satelliteAwardsV1 = false;
  h.invoke.mockClear(); h.rpc.mockClear();
  (toast.error as any).mockClear(); (toast.success as any).mockClear();
  h.invoke.mockImplementation(async () => ({ data: { result: { rows: [{ position: 1, amount: 7_600_000, percentage: 76 }, { position: 2, amount: 2_400_000, percentage: 24 }], itmPlaces: 2, effectiveFloor: 2_400_000, archetype: "DAILY", warnings: [] }, prizePool: 10_000_000 }, error: null }));
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "get_tournament_prizes") return { data: h.prizes, error: h.prizesError };
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

describe("PayoutEnginePanel — Satellite routing", () => {
  it("does not read one-day payout sources for a Satellite", async () => {
    flags.satelliteAwardsV1 = true;
    h.tour.operations_mode = "satellite";
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText("Satellite awards isolated")).toBeTruthy();
    expect(h.rpc.mock.calls.some((call) => call[0] === "get_tournament_prizes")).toBe(false);
  });
});

describe("PayoutEnginePanel — load failures", () => {
  it.each(["prizes", "run", "entries"] as const)("blocks payout actions when %s fails to load", async (source) => {
    if (source === "prizes") h.prizesError = { message: "prizes failed" };
    if (source === "run") h.runError = { message: "run failed" };
    if (source === "entries") h.entriesError = { message: "entries failed" };
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(`${source} failed`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thử lại/ })).toBeTruthy();
    expect(screen.queryByText(/Xem trước/)).toBeNull();
  });
});

describe("PayoutEnginePanel — failed reads do not become empty payout data", () => {
  it.each([
    ["negative amount", [{ position: 1, amount: -1, percentage: 100 }]],
    ["NaN amount", [{ position: 1, amount: "NaN", percentage: 100 }]],
    ["duplicate rank", [{ position: 1, amount: 5, percentage: 50 }, { position: 1, amount: 5, percentage: 50 }]],
    ["missing rank", [{ position: 2, amount: 10, percentage: 100 }]],
    ["bad percentage", [{ position: 1, amount: 10, percentage: 101 }]],
    ["null percentage", [{ position: 1, amount: 10, percentage: null }]],
  ])("blocks malformed official prize rows: %s", async (_case, prizes) => {
    h.prizes = prizes;
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(/Dữ liệu payout chính thức không hợp lệ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
  });
  it.each([
    { source: "close", entries_snapshot: 10, itm_places: 1, prize_pool_snapshot: "NaN" },
    { source: "close", entries_snapshot: 10, itm_places: 2, prize_pool_snapshot: 10 },
    { source: "unknown", entries_snapshot: 10, itm_places: 1, prize_pool_snapshot: 10 },
    { source: "close", entries_snapshot: -1, itm_places: 1, prize_pool_snapshot: 10 },
  ])("blocks malformed applied run: %j", async (run) => {
    h.prizes = [{ position: 1, amount: 10, percentage: 100 }];
    h.appliedRun = run;
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(/Dữ liệu payout chính thức không hợp lệ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
  });
  it.each(["prizesError", "runError", "entriesError"] as const)("shows %s and blocks payout actions", async (key) => {
    h[key] = { message: `Không tải được ${key}` };
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(`Không tải được ${key}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thử lại/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Đóng đăng ký & tạo payout/ })).not.toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
    h[key] = null;
    fireEvent.click(screen.getByRole("button", { name: /Thử lại/ }));
    expect(await screen.findByRole("button", { name: /Xem trước/ })).toBeEnabled();
  });
  it.each([NaN, -1, 1.5])("rejects invalid entry count %s rather than treating it as zero", async count => {
    h.entriesCount = count;
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(/Không tải được dữ liệu payout đầy đủ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
  });
  it("discards a late response from a previously selected tournament", async () => {
    let finish!: (result: any) => void;
    h.tourRead = id => id === "t1" ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ data: { ...h.tour, id: "t2", buy_in: 6000000 }, error: null });
    const view = render(<PayoutEnginePanel tournamentId="t1" />);
    await waitFor(() => expect(finish).toBeDefined());
    view.rerender(<PayoutEnginePanel tournamentId="t2" />);
    await screen.findByRole("button", { name: /Xem trước/ });
    await act(async () => { finish({ data: { ...h.tour, event_id: "old-event" }, error: null }); });
    fireEvent.click(screen.getByRole("button", { name: /Xem trước/ }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke.mock.calls[0][1].body.tournament_id).toBe("t2");
  });
});

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
    fireEvent.change(screen.getByPlaceholderText(/Lý do chỉnh tay/), { target: { value: "sửa lỗi nhập cơ cấu giải đã duyệt" } });
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

describe("PayoutEnginePanel — native CUSTOM mode is gated by FEATURES.payoutCustomMode", () => {
  const openStyleSelect = () => {
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  };

  it("CUSTOM style is HIDDEN when payoutCustomMode = false", async () => {
    flags.payoutCustomMode = false;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    openStyleSelect();
    expect(screen.queryByText(/CUSTOM — CLB tự cấu hình/)).not.toBeInTheDocument();
  });

  it("CUSTOM style is VISIBLE when payoutCustomMode = true", async () => {
    flags.payoutCustomMode = true;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    openStyleSelect();
    expect(await screen.findByText(/CUSTOM — CLB tự cấu hình/)).toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — CUSTOM import/templates gated by FEATURES.payoutCustomTemplates", () => {
  const selectCustom = async () => {
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText(/CUSTOM — CLB tự cấu hình/));
    await screen.findByText(/Cơ cấu % tự cấu hình/); // CUSTOM builder is now visible
  };

  it("import + save-template UI is HIDDEN when payoutCustomTemplates = false (even in CUSTOM)", async () => {
    flags.payoutCustomMode = true; flags.payoutCustomTemplates = false;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    await selectCustom();
    expect(screen.queryByRole("button", { name: /Tải file/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lưu mẫu/ })).not.toBeInTheDocument();
  });

  it("import + save-template UI is VISIBLE when payoutCustomTemplates = true", async () => {
    flags.payoutCustomMode = true; flags.payoutCustomTemplates = true;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    await selectCustom();
    expect(await screen.findByRole("button", { name: /Tải file/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lưu mẫu/ })).toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — LIVE STANDARD is no longer offered (superseded by default banding)", () => {
  it("LIVE STANDARD never appears in the Kiểu giải dropdown", async () => {
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
    expect(screen.queryByText(/LIVE STANDARD/)).not.toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — planned settings gated by FEATURES.payoutPlannedSettings", () => {
  it("save-default button HIDDEN when payoutPlannedSettings = false", async () => {
    flags.payoutPlannedSettings = false;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    expect(screen.queryByRole("button", { name: /Lưu mặc định cho giải này/ })).not.toBeInTheDocument();
  });

  it("OFF: does NOT pre-fill from planned_* even when the tournament has them saved", async () => {
    flags.payoutPlannedSettings = false;
    h.tour.planned_payout_archetype = "INTL"; h.tour.planned_itm_percent = 0.3;
    h.tour.planned_min_cash_x = 1.5; h.tour.planned_rounding_unit = 1_000_000;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    expect((screen.getByRole("spinbutton", { name: "ITM %" }) as HTMLInputElement).value).toBe("15"); // untouched default
  });

  it("ON: pre-fills kiểu giải/ITM%/min-cash/làm tròn from planned_*", async () => {
    flags.payoutPlannedSettings = true;
    h.tour.planned_payout_archetype = "INTL"; h.tour.planned_itm_percent = 0.3;
    h.tour.planned_min_cash_x = 1.5; h.tour.planned_rounding_unit = 1_000_000;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    await waitFor(() => expect((screen.getByRole("spinbutton", { name: "ITM %" }) as HTMLInputElement).value).toBe("30"));
    expect((screen.getByRole("spinbutton", { name: "Min-cash ×" }) as HTMLInputElement).value).toBe("1.5");
    expect((screen.getByRole("spinbutton", { name: "Làm tròn (đ)" }) as HTMLInputElement).value).toBe("1000000");
    expect(screen.getByRole("combobox")).toHaveTextContent(/INTL/);
  });

  it("save-default button VISIBLE when ON, writes planned_* via tournaments.update", async () => {
    flags.payoutPlannedSettings = true;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    const btn = screen.getByRole("button", { name: /Lưu mặc định cho giải này/ });
    fireEvent.click(btn);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(h.lastTournamentsUpdatePayload).toEqual({
      planned_itm_percent: 0.15, planned_payout_archetype: "DAILY", planned_min_cash_x: 2, planned_rounding_unit: 100000,
    });
  });

  it("RLS-denied save surfaces a friendly message (not the raw Postgres error)", async () => {
    flags.payoutPlannedSettings = true;
    h.tournamentsUpdateError = { message: "new row violates row-level security policy for table tournaments" };
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Lưu mặc định cho giải này/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/không có quyền lưu mặc định/);
  });

  it("zero-row RLS-filtered save (no error, data=[]) shows error toast — NOT fake success", async () => {
    // UPDATE bị RLS USING lọc hết row: PostgREST trả data=[] KHÔNG error. Trước fix, code
    // toast success giả. Sau fix: bắt data.length===0 → báo không có quyền.
    flags.payoutPlannedSettings = true;
    h.tournamentsUpdateRows = [];
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Lưu mặc định cho giải này/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/Không có quyền lưu mặc định/);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
