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
    ["seat number two race four thousand", 2, 4_000],
    ["see number three fold", 3, null],
    ["seat number seat number five all in", 5, null],
    ["về số 6 raise 20.000", 6, 20_000],
  ])("keeps browser and Edge seat/pronunciation metadata identical for %s", (transcript, seat, amount) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: false };
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ spokenSeatNumber: seat, amount });
  });
});
