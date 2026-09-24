import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panel = readFileSync(
  resolve(process.cwd(), "src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx"),
  "utf8",
);
const flags = readFileSync(resolve(process.cwd(), "src/lib/featureFlags.ts"), "utf8");

describe("Floor Free Sit V1 UI contract", () => {
  it("shows concise player actions before destination controls", () => {
    expect(panel).toContain('data-ops-action="floor.player.open_move"');
    expect(panel).toContain('data-ops-action="floor.player.move"');
    expect(panel).toContain('data-ops-action="floor.player.open_free_sit"');
    expect(panel).toContain('data-ops-action="floor.player.open_bust"');
    expect(panel).toContain("{moveOpen && (");
    expect(panel).toContain("Rời ghế");
  });

  it("explains the preserved stack and Waiting transition before confirmation", () => {
    expect(panel).toContain("giữ nguyên chip và trở về danh sách chờ");
    expect(panel).toContain("Chip giữ lại");
    expect(panel).toContain("Xác nhận rời ghế");
    expect(panel).toContain("break-all font-semibold");
    expect(panel).toContain("Chuyển ${selectedTable?.seats.length ?? 0} người sang bàn còn chỗ");
    expect(panel).not.toContain("Server sẽ kiểm tra sức chứa");
  });

  it("keeps the write path behind the explicit Free Sit flag", () => {
    expect(flags).toContain("floorFreeSitV1: true");
    expect(panel).toContain("FEATURES.floorFreeSitV1");
  });
});
