import { describe, expect, it } from "vitest";
import { floorAuditViewports, floorButtonCoverageManifest } from "../../e2e/floor-button-coverage.manifest";

const requiredControls = [
  "Tạo giải", "Sửa giải", "Mở giải", "Đồng hồ", "Mở bàn", "Thêm người", "Sửa chip",
  "Chuyển ghế", "Đóng bàn", "Bốc lại", "Phiếu", "Loại", "Khôi phục", "Xem trước trả thưởng",
  "Lưu cơ cấu", "Tải mẫu", "Close Report", "Đóng giải", "Huỷ", "Thử lại", "Làm mới", "Xác nhận",
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
    for (const entry of floorButtonCoverageManifest.filter((candidate) => candidate.destructive && candidate.expectedState === "enabled")) {
      expect(entry.fixtureScenario, entry.id).toBeTruthy();
      expect(entry.expectedBackendCall, entry.id).toBeTruthy();
      expect(entry.expectedDbInvariant, entry.id).toBeTruthy();
    }
  });

  it("records payout as disabled while floorAtomicPayout is off", () => {
    expect(floorButtonCoverageManifest).toContainEqual(expect.objectContaining({
      id: "atomic-payout-off",
      expectedState: "disabled",
      exclusionReason: expect.any(String),
    }));
  });
});
