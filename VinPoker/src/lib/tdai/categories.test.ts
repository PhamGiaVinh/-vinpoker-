import { describe, expect, it } from "vitest";
import { dominantCategory } from "./categories";

describe("dominantCategory", () => {
  it("maps a ruling id", () => {
    expect(dominantCategory(["string-bet"])).toBe("ruling");
  });
  it("maps an operations id", () => {
    expect(dominantCategory(["ops-blind-structure"])).toBe("operations");
  });
  it("maps a strategy id", () => {
    expect(dominantCategory(["strat-pot-odds"])).toBe("strategy");
  });
  it("maps floor ids (house rule + new floor entry)", () => {
    expect(dominantCategory(["house-penalty"])).toBe("floor");
    expect(dominantCategory(["floor-angle-shoot"])).toBe("floor");
  });
  it("returns the most common category", () => {
    expect(dominantCategory(["ops-color-up", "ops-table-balance", "string-bet"])).toBe("operations");
  });
  it("returns null for unknown or empty input", () => {
    expect(dominantCategory([])).toBeNull();
    expect(dominantCategory(["does-not-exist"])).toBeNull();
  });
});
