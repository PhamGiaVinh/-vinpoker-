import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorTournamentTableRoster } from "@/lib/floorTableControlV3";
const state = vi.hoisted(() => ({ user: { id: "owner-a" }, roster: vi.fn(), entries: vi.fn(), restore: vi.fn(), supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => state.supabase }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => ({
  getTournamentTableRoster: state.roster, getRestorableEntries: state.entries, restoreBustedPlayer: state.restore,
}) }));
import { RestoreBustDialog } from "./RestoreBustDialog";
const target = { entryId: "entry-a", name: "TEST Alice" };
const table: FloorTournamentTableRoster = {
  tournamentId: "tour-a", tournamentTableId: "tt-a", gameTableId: "physical-a", tableNumber: 1, tableName: "Bàn TEST 1",
  tableSessionId: "session-a", sessionRevision: 7, controlMode: "manual", controlEpoch: 2, maxSeats: 8,
  tournamentTableStatus: "active", sessionClosedAt: null, activeDealerAssignmentId: null,
  seats: [], seatLocks: [{ seatNumber: 2, reason: "TEST lock", lockedAt: "2026-10-09T00:00:00Z", lockedBy: "owner-a" }],
};
function mount() {
  const onRestored = vi.fn(); const onClose = vi.fn();
  const view = render(<RestoreBustDialog tournamentId="tour-a" target={target} onRestored={onRestored} onClose={onClose} />);
  return { ...view, onRestored, onClose };
}
async function choose() {
  await screen.findByText(/25,000|25.000|25 000/);
  fireEvent.change(screen.getByLabelText("Bàn khôi phục"), { target: { value: "tt-a" } });
  fireEvent.change(screen.getByLabelText("Ghế khôi phục"), { target: { value: "1" } });
}
beforeEach(() => {
  vi.clearAllMocks(); state.user = { id: "owner-a" };
  state.roster.mockResolvedValue({ ok: true, data: [table] });
  state.entries.mockResolvedValue({ ok: true, data: [{ entryId: "entry-a", currentStack: 25000 }] });
  state.restore.mockResolvedValue({ ok: true, data: {} });
});
afterEach(cleanup);
describe("mistaken-bust restore", () => {
  it("shows evidenced stack, excludes locked seats and submits exact session fences", async () => {
    const view = mount(); await choose();
    expect(screen.queryByRole("option", { name: "Ghế 2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await waitFor(() => expect(view.onRestored).toHaveBeenCalledOnce());
    expect(state.restore).toHaveBeenCalledWith(expect.objectContaining({ entryId: "entry-a", toTournamentTableId: "tt-a",
      toSeatNumber: 1, expectedRevision: 7, expectedControlEpoch: 2, requestId: expect.any(String) }));
  });
  it("replays the identical intent after response loss without duplicate automatic calls", async () => {
    state.restore.mockRejectedValueOnce(new Error("response lost"));
    const view = mount(); await choose();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" }));
    await screen.findByRole("alert");
    expect(state.restore).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Bàn khôi phục")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đã gửi" }));
    await waitFor(() => expect(view.onRestored).toHaveBeenCalledOnce());
    expect(state.restore.mock.calls[1][0]).toEqual(state.restore.mock.calls[0][0]);
  });
  it("does not submit or invent stack when evidence is unavailable", async () => {
    state.entries.mockResolvedValue({ ok: true, data: [] }); mount();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Xác nhận hoàn tác bust" })).toBeDisabled();
    expect(state.restore).not.toHaveBeenCalled();
  });
});
