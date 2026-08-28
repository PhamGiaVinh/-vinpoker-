import { describe, expect, it } from "vitest";

import { hardenDealerTranscript } from "./transcriptHardener";

describe("dealer transcript hardener", () => {
  it("preserves exact utterances without repairs", () => {
    expect(hardenDealerTranscript("Seat 9 all in")).toEqual({
      rawTranscript: "Seat 9 all in",
      normalizedTranscript: "seat 9 all in",
      riskTier: "EXACT",
      repairs: [],
      requiresConfirmation: false,
    });
  });

  it("repairs only one known seat-prefix word", () => {
    expect(hardenDealerTranscript("fit 9 all in")).toMatchObject({
      normalizedTranscript: "seat 9 all in",
      riskTier: "BOUNDED_REPAIR",
      requiresConfirmation: true,
      repairs: [{ rule: "seat_prefix_fit_to_seat", from: "fit", to: "seat" }],
    });
  });

  it("is idempotent after the bounded repair", () => {
    const repaired = hardenDealerTranscript("feet nine call");
    expect(hardenDealerTranscript(repaired.normalizedTranscript)).toMatchObject({
      normalizedTranscript: repaired.normalizedTranscript,
      riskTier: "EXACT",
      repairs: [],
    });
  });

  it.each(["fit feet 9 all in", "call fit 9", "feet eleven fold"])("rejects an unsafe repair form: %s", (transcript) => {
    expect(hardenDealerTranscript(transcript).riskTier).toBe("REJECT");
  });
});
