import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChipOpsWorkspaceView } from "./ChipOpsWorkspaceView";
import type { IssuedChipInventory } from "./chipOpsReadAdapter";

function renderView(inventory: IssuedChipInventory) {
  return render(
    <ChipOpsWorkspaceView
      clubName="Test Club"
      tournaments={[{ id: "tournament-1", name: "Main Event", status: "running", startTime: null }]}
      selectedTournamentId="tournament-1"
      inventory={inventory}
      stacks={{
        templates: [{ id: "standard", name: "Standard", stackValue: 50000, issuedCount: 1 }],
        totalIssuedStacks: 1,
      }}
      loading={false}
      errorCode={null}
      onSelectTournament={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
}

const baseInventory: IssuedChipInventory = {
  tournamentId: "tournament-1",
  denominations: [{ denominationId: "red-100", value: 100, color: "Red", issuedCount: 24 }],
  totalIssuedChips: 24,
  totalValue: 2400,
  reconciliationValue: 2400,
  reconciled: true,
};

describe("ChipOpsWorkspaceView", () => {
  it("shows issued chip counts and face value without implying physical stock", () => {
    renderView(baseInventory);

    expect(screen.queryByText("Issued chips by denomination")).not.toBeNull();
    expect(screen.queryByText("Issued chip face value")).not.toBeNull();
    expect(screen.queryByText("Standard · 50,000 face value per set")).not.toBeNull();
    expect(screen.getAllByText("Issued mix reconciliation")).toHaveLength(2);
    const faceValueMetric = screen.getByText("Issued chip face value").parentElement;
    expect(faceValueMetric?.textContent).toContain("2,400");
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Physical stock not recorded/)).not.toBeNull();
    expect(screen.queryByText("Not recorded")).not.toBeNull();
    expect(screen.queryByText("Available", { exact: true })).toBeNull();
    expect(screen.queryByText("Chip value only · not cash or a prize pool")).not.toBeNull();
  });

  it("shows a clear empty state when the snapshot has no issued denominations", () => {
    renderView({ ...baseInventory, denominations: [], totalIssuedChips: 0, totalValue: 0 });

    expect(screen.getByRole("status").textContent).toContain("No issued denomination rows in this snapshot.");
    expect(screen.getByRole("status").textContent).toContain("Physical stock not recorded.");
  });
});
