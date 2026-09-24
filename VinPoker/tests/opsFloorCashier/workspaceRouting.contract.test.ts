import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(repo, path), "utf8");

describe("Ops Floor and Cashier workspace routing", () => {
  it("declares every canonical tournament workspace route exactly once", () => {
    const app = source("src/OpsApp.tsx");
    for (const section of ["tables", "players", "clock", "payout", "screens"]) {
      const route = `path="/ops/floor/tournaments/:id/${section}"`;
      expect(app.split(route)).toHaveLength(2);
    }
    expect(app).toContain("<OpsTournamentScopeGate>");
    expect(app).toContain('path="/ops/tables" element={<Navigate to="/ops/floor" replace />}');
  });

  it("checks the selected club before mounting a tournament child route", () => {
    const gate = source("src/ops/auth/OpsTournamentScopeGate.tsx");
    expect(gate).toContain("!selectedClubId || selectedScope.length === 0");
    expect(gate).toContain('.eq("club_id", selectedClubId)');
    expect(gate).toContain("data.club_id === selectedClubId");
    expect(gate).toContain("<TournamentOpsProvider snapshot={snapshot}>");
  });

  it("keeps club context in canonical links and never uses browser-history back", () => {
    const files = [
      "src/ops/floor/FloorTournamentWorkspace.tsx",
      "src/pages/ops/OpsTables.tsx",
      "src/pages/ops/OpsTournamentCockpit.tsx",
      "src/pages/ops/OpsTournaments.tsx",
    ];
    const combined = files.map(source).join("\n");
    expect(combined).toContain("encodeURIComponent");
    expect(combined).not.toContain("navigate(-1)");
    expect(combined).not.toContain("?tab=");
  });

  it("derives Cashier reads from the selected authorized club only", () => {
    const cashier = source("src/pages/ops/OpsCashier.tsx");
    expect(cashier).toContain("selectedClubId");
    expect(cashier).toContain("allowedClubIds.includes(selectedClubId)");
    expect(cashier).toContain('.eq("club_id", clubId)');
    expect(cashier).not.toContain("allowedClubIds[0]");
  });

  it("mounts Tour Cashier behind its own build gate and cashier capability", () => {
    const app = source("src/OpsApp.tsx");
    const mutations = source("src/ops/opsMutations.ts");
    const flags = source("src/lib/featureFlags.ts");
    const shell = source("src/components/ops/OpsShell.tsx");
    const workbench = source("src/pages/ops/TourCashierWorkbench.tsx");
    const cashier = source("src/pages/ops/OpsCashier.tsx");
    expect(app).toContain('path="/ops/cashier/tour"');
    expect(app).toContain('element={OPS_TOUR_CASHIER_ENABLED');
    expect(app).toContain('<OpsModuleGate capability="cashier"><TourCashierWorkbench /></OpsModuleGate>');
    expect(app).toContain('<Navigate to="/ops/cashier" replace />');
    expect(shell).toContain('&& OPS_TOUR_CASHIER_ENABLED');
    expect(cashier).toContain('OPS_TOUR_CASHIER_ENABLED &&');
    expect(cashier).toContain('Mở quầy Buy-in theo tour');
    expect(workbench).toContain('!OPS_TOUR_CASHIER_ENABLED');
    expect(workbench).toContain('|| !OPS_TOUR_CASHIER_ENABLED');
    expect(flags).toContain('OPS_TOUR_CASHIER_ENABLED = isTourCashierBuildEnabled(import.meta.env.VITE_OPS_TOUR_CASHIER)');
    expect(mutations).toContain('import.meta.env.VITE_OPS_CASHIER_MUTATIONS === "preview" &&');
    expect(mutations).toContain('import.meta.env.VITE_FLOOR_UAT_ENV === "preview"');
  });
});
