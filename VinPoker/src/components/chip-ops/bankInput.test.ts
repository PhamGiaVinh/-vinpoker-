import { describe, expect, it } from "vitest";
import { parseChipCountInput } from "./bankInput";

describe("parseChipCountInput", () => {
  it("accepts exact whole chip counts", () => {
    expect(parseChipCountInput(" 12 ")).toBe(12);
    expect(parseChipCountInput("0", true)).toBe(0);
  });

  it("rejects values that could corrupt a bigint count", () => {
    for (const value of ["", " ", "0", "-1", "1.5", "1e3", "Infinity", "9007199254740992"]) {
      expect(parseChipCountInput(value)).toBeNull();
    }
  });
});
