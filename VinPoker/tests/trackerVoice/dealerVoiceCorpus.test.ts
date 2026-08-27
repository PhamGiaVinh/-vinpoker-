import { describe, expect, it } from "vitest";

import { parseVoiceCommand } from "@/lib/trackerVoice";
import { DEALER_VOICE_CORPUS } from "./fixtures/dealerVoiceCorpus";

describe("Dealer Voice UAT corpus", () => {
  it("keeps a bounded 40-60 utterance corpus for physical ASR scoring", () => {
    expect(DEALER_VOICE_CORPUS.length).toBeGreaterThanOrEqual(40);
    expect(DEALER_VOICE_CORPUS.length).toBeLessThanOrEqual(60);
  });

  it("keeps parser expectations deterministic for every expected final transcript", () => {
    for (const entry of DEALER_VOICE_CORPUS) {
      const parsed = parseVoiceCommand(entry.expectedTranscript, {
        spokenAmountUnit: 1_000,
        amountUnitConfirmed: true,
      });
      if (entry.expectedParserCommand === null) {
        expect(parsed, entry.expectedTranscript).toBeNull();
        continue;
      }
      expect(parsed, entry.expectedTranscript).toMatchObject({ kind: entry.expectedParserCommand });
      if (entry.expectedAmount !== null) {
        expect(parsed?.amount, entry.expectedTranscript).toMatchObject({ value: entry.expectedAmount, ambiguous: false });
      }
    }
  });

  it("accepts only bounded phonetic raise forms with an amount", () => {
    const phoneticDealerSpeech = DEALER_VOICE_CORPUS
      .filter((entry) => entry.spoken.startsWith("rây"))
      .map((entry) => entry.spoken);

    for (const spoken of phoneticDealerSpeech) {
      expect(parseVoiceCommand(spoken, { amountUnitConfirmed: true }), spoken).toMatchObject({ kind: "raise_to" });
    }
    expect(parseVoiceCommand("rây your hand")).toBeNull();
    expect(parseVoiceCommand("race tomorrow")).toBeNull();
  });
});
