import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FloorPlayerActions } from "@/components/ops/shared/FloorPlayerActions";

const f = vi.hoisted(() => ({ actor: "owner", read: vi.fn(), tickets: vi.fn(), proof: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => ({ rpc: f.rpc, functions: { invoke: f.invoke }, from: (table: string) => {
  const q = { select: () => q, eq: () => q, in: () => q, is: () => q, limit: f.tickets, maybeSingle: f.read }; return q;
} }) }));
vi.mock("@/components/ops/shared/PlayerActionSheets", () => ({ PlayerActionSheets: (p: any) => <><button onClick={() => p.onOpenMove?.()}>Chuyển canonical</button><button onClick={p.onOpenReceipt}>Phiếu canonical</button><button onClick={p.onBustPlayer}>Loại canonical</button><button onClick={p.onOpenBust}>Mở bust canonical</button>{p.bustInfo && <span data-testid="bust-info">{JSON.stringify(p.bustInfo)}</span>}</> }));
vi.mock("@/components/cashier/tournament-live/MovePlayerDialog", () => ({ MovePlayerDialog: (p: any) => p.open ? <div>canonical-entry:{p.entryId}</div> : null }));
vi.mock("@/components/tournament/seat/floorSeatTicketCore", () => ({ fetchCurrentFloorSeatTicketWithClient: f.proof }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: (p: any) => p.open && p.receipt ? <div>ticket:{p.receipt.receiptCode}</div> : null }));
const props = () => ({ actorId: f.actor as string | null, tournamentId: "tour", tournamentName: "TEST", tournamentDate: null,
  floor: { tables: [], seatsByTable: {}, reload: vi.fn() } as any,
  target: { seat: { seat: 1, name: "TEST", chip: "20000" }, tableNo: 1,
    real: { seat_id: "seat", player_id: "player", table_id: "table", seat_number: 1, entry_number: 1, chip_count: 20000, player_name: "TEST" } } as any,
  onClose: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); f.actor = "owner"; f.read.mockResolvedValue({ data: { id: "seat", entry_id: "entry", is_active: true }, error: null }); });
it.each(["bust", "preflight-info", "late-info"])("discards stale %s after an epoch change and fresh-ready roster", async (operation) => {
  let finish!: (value: any) => void;
  const held = new Promise(resolve => { finish = resolve; });
  f.invoke.mockResolvedValue({ data: { data: [] }, error: null });
  if (operation === "late-info") f.invoke.mockReturnValueOnce(held);
  else f.read.mockReturnValueOnce(held);
  const p = props();
  const table = { tt_id: "logical", table_id: "table", table_session_id: "session-A", control_epoch: 1,
    floor_control_mode: "manual", floor_control_revision: 3 };
  const v = render(<FloorPlayerActions {...p} floor={{ ...p.floor, tables: [table], readOnlyReason: null }} />);
  try {
    fireEvent.click(screen.getByText(operation === "bust" ? "Loại canonical" : "Mở bust canonical"));
    await waitFor(() => expect(operation === "late-info" ? f.invoke : f.read).toHaveBeenCalled());
    v.rerender(<FloorPlayerActions {...p} floor={{ ...p.floor, tables: [{ ...table, control_epoch: 2 }], readOnlyReason: null }} />);
    await act(async () => finish(operation === "late-info" ? { data: { data: [{ is_active: true }] }, error: null }
      : { data: { id: "seat", entry_id: "entry", is_active: true }, error: null }));
    expect(f.invoke.mock.calls.filter(([, args]) => args.body.action === "update_seats")).toHaveLength(0);
    expect(screen.queryByTestId("bust-info")).toBeNull();
  } finally { v.unmount(); }
});
it.each(["session", "epoch"])("does not carry an Ops move dialog into another %s", async (boundary) => {
  const p = props();
  const table = { table_id: "table", tournament_table_id: "table", table_session_id: "session-A", control_epoch: 1,
    floor_control_mode: "manual", floor_control_revision: 3 };
  const v = render(<FloorPlayerActions {...p} floor={{ ...p.floor, tables: [table] }} />);
  try {
    fireEvent.click(screen.getByText("Chuyển canonical"));
    await screen.findByText("canonical-entry:entry");
    v.rerender(<FloorPlayerActions {...p} floor={{ ...p.floor, tables: [{ ...table,
      table_session_id: boundary === "session" ? "session-B" : "session-A", control_epoch: 2 }] }} />);
    expect(screen.queryByText("canonical-entry:entry")).toBeNull();
    expect(f.rpc).not.toHaveBeenCalled();
  } finally { v.unmount(); }
});
it("does not look up a move or ticket without an authenticated host actor", () => {
  const v = render(<FloorPlayerActions {...props()} actorId={null} />);
  fireEvent.click(screen.getByText("Chuyển canonical"));
  fireEvent.click(screen.getByText("Phiếu canonical"));
  expect(f.read).not.toHaveBeenCalled();
  expect(f.proof).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
  v.unmount();
});
it("discards a late entry lookup after the host logs out", async () => {
  let done!: (r: any) => void;
  f.read.mockImplementation(() => new Promise(r => { done = r; }));
  const p = props(); const v = render(<FloorPlayerActions {...p} />);
  fireEvent.click(screen.getByText("Chuyển canonical"));
  await waitFor(() => expect(f.read).toHaveBeenCalled());
  v.rerender(<FloorPlayerActions {...p} actorId={null} />);
  await act(async () => done({ data: { id: "seat", entry_id: "entry", is_active: true }, error: null }));
  expect(screen.queryByText(/canonical-entry:/)).toBeNull();
  expect(f.rpc).not.toHaveBeenCalled(); v.unmount();
});
it("opens only the server-issued current ticket after proof verification", async () => {
  f.tickets.mockResolvedValue({ data: [{ receipt_code: "REAL-TICKET" }], error: null });
  f.proof.mockResolvedValue({ receiptCode: "REAL-TICKET", floorSeatContext: { actorId: "owner", tournamentId: "tour", entryId: "entry" } });
  const v = render(<FloorPlayerActions {...props()} />);
  fireEvent.click(screen.getByText("Phiếu canonical"));
  expect(await screen.findByText("ticket:REAL-TICKET")).toBeInTheDocument();
  expect(f.proof).toHaveBeenCalledWith(expect.anything(), { actorId: "owner", tournamentId: "tour", entryId: "entry" }, "seat");
  v.unmount();
});
it.each(["ticket_not_current", "ticket_proof_missing", "503"])("does not fabricate a ticket on server denial %s", async (error) => {
  f.proof.mockRejectedValue(new Error(error));
  const v = render(<FloorPlayerActions {...props()} />);
  fireEvent.click(screen.getByText("Phiếu canonical"));
  await waitFor(() => expect(f.proof).toHaveBeenCalled());
  expect(screen.queryByText(/ticket:/)).toBeNull(); v.unmount();
});
it("discards an old actor's completed receipt proof", async () => {
  let done!: (r: any) => void; f.proof.mockImplementation(() => new Promise(r => { done = r; }));
  const p = props(); const v = render(<FloorPlayerActions {...p} />);
  fireEvent.click(screen.getByText("Phiếu canonical"));
  await waitFor(() => expect(f.proof).toHaveBeenCalled());
  f.actor = "other"; v.rerender(<FloorPlayerActions {...p} actorId={f.actor} />);
  await act(async () => done({ receiptCode: "OLD", floorSeatContext: { actorId: "owner", tournamentId: "tour", entryId: "entry" } }));
  expect(screen.queryByText("ticket:OLD")).toBeNull(); v.unmount();
});
it("hands a verified entry to the canonical dialog without legacy mutation", async () => {
  const v = render(<FloorPlayerActions {...props()} />);
  fireEvent.click(screen.getByText("Chuyển canonical"));
  expect(await screen.findByText("canonical-entry:entry")).toBeInTheDocument();
  expect(f.rpc).not.toHaveBeenCalled(); v.unmount();
});
it("unmounts an existing move writer when its canonical context becomes read-only", async () => {
  const p = props();
  const v = render(<FloorPlayerActions {...p} />);
  fireEvent.click(screen.getByText("Chuyển canonical"));
  expect(await screen.findByText("canonical-entry:entry")).toBeInTheDocument();
  v.rerender(<FloorPlayerActions {...p} floor={{ ...p.floor, readOnlyReason: "Cần sửa dữ liệu phiên" }} />);
  expect(screen.queryByText("canonical-entry:entry")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("Cần sửa dữ liệu phiên");
  expect(f.rpc).not.toHaveBeenCalled();
  v.unmount();
});
it("does not open a move after failed entry verification", async () => {
  f.read.mockResolvedValue({ data: null, error: { message: "503" } });
  const v = render(<FloorPlayerActions {...props()} />);
  fireEvent.click(screen.getByText("Chuyển canonical"));
  await waitFor(() => expect(f.read).toHaveBeenCalled());
  expect(screen.queryByText(/canonical-entry:/)).toBeNull(); expect(f.rpc).not.toHaveBeenCalled(); v.unmount();
});
it("discards a late entry lookup after actor changes", async () => {
  let done!: (r: any) => void; f.read.mockImplementation(() => new Promise(r => { done = r; }));
  const p = props(); const v = render(<FloorPlayerActions {...p} />);
  fireEvent.click(screen.getByText("Chuyển canonical"));
  await waitFor(() => expect(f.read).toHaveBeenCalled());
  f.actor = "other"; v.rerender(<FloorPlayerActions {...p} actorId={f.actor} />);
  await act(async () => done({ data: { id: "seat", entry_id: "entry", is_active: true }, error: null }));
  expect(screen.queryByText(/canonical-entry:/)).toBeNull(); v.unmount();
});
