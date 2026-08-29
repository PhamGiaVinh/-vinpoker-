/** Shared exact card lexicon for every Voice card grammar. */
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

/**
 * Parses complete rank/suit pairs only. There is no fuzzy card repair: a
 * transcription error must never become a persisted card.
 */
export function parseVoiceCardPairs(
  tokens: readonly string[],
  expectedCardCount: number,
): readonly string[] | null {
  if (tokens.length !== expectedCardCount * 2) return null;
  const cards: string[] = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const rank = RANKS[tokens[index] ?? ""];
    const suit = SUITS[tokens[index + 1] ?? ""];
    if (!rank || !suit) return null;
    cards.push(`${rank}${suit}`);
  }
  return new Set(cards).size === cards.length ? cards : null;
}
