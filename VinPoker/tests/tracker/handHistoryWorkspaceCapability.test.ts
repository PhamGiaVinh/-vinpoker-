import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const app = read("src/App.tsx");
const dashboard = read("src/pages/TrackerDashboard.tsx");
const layout = read("src/components/Layout.tsx");
const workspace = read("src/pages/TrackerHandHistory.tsx");
const panel = read("src/components/cashier/tournament-live/HandHistoryPanel.tsx");
const batch = read("src/components/cashier/tournament-live/HistoricalSettlementBatchControl.tsx");

describe("tracker hand history workspace capability", () => {
  it("provides a discoverable dedicated route from both tracker navigation surfaces", () => {
    expect(app).toContain('path="/tracker/history"');
    expect(dashboard).toContain('nav("/tracker/history")');
    expect(layout).toContain('nav("/tracker/history")');
    expect(workspace).toContain("Lịch sử & sửa hand");
    expect(workspace).toContain("Giải → Bàn → Hand");
  });

  it("keeps the hand editor and replay as separate 44px actions", () => {
    expect(panel).toContain("Sửa dữ liệu hand");
    expect(panel).toContain("Xem replay");
    expect(panel).toContain("min-h-11");
    expect(panel).not.toContain("No hands recorded yet");
  });

  it("loads the complete ordered hand archive rather than the old 50-hand window", () => {
    expect(panel).toContain("pageAll<HandQueryRow>");
    expect(panel).toContain('.order("created_at", { ascending: false })');
    expect(panel).toContain('.order("id", { ascending: false })');
    expect(panel).not.toContain(".limit(50)");
  });

  it("resolves both canonical and legacy physical table IDs without guessing", () => {
    expect(panel).toContain('"list_tracker_tables_v2"');
    expect(panel).toContain("tournament_table_id");
    expect(panel).toContain("physical_table_id");
    expect(panel).toContain('query.in("table_id", tableIds)');
  });

  it("keeps bulk writes fail-closed while allowing server-authoritative preview", () => {
    expect(FEATURES.trackerHistoricalSettlementDisplay).toBe(true);
    expect(FEATURES.trackerHistoricalSettlementBulk).toBe(false);
    expect(batch).toContain('mode: "preview"');
    expect(batch).toContain('mode: "commit"');
    expect(batch).toContain('"get_public_tournament_settlement"');
    expect(batch).toContain("parseReplayPublicSettlement(existing)");
    expect(batch).toContain("expected_source_revision: preview.sourceRevision");
    expect(batch).not.toMatch(/\bwinner_id\s*:/);
    expect(batch).not.toMatch(/\bending_stack\s*:/);
  });
});
