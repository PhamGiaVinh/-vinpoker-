import { describe, it, expect } from "vitest";
import { parseNumberToken, parseCellsToCustomRows } from "./customPayoutImport";

describe("parseNumberToken — VN/EN number tolerance", () => {
  it("plain + percent + currency", () => {
    expect(parseNumberToken(60)).toBe(60);
    expect(parseNumberToken("60")).toBe(60);
    expect(parseNumberToken("60%")).toBe(60);
    expect(parseNumberToken("60,5%")).toBe(60.5); // VN decimal comma
    expect(parseNumberToken("18.000.000đ")).toBe(18000000); // VN thousands dots
    expect(parseNumberToken("18,000,000")).toBe(18000000); // EN thousands commas
    expect(parseNumberToken("1.234.567,89")).toBeCloseTo(1234567.89); // VN full
    expect(parseNumberToken("1,234,567.89")).toBeCloseTo(1234567.89); // EN full
    expect(parseNumberToken("33.34")).toBeCloseTo(33.34); // EN decimal (2-digit tail)
  });
  it("non-numbers → null", () => {
    expect(parseNumberToken("Hạng")).toBeNull();
    expect(parseNumberToken("")).toBeNull();
    expect(parseNumberToken("%")).toBeNull();
    expect(parseNumberToken(null)).toBeNull();
    expect(parseNumberToken(undefined)).toBeNull();
  });
});

const pct = (r: { rows: { percent: number }[] }) => r.rows.map((x) => x.percent);
const bpSum = (r: { rows: { percent: number }[] }) => Math.round(r.rows.reduce((s, x) => s + x.percent * 100, 0));

describe("parseCellsToCustomRows — percent files", () => {
  it("single-column percentages 60/30/10", () => {
    const r = parseCellsToCustomRows([["60"], ["30"], ["10"]]);
    expect(r.mode).toBe("percent");
    expect(pct(r)).toEqual([60, 30, 10]);
    expect(bpSum(r)).toBe(10000);
  });
  it("with a header row + Hạng column", () => {
    const r = parseCellsToCustomRows([["Hạng", "%"], [1, 60], [2, 30], [3, 10]]);
    expect(r.mode).toBe("percent");
    expect(pct(r)).toEqual([60, 30, 10]);
    expect(bpSum(r)).toBe(10000);
  });
  it("winner-take-all single row", () => {
    const r = parseCellsToCustomRows([["100"]]);
    expect(pct(r)).toEqual([100]);
    expect(bpSum(r)).toBe(10000);
  });
  it("non-round percents are normalised to Σ=100% (residual on rank 1)", () => {
    const r = parseCellsToCustomRows([["33.3"], ["33.3"], ["33.3"]]);
    expect(bpSum(r)).toBe(10000);
    expect(r.rows[0].percent).toBeGreaterThanOrEqual(r.rows[1].percent); // residual lifts rank 1
    expect(r.warnings.join(" ")).toMatch(/chuẩn hoá/);
  });
});

describe("parseCellsToCustomRows — money files (auto-convert to %)", () => {
  it("VN money 18tr/9tr/3tr → 60/30/10", () => {
    const r = parseCellsToCustomRows([["1", "18.000.000"], ["2", "9.000.000"], ["3", "3.000.000"]]);
    expect(r.mode).toBe("amount");
    expect(pct(r)).toEqual([60, 30, 10]);
    expect(bpSum(r)).toBe(10000);
    expect(r.warnings.join(" ")).toMatch(/số tiền/);
  });
  it("amounts in thousands, no position column", () => {
    const r = parseCellsToCustomRows([["180"], ["90"], ["30"]]); // sum 300 > 100 → amount
    expect(r.mode).toBe("amount");
    expect(pct(r)).toEqual([60, 30, 10]);
    expect(bpSum(r)).toBe(10000);
  });
  it("drops a trailing total row", () => {
    const r = parseCellsToCustomRows([[1, 18000000], [2, 9000000], [3, 3000000], ["Tổng", 30000000]]);
    expect(r.rows.length).toBe(3);
    expect(pct(r)).toEqual([60, 30, 10]);
    expect(r.warnings.join(" ")).toMatch(/tổng/i);
  });
});

describe("parseCellsToCustomRows — guards & ordering", () => {
  it("sorts by the position column", () => {
    const r = parseCellsToCustomRows([[3, 10], [1, 60], [2, 30]]);
    expect(pct(r)).toEqual([60, 30, 10]);
  });
  it("flags non-descending percentages", () => {
    const r = parseCellsToCustomRows([[1, 10], [2, 60], [3, 30]]);
    expect(r.warnings.join(" ")).toMatch(/giảm dần/);
  });
  it("throws on empty / no-number / zero-sum", () => {
    expect(() => parseCellsToCustomRows([])).toThrow(/FILE_EMPTY/);
    expect(() => parseCellsToCustomRows([["a"], ["b"]])).toThrow(/FILE_NO_NUMBERS/);
    expect(() => parseCellsToCustomRows([["0"], ["0"]])).toThrow(/FILE_SUM_ZERO/);
  });
});
