import { describe, expect, it } from "vitest";

import { classifyTrackerVoiceRepairSafety } from "./parserCore";
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

  it.each([
    ["fit 9 all in", "fit"],
    ["feet 9 all in", "feet"],
    ["FIT 9, ALL-IN!", "fit"],
    ["Feet 9: all in.", "feet"],
  ] as const)("rejects a repaired all-in from structured provenance: %s", (transcript, repairedFrom) => {
    const hardened = hardenDealerTranscript(transcript);
    expect(hardened).toMatchObject({
      rawTranscript: transcript,
      riskTier: "BOUNDED_REPAIR",
      repairs: [{ rule: "seat_prefix_fit_to_seat", from: repairedFrom, to: "seat" }],
    });
    expect(classifyTrackerVoiceRepairSafety(hardened, "all_in")).toEqual({
      originalTranscript: transcript,
      repairApplied: true,
      repairKinds: ["seat_prefix_fit_to_seat"],
      actionAfterRepair: "all_in",
      disposition: "REJECT",
      rejectReason: "repair_action_unsafe",
    });
  });

  it("allows an exact all-in because no repair was applied", () => {
    const hardened = hardenDealerTranscript("seat 9 all in");
    expect(classifyTrackerVoiceRepairSafety(hardened, "all_in")).toEqual({
      originalTranscript: "seat 9 all in",
      repairApplied: false,
      repairKinds: [],
      actionAfterRepair: "all_in",
      disposition: "ALLOW",
      rejectReason: null,
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

  it("normalizes one observed Gemini million punctuation error", () => {
    const repaired = hardenDealerTranscript("seat four raise 1.750.0");
    expect(repaired).toMatchObject({
      normalizedTranscript: "seat four raise 1750000",
      riskTier: "BOUNDED_REPAIR",
      requiresConfirmation: true,
      repairs: [{ rule: "gemini_million_punctuation_tail", from: "1.750.0", to: "1750000" }],
    });
    expect(hardenDealerTranscript(repaired.normalizedTranscript)).toMatchObject({
      normalizedTranscript: "seat four raise 1750000",
      riskTier: "EXACT",
      repairs: [],
    });
  });

  it("rejects two simultaneous transcript repairs", () => {
    expect(hardenDealerTranscript("fit four raise 1.750.0")).toMatchObject({
      riskTier: "REJECT",
      rejectReason: "repair_budget_exceeded",
    });
  });

  it.each(["fit feet 9 all in", "call fit 9", "feet eleven fold"])("rejects an unsafe repair form: %s", (transcript) => {
    expect(hardenDealerTranscript(transcript).riskTier).toBe("REJECT");
  });
});
