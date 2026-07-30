import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const flagState = vi.hoisted(() => ({ unified: false }));

vi.mock("@/lib/featureFlags", async (importOriginal) => {
  const actual = await importOriginal<{
    FEATURES: Record<string, unknown>;
  }>();
  return {
    ...actual,
    FEATURES: {
      ...actual.FEATURES,
      get trackerUnifiedOpsFlow() {
        return flagState.unified;
      },
    },
  };
});

vi.mock(
  "@/components/cashier/tournament-live/handinput/HandInputConsole",
  () => ({
    HandInputConsole: ({ tournamentId }: { tournamentId: string }) => (
      <div data-testid="legacy-hand-writer">{tournamentId}</div>
    ),
  }),
);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "fixture-user" },
    loading: false,
    isAdmin: false,
    isClubOwner: false,
    isTracker: true,
    isFloor: false,
    isChipMaster: false,
  }),
}));

import { TrackerHandInputBoundary } from "@/components/cashier/tournament-live/handinput/unified/TrackerHandInputBoundary";
import { TrackerUnifiedOpsFixtureShell } from "@/components/cashier/tournament-live/handinput/unified/TrackerUnifiedOpsFixtureShell";
import { TRACKER_UNIFIED_FIXTURE_IDS } from "@/lib/tracker-unified-ops/fixtures";
import TrackerHandInputConsole from "@/pages/TrackerHandInputConsole";

beforeEach(() => {
  flagState.unified = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Tracker Unified Ops V2 UI boundary", () => {
  it("keeps the legacy embedded writer mounted when the flag is OFF", () => {
    render(
      <MemoryRouter>
        <TrackerHandInputBoundary tournamentId="legacy-tournament" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("legacy-hand-writer")).toHaveTextContent(
      "legacy-tournament",
    );
    expect(
      screen.queryByTestId("tracker-unified-ops-shell"),
    ).not.toBeInTheDocument();
  });

  it("unmounts the legacy embedded writer when the flag is ON", () => {
    flagState.unified = true;
    render(
      <MemoryRouter>
        <TrackerHandInputBoundary tournamentId="fixture-tournament" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("tracker-unified-ops-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-hand-writer")).not.toBeInTheDocument();
  });

  it("renders the exact tracker view with read-only roster and a disabled writer", () => {
    render(
      <MemoryRouter>
        <TrackerUnifiedOpsFixtureShell
          tournamentId={TRACKER_UNIFIED_FIXTURE_IDS.tournament}
          tournamentTableId={
            TRACKER_UNIFIED_FIXTURE_IDS.readyTournamentTable
          }
          role="tracker"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("tracker-ops-status-rail")).toBeInTheDocument();
    expect(screen.getByTestId("tracker-readonly-roster")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Bắt đầu Hand #18/ }),
    ).toBeDisabled();
    expect(screen.queryByText("Sửa chip")).not.toBeInTheDocument();
  });

  it("keeps Floor in read-only handoff mode", () => {
    render(
      <MemoryRouter>
        <TrackerUnifiedOpsFixtureShell
          tournamentId={TRACKER_UNIFIED_FIXTURE_IDS.tournament}
          tournamentTableId={
            TRACKER_UNIFIED_FIXTURE_IDS.readyTournamentTable
          }
          role="floor"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: /Mở Floor xử lý bàn/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Bắt đầu Hand/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the standalone legacy page on its original tournament parameter while OFF", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/tracker/hand-input?tournament=legacy-standalone",
        ]}
      >
        <TrackerHandInputConsole />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("legacy-hand-writer")).toHaveTextContent(
      "legacy-standalone",
    );
  });

  it("uses the new shell and never mounts the standalone writer while ON", () => {
    flagState.unified = true;
    render(
      <MemoryRouter
        initialEntries={[
          `/tracker/hand-input?t=${TRACKER_UNIFIED_FIXTURE_IDS.tournament}`,
        ]}
      >
        <TrackerHandInputConsole />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("tracker-table-launcher")).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-hand-writer")).not.toBeInTheDocument();
  });
});
