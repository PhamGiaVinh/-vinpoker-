import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(cleanup);

// Stub both panels so we test ONLY the flag gate (no supabase / no engine).
vi.mock("@/components/cashier/tournament-live/PrizeStructurePanel", () => ({ PrizeStructurePanel: () => <div>OLD_MANUAL_PANEL</div> }));
vi.mock("@/components/cashier/tournament-live/PayoutEnginePanel", () => ({ PayoutEnginePanel: () => <div>ENGINE_PANEL</div> }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { payoutEngine: false } }));

import { PrizesTab } from "../PrizesTab";
import { FEATURES } from "@/lib/featureFlags";

describe("PrizesTab — payoutEngine flag gate", () => {
  it("flag OFF (default) → old PrizeStructurePanel renders unchanged", () => {
    (FEATURES as any).payoutEngine = false;
    render(<PrizesTab tournamentId="t1" />);
    expect(screen.getByText("OLD_MANUAL_PANEL")).toBeInTheDocument();
    expect(screen.queryByText("ENGINE_PANEL")).not.toBeInTheDocument();
  });

  it("flag ON → PayoutEnginePanel renders", () => {
    (FEATURES as any).payoutEngine = true;
    render(<PrizesTab tournamentId="t1" />);
    expect(screen.getByText("ENGINE_PANEL")).toBeInTheDocument();
    expect(screen.queryByText("OLD_MANUAL_PANEL")).not.toBeInTheDocument();
    (FEATURES as any).payoutEngine = false; // restore default
  });
});
