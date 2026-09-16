import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Floor hand correction workspace boundary", () => {
  it("keeps the Floor dialog on the shared workspace and outside the player app client", () => {
    const lane = read("src/components/cashier/tournament-live/TrackerFloorAlertLane.tsx");
    const workspace = read("src/components/cashier/tournament-live/HandHistoryWorkspace.tsx");
    const clientResolver = read("src/lib/tracker-poker/handPlayerNamesClient.ts");

    expect(lane).toContain("HandHistoryWorkspace");
    expect(lane).toContain("Kiểm tra & sửa hand");
    expect(workspace).not.toContain("@/integrations/supabase/client");
    expect(workspace).toContain("buttonSeat={selectedHand.button_seat ?? 0}");
    expect(clientResolver).not.toContain("@/integrations/supabase/client");
  });
});
