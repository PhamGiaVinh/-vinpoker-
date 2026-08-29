import { parseVoiceCardPairs } from "./cardLexicon";
import { normalizeTrackerVoiceTranscript } from "./transcriptHardener";
import type { ParsedVoiceBoardCommand } from "./types";

const STREET_PREFIX: Readonly<Record<string, ParsedVoiceBoardCommand["street"]>> = {
  flop: "flop",
  turn: "turn",
  river: "river",
};

/**
 * Parses complete Board announcements only. There is intentionally no fuzzy
 * card repair: an ASR error must not turn into a persisted card.
 */
export function parseVoiceBoardCommand(rawTranscript: string): ParsedVoiceBoardCommand | null {
  const normalizedTranscript = normalizeTrackerVoiceTranscript(rawTranscript);
  const tokens = normalizedTranscript.split(" ").filter(Boolean);
  const street = STREET_PREFIX[tokens[0] ?? ""];
  if (!street) return null;

  const expectedCardCount = street === "flop" ? 3 : 1;
  const newCards = parseVoiceCardPairs(tokens.slice(1), expectedCardCount);
  if (!newCards) return null;
  return { street, rawTranscript, normalizedTranscript, newCards };
}
