import { describe, it, expect } from "vitest";
import { getDisplayableSatelliteRows, parseSatellitePayout, type SatellitePayout } from "./satellitePayout";

// ĐK-2/ĐK-3: một định nghĩa displayable duy nhất cho Cockpit + TV. Row dở dang / payload trắng
// KHÔNG được coi là satellite hợp lệ (nếu không sẽ ẩn bảng tiền mà card satellite lại trống).

describe("getDisplayableSatelliteRows", () => {
  const valid: SatellitePayout = { rows: [{ label: "1–12", prize: "1 vé" }, { label: "13", prize: "4.500.000" }] };

  it("null/undefined payout → null", () => {
    expect(getDisplayableSatelliteRows(null, true)).toBeNull();
    expect(getDisplayableSatelliteRows(undefined, true)).toBeNull();
  });

  it("flag OFF → null dù payload hợp lệ (mọi màn fallback bảng tiền)", () => {
    expect(getDisplayableSatelliteRows(valid, false)).toBeNull();
  });

  it("rows rỗng → null", () => {
    expect(getDisplayableSatelliteRows({ rows: [] }, true)).toBeNull();
  });

  it("toàn dòng trắng / dở dang (chỉ label hoặc chỉ prize) → null — không ẩn bảng tiền oan", () => {
    expect(getDisplayableSatelliteRows({ rows: [{ label: " ", prize: "" }] }, true)).toBeNull();
    expect(getDisplayableSatelliteRows({ rows: [{ label: "1–12", prize: "  " }] }, true)).toBeNull();
    expect(getDisplayableSatelliteRows({ rows: [{ label: "", prize: "1 vé" }] }, true)).toBeNull();
  });

  it("vé-only và vé + tiền (bubble trong rows) đều displayable — giữ nguyên thứ tự", () => {
    expect(getDisplayableSatelliteRows(valid, true)).toEqual([
      { label: "1–12", prize: "1 vé" },
      { label: "13", prize: "4.500.000" },
    ]);
  });

  it("mix: chỉ giữ dòng đủ label+prize", () => {
    const mixed: SatellitePayout = {
      rows: [{ label: "1–8", prize: "1 vé" }, { label: "9", prize: "" }, { label: "", prize: "500.000" }],
    };
    expect(getDisplayableSatelliteRows(mixed, true)).toEqual([{ label: "1–8", prize: "1 vé" }]);
  });

  it("không mutate input", () => {
    const input: SatellitePayout = { rows: [{ label: "1", prize: "1 vé" }, { label: "x", prize: "" }] };
    const before = JSON.stringify(input);
    getDisplayableSatelliteRows(input, true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("payload méo (rows không phải mảng, qua any) → null, không throw", () => {
    expect(getDisplayableSatelliteRows({ rows: "junk" } as any, true)).toBeNull();
  });
});

describe("parseSatellitePayout (hợp đồng hiện có — chống hồi quy)", () => {
  it("jsonb hợp lệ → rows đã trim, bỏ dòng rỗng-cả-hai", () => {
    expect(parseSatellitePayout({ rows: [{ label: " 1–12 ", prize: " 1 vé " }, { label: "", prize: "" }] }))
      .toEqual({ rows: [{ label: "1–12", prize: "1 vé" }] });
  });
  it("null / không phải object / rows thiếu → null", () => {
    expect(parseSatellitePayout(null)).toBeNull();
    expect(parseSatellitePayout("x")).toBeNull();
    expect(parseSatellitePayout({})).toBeNull();
  });
});
