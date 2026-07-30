import { describe, expect, it } from "vitest";
import {
  FLOOR_WORKSPACE_TABS,
  floorTournamentPath,
  floorWorkspaceParentPath,
} from "@/ops/floor/floorWorkspaceRoutes";

describe("Floor workspace route contract", () => {
  it("has one canonical five-tab tournament tree", () => {
    expect(FLOOR_WORKSPACE_TABS.map((tab) => tab.key)).toEqual([
      "tables",
      "players",
      "clock",
      "payout",
      "screens",
    ]);
    expect(floorTournamentPath("tour-1")).toBe("/ops/floor/tournaments/tour-1/tables");
    expect(floorTournamentPath("tour-1", "players")).toBe("/ops/floor/tournaments/tour-1/players");
  });

  it("uses an explicit parent instead of browser history", () => {
    expect(floorWorkspaceParentPath()).toBe("/ops/floor");
  });
});
