import { normalizeTrackerVoiceTranscript } from "./transcriptHardener";
import type { ParsedVoiceBoardCommand } from "./types";

const RANKS: Readonly<Record<string, string>> = {
  a: "A", ace: "A", at: "A", k: "K", king: "K", vua: "K",
  q: "Q", queen: "Q", dam: "Q", j: "J", jack: "J", boi: "J",
  "10": "T", ten: "T", muoi: "T", "9": "9", nine: "9", chin: "9",
  "8": "8", eight: "8", tam: "8", "7": "7", seven: "7", bay: "7",
  "6": "6", six: "6", sau: "6", "5": "5", five: "5", nam: "5",
  "4": "4", four: "4", bon: "4", "3": "3", three: "3", ba: "3",
  "2": "2", two: "2", hai: "2",
};

const SUITS: Readonly<Record<string, string>> = {
  h: "h", hearts: "h", heart: "h", co: "h",
  d: "d", diamonds: "d", diamond: "d", ro: "d",
  c: "c", clubs: "c", club: "c", tep: "c", chuon: "c",
  s: "s", spades: "s", spade: "s", bich: "s",
};

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
  const cardTokens = tokens.slice(1);
  if (cardTokens.length !== expectedCardCount * 2) return null;

  const newCards: string[] = [];
  for (let index = 0; index < cardTokens.length; index += 2) {
    const rank = RANKS[cardTokens[index] ?? ""];
    const suit = SUITS[cardTokens[index + 1] ?? ""];
    if (!rank || !suit) return null;
    newCards.push(`${rank}${suit}`);
  }
  if (new Set(newCards).size !== newCards.length) return null;
  return { street, rawTranscript, normalizedTranscript, newCards };
}
