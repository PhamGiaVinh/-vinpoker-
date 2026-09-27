import { describe, expect, it } from "vitest";
import { classifyManualSwingOutcome, classifyProcessSwingResult } from "./dealerSwingOutcome";

describe("dealer swing outcome classification", () => {
  it("never treats a missing or unknown manual outcome as success", () => {
    expect(classifyManualSwingOutcome(null).kind).toBe("unknown");
    expect(classifyManualSwingOutcome({ outcome: "future_value" }).kind).toBe("unknown");
  });

  it("only treats explicit swing outcomes as success", () => {
    expect(classifyManualSwingOutcome({ outcome: "swung" }).kind).toBe("success");
    expect(classifyManualSwingOutcome({ outcome: "race_lost" }).kind).toBe("warning");
  });

  it("does not show success for partial or malformed process-swing responses", () => {
    expect(classifyProcessSwingResult({ status: "partial" }).kind).toBe("error");
    expect(classifyProcessSwingResult({}).kind).toBe("unknown");
    expect(classifyProcessSwingResult({ status: "completed", processed_count: 2 })).toEqual({
      kind: "success",
      message: "Đã xử lý 2 swing",
    });
  });
});
