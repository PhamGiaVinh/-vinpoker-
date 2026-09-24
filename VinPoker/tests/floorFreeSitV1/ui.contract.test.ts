import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panel = readFileSync(
  resolve(process.cwd(), "src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx"),
  "utf8",
);
const flags = readFileSync(resolve(process.cwd(), "src/lib/featureFlags.ts"), "utf8");

describe("Floor Free Sit V1 UI contract", () => {
  it("puts Free Sit beside Move and Bust in the selected-player actions", () => {
    expect(panel).toContain('data-ops-action="floor.player.move"');
    expect(panel).toContain('data-ops-action="floor.player.open_free_sit"');
    expect(panel).toContain('data-ops-action="floor.player.open_bust"');
    expect(panel).toContain("Free Sit");
  });

  it("explains the preserved stack and Waiting transition before confirmation", () => {
    expect(panel).toContain("The player stays in the tournament");
    expect(panel).toContain("Stack preserved");
    expect(panel).toContain("Confirm Free Sit");
  });

  it("keeps the new write path dark by default", () => {
    expect(flags).toContain("floorFreeSitV1: false");
    expect(panel).toContain("FEATURES.floorFreeSitV1");
  });
});
