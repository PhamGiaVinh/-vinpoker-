import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloorRedrawDialogV1 } from "./FloorRedrawDialogV1";

describe("Floor redraw Continue flow", () => {
  it("reads the active server revision and continues the same immutable batch", async () => {
    const client = {
      getTournamentTableInventory: vi.fn().mockResolvedValue({ ok: true, data: [{
        gameTableId: "physical-1",
        tableNumber: 17,
        tableName: "Table 17",
        operationalStatus: "available",
        availabilityStatus: "current_tournament",
        tableSessionId: "session-1",
        controlMode: "manual",
        controlEpoch: 1,
        revision: 2,
        tournamentTableId: "assignment-1",
        maxSeats: 9,
      }] }),
      planTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: {
        batchId: "batch-1",
        status: "planned",
        targetMaxSeats: 9,
        targetTableCount: 1,
        playerCount: 1,
        movedCount: 1,
        moves: [{ entryId: "entry-1", playerName: "Player One", fromTableNumber: 17, fromSeatNumber: 1, toTableNumber: 17, toSeatNumber: 1 }],
      } }),
      applyTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: {
        batchId: "batch-1",
        status: "applied",
        targetMaxSeats: 9,
        targetTableCount: 1,
        playerCount: 1,
        movedCount: 1,
        moves: [{ entryId: "entry-1", playerName: "Player One", fromTableNumber: 17, fromSeatNumber: 1, toTableNumber: 17, toSeatNumber: 1 }],
      } }),
      getActiveTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: { batchId: "batch-1", redrawRevision: 1 } }),
      continueTournamentRedraw: vi.fn().mockResolvedValue({ ok: true, data: { clockResumed: true } }),
    };
    const onApplied = vi.fn();

    render(
      <FloorRedrawDialogV1
        open
        onOpenChange={vi.fn()}
        tournamentId="tournament-1"
        tables={[{
          tournamentId: "tournament-1",
          tournamentTableId: "assignment-1",
          gameTableId: "physical-1",
          tableNumber: 17,
          tableName: "Table 17",
          tableSessionId: "session-1",
          sessionRevision: 2,
          controlMode: "manual",
          controlEpoch: 1,
          maxSeats: 9,
          tournamentTableStatus: "active",
          sessionClosedAt: null,
          activeDealerAssignmentId: null,
          seatLocks: [],
          seats: [{ seatNumber: 1, entryId: "entry-1", playerId: "player-1", displayName: "Player One", entryNo: 1, chipCount: 30000, isActive: true }],
        }]}
        client={client as never}
        onApplied={onApplied}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Save preview" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save preview" })); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm redraw" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm redraw" })); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });

    await waitFor(() => expect(client.continueTournamentRedraw).toHaveBeenCalledWith(expect.objectContaining({
      batchId: "batch-1",
      expectedRedrawRevision: 1,
      requestId: expect.any(String),
    })));
    expect(client.getActiveTournamentRedraw).toHaveBeenCalledWith("tournament-1");
    expect(await screen.findByText("Redraw finished. The tournament clock is running again.")).toBeTruthy();
    expect(onApplied).toHaveBeenCalledTimes(2);
  });
});
