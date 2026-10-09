import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/types/tournament";
const state = vi.hoisted(() => ({ user: { id: "owner" }, read: vi.fn(),
  t: (key: string) => key,
  rpc: vi.fn(), from: vi.fn(), inventory: vi.fn(), invoke: vi.fn(), toastError: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorTableControlV3: true, floorRedrawSeatLockV1: true } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc, from: state.from, functions: { invoke: state.invoke } } }));
vi.mock("sonner", () => ({ toast: { error: state.toastError, success: vi.fn() } }));
vi.mock("./PlayerActionSheet", () => ({ PlayerActionSheet: ({ open, editDisabledReason, onBust }: { open: boolean; editDisabledReason?: string; onBust: () => void }) => open
  ? <><button disabled={!!editDisabledReason}>Sửa chip{editDisabledReason ? `: ${editDisabledReason}` : ""}</button><button onClick={onBust}>Loại TEST</button></> : null }));
vi.mock("./MovePlayerDialog", () => ({ MovePlayerDialog: () => null }));
vi.mock("./EditChipsDialog", () => ({ EditChipsDialog: () => null }));
vi.mock("./PlayerInfoSheet", () => ({ PlayerInfoSheet: () => null }));
vi.mock("./ManualFloorBustConfirmDialog", () => ({ ManualFloorBustConfirmDialog: () => null }));
vi.mock("./RestoreBustDialog", () => ({ RestoreBustDialog: () => null }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));
import { PlayersGroupedPanel } from "./PlayersGroupedPanel";

const tour = (id: string) => ({ id, club_id: "club", name: "TEST" }) as Tournament;
const table = (overrides: Record<string, unknown> = {}) => ({ tournament_table_id: "table", game_table_id: "physical",
  table_session_id: "current", control_mode: "manual", control_epoch: 2, revision: 9,
  table_number: 3, table_name: "TEST 1", operational_status: "available",
  availability_status: "current_tournament", max_seats: 9, ...overrides });
const projection = (id: string) => ({ tournament_id: id, entries: [], seats: [
  { seat_id: "valid", entry_id: "entry1", player_id: "player1", player_name: `Current ${id}`, entry_number: 1,
    table_id: "table", tournament_table_id: "table", table_session_id: "current", table_name: "TEST 1",
    seat_number: 1, chip_count: 20000, is_active: true, participation_status: "seated", anomaly_reason: null },
  { seat_id: "invalid", entry_id: "entry2", player_id: "player2", player_name: `Legacy ${id}`, entry_number: 1,
    table_id: "old", tournament_table_id: "old", table_session_id: "closed", table_name: "TEST old",
    seat_number: 2, chip_count: 20000, is_active: true, participation_status: "anomaly", anomaly_reason: "closed_session" },
], counts: { total_entries: 2, re_entries: 0, remaining: 2, seated: 1, waiting: 0, busted: 0,
  anomaly_entries: 1, anomaly_seats: 1, live_entry_stack: 40000, seated_stack: 20000, waiting_stack: 0 } });
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: "owner" };
  state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => name === "get_my_floor_operator_scope"
    ? Promise.resolve({ data: [{ club_id: "club", can_owner: true }], error: null })
    : name === "get_floor_tournament_table_inventory_v1" ? state.inventory(args.p_tournament_id) : state.read(args.p_tournament_id));
  state.inventory.mockResolvedValue({ data: [table()], error: null });
  state.read.mockImplementation((id: string) => Promise.resolve({ data: projection(id), error: null }));
  state.from.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [{ id: "table", table_id: "physical", floor_control_mode: "manual" }], error: null }) }) });
});
afterEach(cleanup);
describe("participation operator panel", () => {
  it("rechecks canonical mode before bust rather than trusting displayed Manual", async () => {
    state.inventory.mockResolvedValueOnce({ data: [table()], error: null })
      .mockResolvedValueOnce({ data: [table({ control_mode: "tracker", control_epoch: 3 })], error: null });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: "Sửa chip" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Loại TEST" }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Bàn Live Tracker chỉ cho phép loại khi chip đã về 0."));
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
  });
  it("does not bust after the table has reopened with a different session", async () => {
    state.inventory.mockResolvedValueOnce({ data: [table()], error: null })
      .mockResolvedValueOnce({ data: [table({ table_session_id: "reopened" })], error: null });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Loại TEST" }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Không xác minh được chế độ bàn. Hãy tải lại trước khi loại."));
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("allows the existing Manual chip action only for the exact current session", async () => {
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: "Sửa chip" })).toBeEnabled();
    expect(state.from).not.toHaveBeenCalled();
  });
  it.each([
    ["missing", []],
    ["reopened session", [table({ table_session_id: "next-session" })]],
    ["different logical table", [table({ tournament_table_id: "other" })]],
    ["repair required", [table({ availability_status: "repair_required" })]],
  ])("blocks chip editing when canonical context is %s", async (_label, rows) => {
    state.inventory.mockResolvedValue({ data: rows, error: null });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toHaveTextContent("Không xác minh được chế độ bàn.");
  });
  it("does not turn an inventory read failure into Manual authority", async () => {
    state.inventory.mockResolvedValue({ data: null, error: { message: "503" } });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("participation.loadError");
    expect(screen.queryByRole("button", { name: /Sửa chip/ })).toBeNull();
  });
  it("does not permit chip editing from legacy Manual when the exact session is Tracker", async () => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => name === "get_floor_tournament_table_inventory_v1"
      ? Promise.resolve({ data: [{ tournament_table_id: "table", game_table_id: "physical", table_session_id: "current",
        control_mode: "tracker", control_epoch: 2, revision: 9, table_number: 3, table_name: "TEST 1",
        operational_status: "available", availability_status: "current_tournament", max_seats: 9 }], error: null }) : original(name, args));
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toHaveTextContent("Bàn Live Tracker do Tracker quản lý chip.");
  });
  it("does not offer anomaly player actions but keeps the row visible in repair group", async () => {
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await screen.findByText("Current a");
    expect(screen.queryByText("Legacy a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /participation.repairRequired/ }));
    expect(screen.getByText(/Legacy a/).closest("button")).toBeNull();
    expect(screen.getByText(/participation.reasons.closed_session/)).toBeInTheDocument();
  });
  it("shows read failure explicitly instead of zero or an endless skeleton", async () => {
    state.read.mockResolvedValue({ data: null, error: { message: "503" } });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("participation.loadError");
    expect(screen.queryByText("Chưa có người chơi đang hoạt động.")).toBeNull();
  });
  it("discards delayed previous-tournament response", async () => {
    let resolveA!: (value: unknown) => void;
    state.read.mockImplementation((id: string) => id === "a" ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve({ data: projection(id), error: null }));
    const view = render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await waitFor(() => expect(state.read).toHaveBeenCalledWith("a"));
    view.rerender(<PlayersGroupedPanel tournament={tour("b")} refreshTrigger={0} />);
    await screen.findByText("Current b");
    resolveA({ data: projection("a"), error: null });
    await waitFor(() => expect(screen.queryByText("Current a")).toBeNull());
    expect(screen.getByText("Current b")).toBeInTheDocument();
  });
});
