import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { floorAuditViewports, floorButtonCoverageManifest } from "../../e2e/floor-button-coverage.manifest";

const coverageSpec = readFileSync(resolve(process.cwd(), "e2e/floor-button-coverage.spec.ts"), "utf8");

const requiredControls = [
  "Tạo giải", "Sửa giải", "Mở giải", "Đồng hồ", "Mở bàn", "Thêm người", "Sửa chip",
  "Chuyển", "Đóng bàn", "Bốc lại", "Phiếu", "Loại", "Cho vào lại", "Xem trước (Dự kiến)",
  "Lưu mặc định cho giải này", "Tải file (Excel/CSV)", "Chốt giải", "Huỷ", "Thử lại", "Làm mới", "Xác nhận",
];

describe("Floor button coverage manifest", () => {
  it("covers every required Floor control across the browser matrix", () => {
    for (const label of requiredControls) {
      expect(floorButtonCoverageManifest.some((entry) => entry.label.includes(label))).toBe(true);
    }
    for (const viewport of floorAuditViewports) {
      expect(floorButtonCoverageManifest.some((entry) => entry.viewport === "all" || entry.viewport === viewport)).toBe(true);
    }
  });

  it("requires owned scenarios and backend/DB evidence before destructive controls may run", () => {
    for (const entry of floorButtonCoverageManifest.filter((candidate) => (
      candidate.destructive && candidate.expectedState === "enabled" && !candidate.exclusionReason
    ))) {
      expect(entry.fixtureScenario, entry.id).toBeTruthy();
      expect(entry.expectedBackendCall, entry.id).toBeTruthy();
      expect(entry.expectedDbInvariant, entry.id).toBeTruthy();
    }
  });

  it("records payout as hidden while floorAtomicPayout is off", () => {
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "atomic-payout-off",
      expectedState: "hidden",
      exclusionReason: expect.any(String),
    }));
  });

  it("keeps official payout visible but explicitly excluded from canary clicks", () => {
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "payout-official-excluded",
      expectedState: "enabled",
      destructive: true,
      expectedBackendCall: null,
      exclusionReason: expect.stringContaining("EXCLUDED_WITH_REASON"),
    }));
  });

  it("uses real routes and real backend contracts", () => {
    expect(floorButtonCoverageManifest.some((entry) => entry.route === "/ops/tournament/:id")).toBe(false);
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "clock-start",
      route: "/ops/tournaments/:id",
      expectedBackendCall: "tournament-live-clock(start)",
    }));
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "payout-preview",
      route: "/floor",
      expectedBackendCall: "compute-payouts(mode=preview)",
    }));
    expect(floorButtonCoverageManifest.some((entry) => [
      "get_tournament_close_report",
      "payout_preview",
      "save_payout_structure",
      "load_payout_template",
    ].includes(entry.expectedBackendCall ?? ""))).toBe(false);
  });

  it("requires a reason for every hidden or source-excluded control", () => {
    for (const entry of floorButtonCoverageManifest.filter((candidate) => candidate.expectedState === "hidden")) {
      expect(entry.exclusionReason, entry.id).toBeTruthy();
    }
    for (const entry of floorButtonCoverageManifest.filter((candidate) => candidate.labelPattern)) {
      expect(() => new RegExp(entry.labelPattern, "iu"), entry.id).not.toThrow();
    }
  });

  it("waits for a visible control instead of the responsive shell's hidden first control", () => {
    expect(coverageSpec).toContain("controls.filter({ visible: true })");
    expect(coverageSpec).toContain("visibleControls.first()");
    expect(coverageSpec).not.toContain("controls.first(),");
  });

  it("snapshots realtime controls atomically and preserves the original assertion", () => {
    expect(coverageSpec).toContain("controls.evaluateAll");
    expect(coverageSpec).not.toContain("index < await controls.count()");
    expect(coverageSpec).toContain("context.close().catch(() => undefined)");
    expect(coverageSpec).toContain('"owned_tournament_selected"');
    expect(coverageSpec).toContain('"tab_selected"');
  });

  it("pins the browser audit to the locale used by manifest labels", () => {
    expect(coverageSpec).toContain('locale: "vi-VN"');
  });

  it("classifies every enabled desktop shell control discovered on Floor", () => {
    for (const id of [
      "floor-shell-language",
      "floor-shell-notifications",
      "floor-shell-support",
      "floor-shell-operations",
      "floor-shell-qr",
      "floor-shell-sign-out",
      "floor-shell-theme",
      "floor-owned-tournament",
      "floor-shell-install-app",
    ]) {
      expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({ id, route: "/floor", role: "owner" }));
    }
  });
});
