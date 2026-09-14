import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const hookSource = readFileSync(resolve(root, "src/hooks/useDealerSwing.ts"), "utf8");
const panelSource = readFileSync(resolve(root, "src/components/cashier/DealerSwingTab.tsx"), "utf8");

describe("Dealer Swing Floor V3 inventory convergence", () => {
  it("reads the authoritative club table inventory while Floor V3 is enabled", () => {
    expect(hookSource).toContain("getClubTableInventory");
    expect(hookSource).toContain("projectDealerOperationalTable");
    expect(hookSource).toContain('"table_sessions", "tournament_tables", "dealer_assignments"');
  });

  it("opens and closes cash or VIP sessions through the fixed Floor V3 adapter", () => {
    expect(panelSource).toContain("floorV3.openClubTables");
    expect(panelSource).toContain("floorV3.closeClubTable");
    expect(panelSource).toContain("Bàn giải phải được mở trong Floor");
  });

  it("blocks legacy bulk and tour close paths while Floor V3 owns sessions", () => {
    expect(panelSource).toContain("không thể dùng đường đóng bàn legacy");
    expect(panelSource).toContain("Đóng hàng loạt đang khóa để tránh bỏ qua phiên bàn V3");
    expect(panelSource).toContain("Hãy đóng từng bàn giải trong Floor trước khi lưu trữ Swing");
  });
});
