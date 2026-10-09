import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/types/tournament";
const state = vi.hoisted(() => ({ user: { id: "owner" }, read: vi.fn(),
  t: (key: string) => key,
  rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc, from: state.from } }));
vi.mock("./PlayerActionSheet", () => ({ PlayerActionSheet: () => null }));
vi.mock("./MovePlayerDialog", () => ({ MovePlayerDialog: () => null }));
vi.mock("./EditChipsDialog", () => ({ EditChipsDialog: () => null }));
vi.mock("./PlayerInfoSheet", () => ({ PlayerInfoSheet: () => null }));
vi.mock("./ManualFloorBustConfirmDialog", () => ({ ManualFloorBustConfirmDialog: () => null }));
vi.mock("./RestoreBustDialog", () => ({ RestoreBustDialog: () => null }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));
import { PlayersGroupedPanel } from "./PlayersGroupedPanel";

const tour = (id: string) => ({ id, club_id: "club", name: "TEST" }) as Tournament;
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
    ? Promise.resolve({ data: [{ club_id: "club", can_owner: true }], error: null }) : state.read(args.p_tournament_id));
  state.read.mockImplementation((id: string) => Promise.resolve({ data: projection(id), error: null }));
  state.from.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [{ id: "table", table_id: "physical", floor_control_mode: "manual" }], error: null }) }) });
});
afterEach(cleanup);
describe("participation operator panel", () => {
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
