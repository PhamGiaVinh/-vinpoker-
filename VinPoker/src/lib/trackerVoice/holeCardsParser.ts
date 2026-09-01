import { parseVoiceCardPairs } from "./cardLexicon.ts";
import { normalizeTrackerVoiceTranscript } from "./transcriptHardener.ts";
import type { ParsedVoiceHoleCardsCommand } from "./types.ts";

const SEAT_NUMBERS: Readonly<Record<string, number>> = {
  "1": 1, one: 1, mot: 1,
  "2": 2, two: 2, hai: 2,
  "3": 3, three: 3, ba: 3,
  "4": 4, four: 4, bon: 4, tu: 4,
  "5": 5, five: 5, nam: 5, lam: 5,
  "6": 6, six: 6, sau: 6,
  "7": 7, seven: 7, bay: 7,
  "8": 8, eight: 8, tam: 8,
  "9": 9, nine: 9, chin: 9,
  "10": 10, ten: 10, muoi: 10,
};

/**
 * Hole-card calls have the strictest grammar in Voice V0. Unlike action
 * parsing, this deliberately does not run the dealer hardener, so `fit` and
 * `feet` cannot become a sensitive card proposal.
 */
export function parseVoiceHoleCardsCommand(rawTranscript: string): ParsedVoiceHoleCardsCommand | null {
  const normalizedTranscript = normalizeTrackerVoiceTranscript(rawTranscript);
  const tokens = normalizedTranscript.split(" ").filter(Boolean);
  if (tokens.length !== 6 || (tokens[0] !== "seat" && tokens[0] !== "ghe")) return null;
  const seatNumber = SEAT_NUMBERS[tokens[1] ?? ""];
  if (!seatNumber) return null;
  const cards = parseVoiceCardPairs(tokens.slice(2), 2);
  if (!cards || cards.length !== 2) return null;
  return {
    kind: "hole_cards",
    rawTranscript,
    normalizedTranscript,
    seatNumber,
    cards: [cards[0]!, cards[1]!],
  };
}

/**
 * Privacy guard for the UI/export boundary. This is deliberately broader than
 * the strict grammar: a malformed private-card sentence must not fall through
 * to the generic transcript diagnostics.
 */
export function looksLikePrivateHoleCardsTranscript(rawTranscript: string): boolean {
  const tokens = normalizeTrackerVoiceTranscript(rawTranscript).split(" ").filter(Boolean);
  if (!(["seat", "ghe", "fit", "feet"] as const).includes(tokens[0] as "seat" | "ghe" | "fit" | "feet")) {
    return false;
  }
  for (let index = 2; index + 1 < tokens.length; index += 1) {
    if (parseVoiceCardPairs(tokens.slice(index, index + 2), 1)) return true;
  }
  return false;
}
