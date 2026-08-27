import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Floor Table Control V3 writer convergence source guards", () => {
  it("keeps the V3 source flag OFF and routes V3 browser calls through one fixed adapter", () => {
    const flags = read("src/lib/featureFlags.ts");
    const adapter = read("src/lib/floorTableControlV3.ts");

    expect(flags).toMatch(/floorTableControlV3:\s*false/);
    expect(adapter).toContain("FLOOR_TABLE_CONTROL_V3_DISABLED");
    expect(adapter).toContain('"floor_open_tournament_table_v3"');
    expect(adapter).toContain('"validate_tracker_table_writer_context_v3"');
    expect(adapter).not.toContain("rpc(name: string");
  });

  it("does not retain a browser game_tables update fallback in Dealer Swing", () => {
    const dealerSwing = read("src/components/cashier/DealerSwingTab.tsx");
    expect(dealerSwing).not.toMatch(/from\(["']game_tables["']\)\.update\(/);
    expect(dealerSwing).not.toContain('massOpenGate === "legacy"');
  });

  it("uses physical inventory and game_table_id when the future V3 opener is enabled", () => {
    const opener = read("src/components/cashier/tournament-live/OpenTableDialog.tsx");

    expect(opener).toContain("getClubTableInventory");
    expect(opener).toContain("v3GameTableIdByNumber");
    expect(opener).toContain("openTournamentTable");
    expect(opener).toContain("missingState={tableControlV3.enabled ? \"unavailable\" : \"available\"}");
  });
});
