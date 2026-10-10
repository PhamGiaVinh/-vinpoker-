import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import { useFloorSeats } from "./useFloorSeats";

const auth = vi.hoisted(() => ({ actor: "actor-A" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.actor ? { id: auth.actor } : null }) }));
// Model the established inventory client boundary; participation parser and hook are real.
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: (rpc: Function) => ({
  getTournamentTableInventory: async (id: string) => {
    const result = await rpc("get_floor_tournament_table_inventory_v1", { p_tournament_id: id });
    return result.error ? { ok: false, error: result.error.message } : { ok: true, data: result.data };
  },
}) }));

const inventory = [{ gameTableId: "physical", tournamentTableId: "logical", tableSessionId: "session",
  tableNumber: 2, tableName: "Bàn 2", operationalStatus: "available", availabilityStatus: "current_tournament",
  controlMode: "tracker", controlEpoch: 7, revision: 12, maxSeats: 9 }];
const participation = (tour: string) => ({ tournament_id: tour, entries: [], seats: [], counts: {
  total_entries: 0, re_entries: 0, remaining: 0, seated: 0, waiting: 0, busted: 0,
  anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 0, seated_stack: 0, waiting_stack: 0,
} });
function setup(rpc: ReturnType<typeof vi.fn>) {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  const client = { rpc, channel: vi.fn(() => channel), removeChannel: vi.fn() };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SupabaseClientProvider client={client as never}>{children}</SupabaseClientProvider>
  );
  return { wrapper, client, channel };
}
afterEach(cleanup);
beforeEach(() => { auth.actor = "actor-A"; });

describe("useFloorSeats canonical scope fencing", () => {
  it("keeps a mixed-session inventory/participation snapshot read-only without pretending the seat is empty", async () => {
    const rpc = vi.fn(async (name, args) => ({ error: null, data: name === "get_floor_tournament_table_inventory_v1"
      ? inventory : { ...participation(args.p_tournament_id), seats: [{
        seat_id: "old-seat", entry_id: "entry", player_id: "player", player_name: "Still occupied",
        entry_number: 1, table_id: "logical", tournament_table_id: "logical", table_session_id: "previous-session",
        table_name: "Bàn 2", seat_number: 1, chip_count: 20000, is_active: true,
        participation_status: "seated", anomaly_reason: null,
      }] } }));
    const { wrapper } = setup(rpc);
    const { result } = renderHook(() => useFloorSeats("tour"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.repairWarnings?.length).toBeGreaterThan(0));
    expect(result.current.tables[0].table_session_id).toBe("session");
    expect(result.current.readOnlyReason).toContain("Có dữ liệu cần sửa");
    expect(result.current.repairWarnings?.join(" ")).toContain("Still occupied");
    expect(result.current.seatsByTable.physical).toBeUndefined();
  });
  it("invalidates writer readiness immediately on a session event, before the debounce read", async () => {
    const rpc = vi.fn(async (name, args) => ({ error: null,
      data: name === "get_floor_tournament_table_inventory_v1" ? inventory : participation(args.p_tournament_id) }));
    const { wrapper, channel } = setup(rpc);
    const { result } = renderHook(() => useFloorSeats("tour"), { wrapper });
    await waitFor(() => expect(result.current.tables).toHaveLength(1));
    expect(result.current.readOnlyReason).toBeNull();
    const sessionSubscription = channel.on.mock.calls.find(([, filter]) => filter.table === "table_sessions");
    expect(sessionSubscription).toBeDefined();
    await act(async () => { sessionSubscription![2](); });
    expect(result.current.readOnlyReason).toContain("Đang xác minh");
    expect(result.current.tables).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.readOnlyReason).toBeNull());
  });
  it("reads canonical inventory and participation, not the legacy Edge projection", async () => {
    const rpc = vi.fn(async (name, args) => ({ error: null,
      data: name === "get_floor_tournament_table_inventory_v1" ? inventory : participation(args.p_tournament_id) }));
    const { wrapper } = setup(rpc);
    const { result } = renderHook(() => useFloorSeats("tour"), { wrapper });
    await waitFor(() => expect(result.current.tables).toHaveLength(1));
    expect(result.current.tables[0]).toMatchObject({ table_session_id: "session", control_epoch: 7,
      floor_control_mode: "tracker", floor_control_revision: 12 });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "get_floor_tournament_table_inventory_v1", "get_tournament_participation_v1",
    ]);
  });
  it("does not expose the previous actor's last-good tables after the new actor read fails", async () => {
    const rpc = vi.fn(async (name, args) => auth.actor === "actor-B"
      ? { error: { message: "503" }, data: null }
      : { error: null, data: name === "get_floor_tournament_table_inventory_v1" ? inventory : participation(args.p_tournament_id) });
    const { wrapper } = setup(rpc);
    const { result, rerender } = renderHook(() => useFloorSeats("tour"), { wrapper });
    await waitFor(() => expect(result.current.tables).toHaveLength(1));
    auth.actor = "actor-B";
    rerender();
    await waitFor(() => expect(result.current.error).toBe("503"));
    expect(result.current.tables).toEqual([]);
  });
  it("drops an old tournament response that finishes after the new scope", async () => {
    let release!: (value: unknown) => void;
    const delayed = new Promise((resolve) => { release = resolve; });
    const rpc = vi.fn(async (name, args) => {
      if (name === "get_tournament_participation_v1" && args.p_tournament_id === "old") return delayed;
      return { error: null, data: name === "get_floor_tournament_table_inventory_v1"
        ? inventory : participation(args.p_tournament_id) };
    });
    const { wrapper } = setup(rpc);
    const { result, rerender } = renderHook(({ tour }) => useFloorSeats(tour), { wrapper, initialProps: { tour: "old" } });
    rerender({ tour: "new" });
    await waitFor(() => expect(result.current.tables).toHaveLength(1));
    await act(async () => { release({ error: null, data: participation("old") }); });
    expect(result.current.error).toBeNull();
    expect(result.current.tables[0].table_session_id).toBe("session");
  });
});
