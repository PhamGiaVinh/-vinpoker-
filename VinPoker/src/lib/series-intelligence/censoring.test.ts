import { describe, it, expect } from "vitest";
import { hitCapacity } from "./censoring";

describe("hitCapacity", () => {
  it("true only when entries >= capacity, both present and positive", () => {
    expect(hitCapacity({ total_entries: 200, capacity: 200 })).toBe(true); // exactly full
    expect(hitCapacity({ total_entries: 210, capacity: 200 })).toBe(true); // over (turned away)
    expect(hitCapacity({ total_entries: 150, capacity: 200 })).toBe(false); // seats left
  });
  it("false when capacity or entries is missing / non-positive", () => {
    expect(hitCapacity({ total_entries: 200, capacity: null })).toBe(false);
    expect(hitCapacity({ total_entries: 200, capacity: undefined })).toBe(false);
    expect(hitCapacity({ total_entries: null, capacity: 200 })).toBe(false);
    expect(hitCapacity({ total_entries: 200, capacity: 0 })).toBe(false);
  });
});
