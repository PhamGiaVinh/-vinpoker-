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

const HOLE_CARD_OWNERSHIP_WORDS = new Set(["cam", "co"]);

function parseExplicitSeatPrefix(tokens: readonly string[]): {
  seatNumber: number;
  cardsStartIndex: number;
} | null {
  let seatNumber: number | undefined;
  let cardsStartIndex = 0;
  if (tokens[0] === "seat" || tokens[0] === "ghe") {
    seatNumber = SEAT_NUMBERS[tokens[1] ?? ""];
    cardsStartIndex = 2;
  } else {
    const fusedSeat = /^v(10|[1-9])$/.exec(tokens[0] ?? "");
    if (fusedSeat) {
      seatNumber = Number(fusedSeat[1]);
      cardsStartIndex = 1;
    }
  }
  if (!seatNumber) return null;
  if (HOLE_CARD_OWNERSHIP_WORDS.has(tokens[cardsStartIndex] ?? "")) cardsStartIndex += 1;
  return { seatNumber, cardsStartIndex };
}

/**
 * Hole-card calls have the strictest grammar in Voice V0. Unlike action
 * parsing, this deliberately does not run the dealer hardener, so `fit` and
 * `feet` cannot become a sensitive card proposal.
 */
export function parseVoiceHoleCardsCommand(
  rawTranscript: string,
  impliedSeatNumber?: number | null,
): ParsedVoiceHoleCardsCommand | null {
  const normalizedTranscript = normalizeTrackerVoiceTranscript(rawTranscript);
  const tokens = normalizedTranscript.split(" ").filter(Boolean);
  const explicitSeat = parseExplicitSeatPrefix(tokens);
  const seatNumber = explicitSeat?.seatNumber
    ?? (tokens.length === 4 && Number.isInteger(impliedSeatNumber) && Number(impliedSeatNumber) > 0
      ? Number(impliedSeatNumber)
      : null);
  if (!seatNumber) return null;
  const cards = parseVoiceCardPairs(explicitSeat ? tokens.slice(explicitSeat.cardsStartIndex) : tokens, 2);
  if (!cards || cards.length !== 2) return null;
  return {
    kind: "hole_cards",
    rawTranscript,
    normalizedTranscript,
    seatNumber,
    cards: [cards[0]!, cards[1]!],
  };
}

const STREET_INDEX: Readonly<Record<string, number>> = {
  preflop: 0,
  flop: 1,
  turn: 2,
  river: 3,
  showdown: 4,
};

/** Derives the next unfilled reveal seat from the same immutable hand facts in browser and Edge. */
export function resolveNextVoiceHoleCardsSeatNumber(args: {
  players: ReadonlyArray<{ playerId: string; seatNumber: number; isFolded: boolean; hasCards: boolean }>;
  actions: ReadonlyArray<{ street: string; actionType: string; actionOrder: number; seatNumber: number }>;
  buttonSeat: number;
}): number | null {
  const shown = args.players
    .filter((player) => !player.isFolded)
    .sort((a, b) => a.seatNumber - b.seatNumber);
  if (shown.length === 0) return null;
  const maxStreet = args.actions.reduce(
    (maximum, action) => Math.max(maximum, STREET_INDEX[action.street] ?? 0),
    0,
  );
  const shownSeats = new Set(shown.map((player) => player.seatNumber));
  const finalAggressor = [...args.actions]
    .filter((action) => (
      (STREET_INDEX[action.street] ?? 0) === maxStreet
      && ["bet", "raise", "all_in"].includes(action.actionType)
      && shownSeats.has(action.seatNumber)
    ))
    .sort((a, b) => a.actionOrder - b.actionOrder)
    .at(-1);
  const firstClockwiseFromButton = shown.find((player) => player.seatNumber > args.buttonSeat) ?? shown[0];
  const startSeat = finalAggressor?.seatNumber ?? firstClockwiseFromButton?.seatNumber;
  if (!startSeat) return null;
  const startIndex = shown.findIndex((player) => player.seatNumber === startSeat);
  const ordered = [...shown.slice(startIndex), ...shown.slice(0, startIndex)];
  return ordered.find((player) => !player.hasCards)?.seatNumber ?? null;
}

/**
 * Privacy guard for the UI/export boundary. This is deliberately broader than
 * the strict grammar: a malformed private-card sentence must not fall through
 * to the generic transcript diagnostics.
 */
export function looksLikePrivateHoleCardsTranscript(rawTranscript: string): boolean {
  const tokens = normalizeTrackerVoiceTranscript(rawTranscript).split(" ").filter(Boolean);
  if (tokens.length === 4 && parseVoiceCardPairs(tokens, 2)) return true;
  const explicitSeat = parseExplicitSeatPrefix(tokens);
  const legacyPrivatePrefix = (["fit", "feet"] as const).includes(tokens[0] as "fit" | "feet");
  if (!explicitSeat && !legacyPrivatePrefix) {
    return false;
  }
  const legacyCardsStartIndex = HOLE_CARD_OWNERSHIP_WORDS.has(tokens[2] ?? "") ? 3 : 2;
  const cardsStartIndex = explicitSeat?.cardsStartIndex ?? legacyCardsStartIndex;
  for (let index = cardsStartIndex; index + 1 < tokens.length; index += 1) {
    if (parseVoiceCardPairs(tokens.slice(index, index + 2), 1)) return true;
  }
  return false;
}
