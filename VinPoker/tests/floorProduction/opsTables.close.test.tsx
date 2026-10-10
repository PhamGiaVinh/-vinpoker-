import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import OpsTables from "@/pages/ops/OpsTables";

const f = vi.hoisted(() => ({ actor: "owner", tour: "tour", rpc: vi.fn(), reload: vi.fn(), flags: { floorTableControlV3: false, floorTableOps: true },
  tours: [{ id: "tour", club_id: "club", name: "TEST", status: "live" }],
  tables: [{ tt_id: "logical", table_id: "physical", table_name: "Bàn TEST", table_number: 1, max_seats: 9, floor_control_mode: "manual" }],
  seats: {}, readOnlyReason: null as string | null, repairWarnings: [] as string[] }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: f.flags }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: { id: f.actor } }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => ({ loading: false, clubs: [], floorClubIds: ["club"], isSuperAdmin: false }) }));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({ useOpsWorkspace: () => ({ selectedClubId: "club" }) }));
vi.mock("@/hooks/useTournaments", () => ({ useTournaments: () => ({ data: f.tours, isLoading: false }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => ({ rpc: f.rpc }) }));
vi.mock("@/components/ops/shared/useFloorSeats", () => ({ useFloorSeats: () => ({ tables: f.tables, seatsByTable: f.seats, loading: false, error: null, reload: f.reload,
  readOnlyReason: f.readOnlyReason, repairWarnings: f.repairWarnings }) }));
vi.mock("@/components/ops/shared/floorAdapter", () => ({ toMockTable: () => ({ tableNo: 1, max: 9, status: "open" }), toMockSeat: (s: any) => s }));
vi.mock("@/components/ops/shared/FloorTableRosterIndex", () => ({ FloorTableRosterIndex: (p: any) => <button onClick={() => p.onOpen("logical")}>Ouvrir TEST</button> }));
vi.mock("@/components/ops/shared/FloorSeatRoster", () => ({ FloorSeatRoster: () => null }));
vi.mock("@/components/ops/shared/FloorTableControlMode", () => ({ FloorTableControlModeControl: () => null }));
vi.mock("@/components/ops/shared/FloorPlayerActions", () => ({ FloorPlayerActions: () => null }));
vi.mock("@/components/cashier/tournament-live/OpenTableDialog", () => ({ OpenTableDialog: () => null }));
vi.mock("@/components/cashier/tournament-live/FloorTableMapPanelV3", () => ({ FloorTableMapPanelV3: () => null }));
vi.mock("@/components/cashier/tournament-live/CloseTableDialog", () => ({ CloseTableDialog: (p: any) => p.open ?
  <div>canonical-close:{p.actorId}:{p.tournamentId}:{p.tableTtId}<button onClick={p.onDone}>Closed canonical</button></div> : null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { f.actor = "owner"; f.flags.floorTableOps = true; f.rpc.mockReset(); f.reload.mockReset();
  f.readOnlyReason = null; f.repairWarnings = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; }); });
it("preserves the map but disables writes and displays unresolved occupied-seat warnings", async () => {
  f.readOnlyReason = "Có dữ liệu cần sửa";
  f.repairWarnings = ["Bàn TEST, ghế 3, Player: missing_entry"];
  render(<MemoryRouter><OpsTables tournamentId="tour" /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("missing_entry");
  fireEvent.click(screen.getByText("Ouvrir TEST"));
  expect(screen.getByRole("button", { name: "Đóng bàn" })).toBeDisabled();
  expect(f.rpc).not.toHaveBeenCalled();
});
it("unmounts an already-open close writer while canonical data becomes unverified", async () => {
  const view = render(<MemoryRouter><OpsTables tournamentId="tour" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("Ouvrir TEST"));
  fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
  expect(await screen.findByText("canonical-close:owner:tour:logical")).toBeInTheDocument();
  f.readOnlyReason = "Đang tải lại";
  view.rerender(<MemoryRouter><OpsTables tournamentId="tour" /></MemoryRouter>);
  expect(screen.queryByText("canonical-close:owner:tour:logical")).toBeNull();
  expect(f.rpc).not.toHaveBeenCalled();
});
it("hands the exact logical table and actor to the canonical close dialog", async () => {
  render(<MemoryRouter><OpsTables tournamentId="tour" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("Ouvrir TEST"));
  fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
  expect(await screen.findByText("canonical-close:owner:tour:logical")).toBeInTheDocument();
  expect(f.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Closed canonical"));
  expect(f.reload).toHaveBeenCalledTimes(1);
});
it("does not bypass the legacy surface action flag", async () => {
  f.flags.floorTableOps = false;
  render(<MemoryRouter><OpsTables tournamentId="tour" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("Ouvrir TEST"));
  const close = screen.getByRole("button", { name: "Đóng bàn" });
  expect(close).toBeDisabled(); fireEvent.click(close);
  await waitFor(() => expect(screen.queryByText(/canonical-close:/)).toBeNull());
  expect(f.rpc).not.toHaveBeenCalled();
});
it("does not adopt an open close intent under another actor", async () => {
  const v = render(<MemoryRouter><OpsTables tournamentId="tour" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("Ouvrir TEST"));
  fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
  expect(await screen.findByText("canonical-close:owner:tour:logical")).toBeInTheDocument();
  f.actor = "other";
  v.rerender(<MemoryRouter><OpsTables tournamentId="tour" /></MemoryRouter>);
  expect(screen.queryByText(/canonical-close:/)).toBeNull();
  expect(f.rpc).not.toHaveBeenCalled();
});
