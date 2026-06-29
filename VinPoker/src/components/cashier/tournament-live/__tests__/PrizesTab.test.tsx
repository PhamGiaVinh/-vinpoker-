import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(cleanup);

// Stub both panels so we test ONLY the gate (no supabase / no engine).
vi.mock("@/components/cashier/tournament-live/PrizeStructurePanel", () => ({ PrizeStructurePanel: () => <div>OLD_MANUAL_PANEL</div> }));
vi.mock("@/components/cashier/tournament-live/PayoutEnginePanel", () => ({ PayoutEnginePanel: () => <div>ENGINE_PANEL</div> }));

// Mock featureFlags with a MUTABLE FEATURES, and delegate the gate to the REAL helper (no logic
// duplication) by injecting that mutable FEATURES. Tests flip the values per scenario.
vi.mock("@/lib/featureFlags", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/featureFlags")>();
  const FEATURES = { payoutEngine: false, payoutEngineAllClubs: false, payoutEngineClubs: [] as string[] };
  return {
    ...actual,
    FEATURES,
    isPayoutEngineEnabledForClub: (clubId?: string | null) => actual.isPayoutEngineEnabledForClub(clubId, FEATURES),
  };
});

import { PrizesTab } from "../PrizesTab";
import { FEATURES } from "@/lib/featureFlags";

const CLUB = "club-A";

beforeEach(() => {
  (FEATURES as any).payoutEngine = false;
  (FEATURES as any).payoutEngineAllClubs = false;
  (FEATURES as any).payoutEngineClubs = [];
});

describe("PrizesTab — per-club payout-engine gate", () => {
  it("global flag OFF → old PrizeStructurePanel (even if the club is allow-listed)", () => {
    (FEATURES as any).payoutEngine = false;
    (FEATURES as any).payoutEngineClubs = [CLUB]; // master OFF must win
    render(<PrizesTab tournamentId="t1" clubId={CLUB} />);
    expect(screen.getByText("OLD_MANUAL_PANEL")).toBeInTheDocument();
    expect(screen.queryByText("ENGINE_PANEL")).not.toBeInTheDocument();
  });

  it("global ON but club NOT allow-listed → old PrizeStructurePanel", () => {
    (FEATURES as any).payoutEngine = true;
    (FEATURES as any).payoutEngineClubs = []; // no club enabled
    render(<PrizesTab tournamentId="t1" clubId={CLUB} />);
    expect(screen.getByText("OLD_MANUAL_PANEL")).toBeInTheDocument();
    expect(screen.queryByText("ENGINE_PANEL")).not.toBeInTheDocument();
  });

  it("global ON and club allow-listed → PayoutEnginePanel", () => {
    (FEATURES as any).payoutEngine = true;
    (FEATURES as any).payoutEngineClubs = [CLUB];
    render(<PrizesTab tournamentId="t1" clubId={CLUB} />);
    expect(screen.getByText("ENGINE_PANEL")).toBeInTheDocument();
    expect(screen.queryByText("OLD_MANUAL_PANEL")).not.toBeInTheDocument();
  });

  it("global ON, a DIFFERENT club is allow-listed → this club still gets the old panel", () => {
    (FEATURES as any).payoutEngine = true;
    (FEATURES as any).payoutEngineClubs = ["some-other-club"];
    render(<PrizesTab tournamentId="t1" clubId={CLUB} />);
    expect(screen.getByText("OLD_MANUAL_PANEL")).toBeInTheDocument();
  });

  it("global ON + payoutEngineAllClubs (wide rollout) → every club gets the engine panel", () => {
    (FEATURES as any).payoutEngine = true;
    (FEATURES as any).payoutEngineAllClubs = true;
    (FEATURES as any).payoutEngineClubs = []; // ignored when AllClubs is on
    render(<PrizesTab tournamentId="t1" clubId={CLUB} />);
    expect(screen.getByText("ENGINE_PANEL")).toBeInTheDocument();
  });
});
