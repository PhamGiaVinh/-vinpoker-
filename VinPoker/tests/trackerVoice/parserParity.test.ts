import { describe, expect, it } from "vitest";

import { parseVoiceCommand } from "../../src/lib/trackerVoice/parser";
import { parseTrackerVoiceCommand } from "../../supabase/functions/_shared/trackerVoiceParser";
import { VOICE_UAT_CORPUS } from "./voiceUatCorpus";

function browserShape(transcript: string, options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean }) {
  const parsed = parseVoiceCommand(transcript, options);
  return parsed
    ? {
        kind: parsed.kind,
        normalizedTranscript: parsed.normalizedTranscript,
        amount: parsed.amount?.value ?? null,
        amountAmbiguous: parsed.amount?.ambiguous ?? false,
        spokenSeatNumber: parsed.spokenSeatNumber,
        riskTier: parsed.riskTier,
        requiresConfirmation: parsed.requiresConfirmation,
        repairs: parsed.repairs,
      }
    : null;
}

function serverShape(transcript: string, options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean }) {
  const parsed = parseTrackerVoiceCommand(transcript, {
    spokenAmountUnit: options.spokenAmountUnit ?? 1,
    amountUnitConfirmed: options.amountUnitConfirmed ?? false,
  });
  return parsed ?? null;
}

describe("Tracker Voice browser and Edge parser parity", () => {
  it("contains the fixed 200-utterance real-voice UAT corpus", () => {
    expect(VOICE_UAT_CORPUS).toHaveLength(200);
    expect(new Set(VOICE_UAT_CORPUS.map((item) => item.id)).size).toBe(200);
  });

  it.each(VOICE_UAT_CORPUS)("classifies $id identically", (fixture) => {
    const options = fixture.options ?? { spokenAmountUnit: 1_000, amountUnitConfirmed: true };
    const browser = browserShape(fixture.transcript, options);
    const server = serverShape(fixture.transcript, options);
    expect(browser).toEqual(server);
    expect(browser && {
      kind: browser.kind,
      amount: browser.amount,
      amountAmbiguous: browser.amountAmbiguous,
    }).toEqual(fixture.expected.kind === null
      ? null
      : fixture.expected);
  });

  it("fails closed for bare amounts until the table configuration confirms a unit", () => {
    expect(browserShape("raise 120", {})).toMatchObject({ kind: "raise_to", amount: 120, amountAmbiguous: true });
    expect(serverShape("raise 120", {})).toMatchObject({ kind: "raise_to", amount: 120, amountAmbiguous: true });
    expect(browserShape("raise 120", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }))
      .toMatchObject({ kind: "raise_to", amount: 120_000, amountAmbiguous: false });
  });

  it.each([
    ["seat number two raise four thousand", 2, 4_000],
    ["seat number three fold", 3, null],
    ["ghế số 6 raise 20.000", 6, 20_000],
  ])("keeps browser and Edge seat metadata identical for %s", (transcript, seat, amount) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: false };
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ spokenSeatNumber: seat, amount });
  });

  it.each([
    "fit 9 all in",
    "feet 9 all in",
    "FIT 9, ALL-IN!",
    "Feet 9: all in.",
  ])("rejects repaired all-in identically in browser and Edge: %s", (transcript) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: false };
    expect(browserShape(transcript, options)).toBeNull();
    expect(serverShape(transcript, options)).toBeNull();
  });

  it("keeps exact and safe repaired commands identical", () => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: false };
    expect(browserShape("seat 9 all in", options)).toEqual(serverShape("seat 9 all in", options));
    expect(browserShape("seat 9 all in", options)).toMatchObject({
      kind: "all_in",
      spokenSeatNumber: 9,
      riskTier: "EXACT",
      requiresConfirmation: false,
    });
    expect(browserShape("fit 3 call", options)).toEqual(serverShape("fit 3 call", options));
    expect(browserShape("fit 3 call", options)).toMatchObject({
      kind: "call",
      spokenSeatNumber: 3,
      riskTier: "BOUNDED_REPAIR",
      requiresConfirmation: true,
    });
    expect(browserShape("dealer fit 9 all in", options)).toBeNull();
    expect(serverShape("fit feet 9 all in", options)).toBeNull();
  });

  it("keeps the existing bet unit conversion and ambiguity identical", () => {
    expect(browserShape("bet 9", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }))
      .toEqual(serverShape("bet 9", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }));
    expect(browserShape("bet 9", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }))
      .toMatchObject({ kind: "bet_to", amount: 9_000, amountAmbiguous: false });
    expect(browserShape("bet 9", {})).toEqual(serverShape("bet 9", {}));
    expect(browserShape("bet 9", {})).toMatchObject({ kind: "bet_to", amount: 9, amountAmbiguous: true });
  });

  it.each([
    ["seat four raise 220.0", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }, 220_000],
    ["seat four raise 5.000", {}, 5_000],
    ["seat four raise 11.300", {}, 11_300],
    ["seat four raise 11.322", {}, 11_322],
    ["seat four raise 101699", {}, 101_699],
  ])("keeps Gemini-formatted amount parity for %s", (transcript, options, amount) => {
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ kind: "raise_to", amount, amountAmbiguous: false });
  });

  it.each([
    ["seat four raise 120,0", 120],
    ["seat four raise 1.200.0", null],
  ])("fails closed for malformed Gemini amount output identically: %s", (transcript, amount) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: true };
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ kind: "raise_to", amount, amountAmbiguous: true });
  });

  it("rejects spoken call amounts identically because the engine derives the call amount", () => {
    expect(browserShape("seat four call 30k", {})).toBeNull();
    expect(serverShape("seat four call 30k", {})).toBeNull();
  });
});
