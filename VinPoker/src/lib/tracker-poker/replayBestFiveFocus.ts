import type { ReplayFrame } from "./replayEngine";
import type { ReplayPublicSettlement } from "./replaySettlement";

export type BestFiveFocus = {
  enabled: boolean;
  winnerPlayerIds: ReadonlySet<string>;
  boardCardCodes: ReadonlySet<string>;
  holeCardCodesByPlayerId: ReadonlyMap<string, ReadonlySet<string>>;
};

export type VerifiedWinnerPresentation = {
  playerId: string;
  playerName: string;
  seatNumber: number;
  category: string;
  bestFive: readonly string[];
  kickers: readonly string[];
  rankingText: string;
  holeBestFive: ReadonlySet<string>;
};

/**
 * A display-only projection of one already-verified settlement pot. The replay
 * never decides either the amount or the recipients; it only sequences this
 * server-projected allocation as Main Pot, then each Side Pot.
 */
export type VerifiedSettlementPotLayer = {
  potId: string;
  kind: "main" | "side";
  amount: number;
  winnerPlayerIds: readonly string[];
  allocations: readonly { playerId: string; amount: number }[];
};

export type VerifiedShowdownPresentation = {
  enabled: boolean;
  handId: string | null;
  frameIndex: number | null;
  isChop: boolean;
  winners: readonly VerifiedWinnerPresentation[];
  potLayers: readonly VerifiedSettlementPotLayer[];
  focus: BestFiveFocus;
};

/**
 * Narrows an already verified showdown to one server-projected pot layer. This
 * is a presentation projection only: it never changes winners, awards, ranks,
 * or cards and therefore cannot create a result that settlement did not emit.
 */
export function selectVerifiedPotLayerPresentation(
  presentation: VerifiedShowdownPresentation | null | undefined,
  potLayerIndex: number,
): VerifiedShowdownPresentation {
  if (!presentation?.enabled || !Number.isInteger(potLayerIndex) || potLayerIndex < 0) {
    return disabledPresentation();
  }

  const layer = presentation.potLayers[potLayerIndex];
  if (!layer || layer.winnerPlayerIds.length === 0) return disabledPresentation();

  const winnersByPlayerId = new Map(presentation.winners.map((winner) => [winner.playerId, winner]));
  const winners = layer.winnerPlayerIds.flatMap((playerId) => {
    const winner = winnersByPlayerId.get(playerId);
    return winner ? [winner] : [];
  });
  if (winners.length !== layer.winnerPlayerIds.length) return disabledPresentation();

  const boardCardCodes = new Set<string>();
  const holeCardCodesByPlayerId = new Map<string, ReadonlySet<string>>();
  for (const winner of winners) {
    const bestFive = new Set(winner.bestFive);
    if (bestFive.size !== 5) return disabledPresentation();
    for (const holeCard of winner.holeBestFive) {
      if (!bestFive.has(holeCard)) return disabledPresentation();
    }
    for (const card of bestFive) {
      if (!winner.holeBestFive.has(card)) boardCardCodes.add(card);
    }
    holeCardCodesByPlayerId.set(winner.playerId, new Set(winner.holeBestFive));
  }

  return {
    ...presentation,
    isChop: layer.winnerPlayerIds.length > 1,
    winners,
    focus: {
      enabled: true,
      winnerPlayerIds: new Set(layer.winnerPlayerIds),
      boardCardCodes,
      holeCardCodesByPlayerId,
    },
  };
}

type ResolveVerifiedShowdownPresentationInput = {
  handId: string;
  frame: ReplayFrame;
  finalFrameIndex: number;
  settlement: ReplayPublicSettlement | null | undefined;
  locale?: string;
};

type ResolveBestFiveFocusInput = Omit<ResolveVerifiedShowdownPresentationInput, "locale">;

type CanonicalCategory =
  | "royal_flush"
  | "straight_flush"
  | "four_of_a_kind"
  | "full_house"
  | "flush"
  | "straight"
  | "three_of_a_kind"
  | "two_pair"
  | "one_pair"
  | "high_card";

const CARD_RE = /^[AKQJT2-9][shdc]$/;
const RANK_RE = /^[AKQJT2-9]$/;
const SUITS: Record<string, string> = {
  s: "s",
  h: "h",
  d: "d",
  c: "c",
  "\u2660": "s",
  "\u2665": "h",
  "\u2666": "d",
  "\u2663": "c",
};
const RANK_VALUE: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};
const CATEGORY_ALIASES: Record<string, CanonicalCategory> = {
  royal_flush: "royal_flush",
  straight_flush: "straight_flush",
  quads: "four_of_a_kind",
  four_of_a_kind: "four_of_a_kind",
  fullhouse: "full_house",
  full_house: "full_house",
  flush: "flush",
  straight: "straight",
  trips: "three_of_a_kind",
  three_of_a_kind: "three_of_a_kind",
  two_pair: "two_pair",
  pair: "one_pair",
  one_pair: "one_pair",
  high_card: "high_card",
};
const ENGLISH_SINGULAR: Record<string, string> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  T: "Ten",
  "9": "Nine",
  "8": "Eight",
  "7": "Seven",
  "6": "Six",
  "5": "Five",
  "4": "Four",
  "3": "Three",
  "2": "Two",
};
const ENGLISH_PLURAL: Record<string, string> = {
  A: "Aces",
  K: "Kings",
  Q: "Queens",
  J: "Jacks",
  T: "Tens",
  "9": "Nines",
  "8": "Eights",
  "7": "Sevens",
  "6": "Sixes",
  "5": "Fives",
  "4": "Fours",
  "3": "Threes",
  "2": "Twos",
};

function disabledFocus(): BestFiveFocus {
  return {
    enabled: false,
    winnerPlayerIds: new Set(),
    boardCardCodes: new Set(),
    holeCardCodesByPlayerId: new Map(),
  };
}

function disabledPresentation(): VerifiedShowdownPresentation {
  return {
    enabled: false,
    handId: null,
    frameIndex: null,
    isChop: false,
    winners: [],
    potLayers: [],
    focus: disabledFocus(),
  };
}

export function normalizeReplayCardCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw.length < 2) return null;

  const rawSuit = raw.slice(-1);
  const suit = SUITS[rawSuit] ?? SUITS[rawSuit.toLowerCase()];
  let rank = raw.slice(0, -1).toUpperCase();
  if (rank === "10") rank = "T";
  const code = suit ? `${rank}${suit}` : "";
  return CARD_RE.test(code) ? code : null;
}

function normalizeRank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rank = value.trim().toUpperCase() === "10" ? "T" : value.trim().toUpperCase();
  return RANK_RE.test(rank) ? rank : null;
}

function normalizeUniqueCards(values: readonly string[]): string[] | null {
  const normalized = values.map(normalizeReplayCardCode);
  if (normalized.some((card) => card === null)) return null;
  const cards = normalized as string[];
  return new Set(cards).size === cards.length ? cards : null;
}

function normalizeKickers(values: readonly string[]): string[] | null {
  const ranks = values.map(normalizeRank);
  return ranks.some((rank) => rank === null) ? null : ranks as string[];
}

function equalSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function equalArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeAdd(current: number, amount: number): number | null {
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const next = current + amount;
  return Number.isSafeInteger(next) ? next : null;
}

function canonicalCategory(value: string): CanonicalCategory | null {
  return CATEGORY_ALIASES[value.trim().toLowerCase()] ?? null;
}

function ranksOf(cards: readonly string[]): string[] {
  return cards.map((card) => card.slice(0, -1));
}

function countRanks(cards: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rank of ranksOf(cards)) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  return counts;
}

function byRankDescending(left: string, right: string): number {
  return (RANK_VALUE[right] ?? 0) - (RANK_VALUE[left] ?? 0);
}

function isStraightRanks(ranks: readonly string[]): { valid: boolean; high: string } {
  const unique = [...new Set(ranks)];
  if (unique.length !== 5) return { valid: false, high: "" };
  const values = unique.map((rank) => RANK_VALUE[rank]).sort((a, b) => a - b);
  if (values.join(",") === "2,3,4,5,14") return { valid: true, high: "5" };
  const consecutive = values.every((value, index) => index === 0 || value === values[index - 1] + 1);
  return consecutive ? { valid: true, high: unique.sort(byRankDescending)[0] } : { valid: false, high: "" };
}

function expectedKickers(category: CanonicalCategory, cards: readonly string[]): string[] | null {
  const counts = countRanks(cards);
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((left, right) => right.count - left.count || byRankDescending(left.rank, right.rank));
  const ranks = ranksOf(cards);
  const allSameSuit = new Set(cards.map((card) => card.slice(-1))).size === 1;
  const straight = isStraightRanks(ranks);

  switch (category) {
    case "royal_flush":
      return allSameSuit && new Set(ranks).size === 5 && ["A", "K", "Q", "J", "T"].every((rank) => counts.has(rank)) ? [] : null;
    case "straight_flush":
      return allSameSuit && straight.valid ? [] : null;
    case "four_of_a_kind":
      return groups.length === 2 && groups[0].count === 4 && groups[1].count === 1 ? [groups[1].rank] : null;
    case "full_house":
      return groups.length === 2 && groups[0].count === 3 && groups[1].count === 2 ? [groups[1].rank] : null;
    case "flush":
      return allSameSuit && !straight.valid && groups.every((group) => group.count === 1)
        ? ranks.sort(byRankDescending).slice(1)
        : null;
    case "straight":
      return straight.valid && !allSameSuit ? [] : null;
    case "three_of_a_kind":
      return groups.length === 3 && groups[0].count === 3 && groups.slice(1).every((group) => group.count === 1)
        ? groups.slice(1).map((group) => group.rank).sort(byRankDescending)
        : null;
    case "two_pair":
      return groups.length === 3 && groups[0].count === 2 && groups[1].count === 2 && groups[2].count === 1
        ? [groups[2].rank]
        : null;
    case "one_pair":
      return groups.length === 4 && groups[0].count === 2 && groups.slice(1).every((group) => group.count === 1)
        ? groups.slice(1).map((group) => group.rank).sort(byRankDescending)
        : null;
    case "high_card":
      return groups.length === 5 && !straight.valid && !allSameSuit
        ? ranks.sort(byRankDescending).slice(1)
        : null;
  }
}

function highRank(cards: readonly string[]): string {
  return ranksOf(cards).sort(byRankDescending)[0];
}

function rankText(rank: string): string {
  return rank === "T" ? "10" : rank;
}

function kickerText(kickers: readonly string[]): string {
  return kickers.map(rankText).join("-");
}

function englishSingular(rank: string): string {
  return ENGLISH_SINGULAR[rank] ?? "";
}

function englishPlural(rank: string): string {
  return ENGLISH_PLURAL[rank] ?? "";
}

/**
 * Formats a server-verified hand rank. It validates the supplied category and
 * card shape, but never evaluates cards or selects a winner in the browser.
 */
export function formatVerifiedHandRanking({
  category,
  bestFive,
  kickers,
  locale,
}: {
  category: string;
  bestFive: readonly string[];
  kickers: readonly string[];
  locale?: string;
}): string | null {
  const normalizedCards = normalizeUniqueCards(bestFive);
  const normalizedKickers = normalizeKickers(kickers);
  const normalizedCategory = canonicalCategory(category);
  if (!normalizedCards || normalizedCards.length !== 5 || !normalizedKickers || !normalizedCategory) return null;

  const expected = expectedKickers(normalizedCategory, normalizedCards);
  if (!expected || !equalArrays(normalizedKickers, expected)) return null;

  const ranks = ranksOf(normalizedCards);
  const groups = [...countRanks(normalizedCards).entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((left, right) => right.count - left.count || byRankDescending(left.rank, right.rank));
  const straight = isStraightRanks(ranks);
  const vietnamese = locale?.toLowerCase().startsWith("vi") ?? true;
  const high = straight.valid ? straight.high : highRank(normalizedCards);

  if (vietnamese) {
    switch (normalizedCategory) {
      case "royal_flush": return "Thùng phá sảnh Royal";
      case "straight_flush": return `Thùng phá sảnh đến ${rankText(high)}`;
      case "four_of_a_kind": return `Tứ quý ${rankText(groups[0].rank)} · Kicker ${kickerText(normalizedKickers)}`;
      case "full_house": return `Cù lũ ${rankText(groups[0].rank)} và ${rankText(groups[1].rank)}`;
      case "flush": return `Thùng ${rankText(high)} cao`;
      case "straight": return `Sảnh đến ${rankText(high)}`;
      case "three_of_a_kind": return `Bộ ba ${rankText(groups[0].rank)} · Kicker ${kickerText(normalizedKickers)}`;
      case "two_pair": return `Hai đôi ${rankText(groups[0].rank)} và ${rankText(groups[1].rank)} · Kicker ${kickerText(normalizedKickers)}`;
      case "one_pair": return `Một đôi ${rankText(groups[0].rank)} · Kicker ${kickerText(normalizedKickers)}`;
      case "high_card": return `Bài cao ${rankText(high)} · ${kickerText(normalizedKickers)}`;
    }
  }

  switch (normalizedCategory) {
    case "royal_flush": return "Royal Flush";
    case "straight_flush": return `${englishSingular(high)}-high Straight Flush`;
    case "four_of_a_kind": return `Four ${englishPlural(groups[0].rank)} · ${englishSingular(normalizedKickers[0])} kicker`;
    case "full_house": return `${englishPlural(groups[0].rank)} full of ${englishPlural(groups[1].rank)}`;
    case "flush": return `${englishSingular(high)}-high Flush`;
    case "straight": return `${englishSingular(high)}-high Straight`;
    case "three_of_a_kind": return `Three ${englishPlural(groups[0].rank)} · ${kickerText(normalizedKickers)} kickers`;
    case "two_pair": return `${englishPlural(groups[0].rank)} and ${englishPlural(groups[1].rank)} · ${englishSingular(normalizedKickers[0])} kicker`;
    case "one_pair": return `Pair of ${englishPlural(groups[0].rank)} · ${kickerText(normalizedKickers)} kickers`;
    case "high_card": return `${englishSingular(high)} high · ${kickerText(normalizedKickers)}`;
  }
}

/**
 * Resolves the sole display model shared by Replay Summary and felt focus. The
 * result is derived only from a verified final frame and public settlement.
 */
export function resolveVerifiedShowdownPresentation({
  handId,
  frame,
  finalFrameIndex,
  settlement,
  locale,
}: ResolveVerifiedShowdownPresentationInput): VerifiedShowdownPresentation {
  if (
    !handId.trim()
    || settlement?.status !== "verified"
    || frame.index !== finalFrameIndex
    || !frame.payoutVerified
    || !frame.revealHoleCards
    || (frame.showdownResult !== "winner" && frame.showdownResult !== "chop")
  ) {
    return disabledPresentation();
  }

  const visibleBoard = frame.displayCards.filter((card) => card.length > 0);
  if (visibleBoard.length !== 5) return disabledPresentation();
  const boardCards = normalizeUniqueCards(visibleBoard);
  if (!boardCards) return disabledPresentation();
  const boardSet = new Set(boardCards);

  const seatsByPlayerId = new Map<string, ReplayFrame["seats"][number]>();
  const visibleHoleCardsByPlayerId = new Map<string, Set<string>>();
  const allVisibleCards = new Set(boardCards);
  for (const seat of frame.seats) {
    if (!seat.player_id || seatsByPlayerId.has(seat.player_id) || seat.seat_number <= 0) return disabledPresentation();
    seatsByPlayerId.set(seat.player_id, seat);
    if (seat.hole_cards == null) continue;
    if (seat.hole_cards.length !== 2) return disabledPresentation();
    const holeCards = normalizeUniqueCards(seat.hole_cards);
    if (!holeCards) return disabledPresentation();
    for (const card of holeCards) {
      if (allVisibleCards.has(card)) return disabledPresentation();
      allVisibleCards.add(card);
    }
    visibleHoleCardsByPlayerId.set(seat.player_id, new Set(holeCards));
  }

  const settlementPlayers = new Map<string, ReplayPublicSettlement["players"][number]>();
  for (const player of settlement.players) {
    if (!player.playerId || settlementPlayers.has(player.playerId)) return disabledPresentation();
    settlementPlayers.set(player.playerId, player);
  }

  const awardByPlayerId = new Map<string, number>();
  const settlementWinnerIds = new Set<string>();
  const unorderedPotLayers: Array<VerifiedSettlementPotLayer & { sourceIndex: number }> = [];
  for (const [sourceIndex, pot] of settlement.pots.entries()) {
    if (pot.winnerIds.length === 0 || new Set(pot.winnerIds).size !== pot.winnerIds.length) return disabledPresentation();
    const potWinnerIds = new Set(pot.winnerIds);
    const allocationByWinnerId = new Map<string, number>();
    let allocatedTotal = 0;
    for (const winnerId of pot.winnerIds) settlementWinnerIds.add(winnerId);
    for (const allocation of pot.allocations) {
      if (
        allocation.potId !== pot.potId
        || !potWinnerIds.has(allocation.winnerId)
        || !Number.isSafeInteger(allocation.amount)
        || allocation.amount <= 0
      ) {
        return disabledPresentation();
      }
      const next = safeAdd(awardByPlayerId.get(allocation.winnerId) ?? 0, allocation.amount);
      const potWinnerNext = safeAdd(allocationByWinnerId.get(allocation.winnerId) ?? 0, allocation.amount);
      const nextAllocatedTotal = safeAdd(allocatedTotal, allocation.amount);
      if (next === null || potWinnerNext === null || nextAllocatedTotal === null) return disabledPresentation();
      awardByPlayerId.set(allocation.winnerId, next);
      allocationByWinnerId.set(allocation.winnerId, potWinnerNext);
      allocatedTotal = nextAllocatedTotal;
    }
    if (allocatedTotal !== pot.amount || pot.winnerIds.some((winnerId) => (allocationByWinnerId.get(winnerId) ?? 0) <= 0)) {
      return disabledPresentation();
    }
    unorderedPotLayers.push({
      potId: pot.potId,
      kind: pot.kind,
      amount: pot.amount,
      winnerPlayerIds: [...pot.winnerIds],
      allocations: pot.winnerIds.map((playerId) => ({ playerId, amount: allocationByWinnerId.get(playerId) ?? 0 })),
      sourceIndex,
    });
  }
  if (unorderedPotLayers.filter((pot) => pot.kind === "main").length !== 1) return disabledPresentation();
  const potLayers = unorderedPotLayers
    .sort((left, right) => (left.kind === "main" ? -1 : right.kind === "main" ? 1 : left.sourceIndex - right.sourceIndex))
    .map(({ sourceIndex: _sourceIndex, ...pot }) => pot);
  if (settlementWinnerIds.size === 0 || !equalSets(settlementWinnerIds, new Set(frame.showdownWinnerIds ?? []))) {
    return disabledPresentation();
  }

  const settlementRanksByPlayerId = new Map<string, ReplayPublicSettlement["handRanks"][number]>();
  for (const rank of settlement.handRanks) {
    if (!rank.playerId || settlementRanksByPlayerId.has(rank.playerId)) return disabledPresentation();
    settlementRanksByPlayerId.set(rank.playerId, rank);
  }

  const boardCardCodes = new Set<string>();
  const holeCardCodesByPlayerId = new Map<string, ReadonlySet<string>>();
  const winners: VerifiedWinnerPresentation[] = [];
  for (const winnerId of settlementWinnerIds) {
    const seat = seatsByPlayerId.get(winnerId);
    const player = settlementPlayers.get(winnerId);
    const settlementRank = settlementRanksByPlayerId.get(winnerId);
    const seatRank = seat?.hand_rank;
    const allocatedAward = awardByPlayerId.get(winnerId) ?? 0;
    if (
      !seat
      || !player
      || !settlementRank
      || !seatRank
      || allocatedAward <= 0
      || player.potAward !== allocatedAward
      || seat.pot_winner !== true
      || seat.payout_award !== allocatedAward
      || seatRank.best_five.length !== 5
      || settlementRank.bestFive.length !== 5
      || seatRank.category !== settlementRank.category
      || !equalArrays(seatRank.best_five, settlementRank.bestFive)
      || !equalArrays(seatRank.kickers, settlementRank.kickers)
    ) {
      return disabledPresentation();
    }

    const bestFive = normalizeUniqueCards(seatRank.best_five);
    const visibleHoleCards = visibleHoleCardsByPlayerId.get(winnerId);
    if (!bestFive || !visibleHoleCards) return disabledPresentation();
    const winnerUniverse = new Set([...boardSet, ...visibleHoleCards]);
    if (bestFive.some((card) => !winnerUniverse.has(card))) return disabledPresentation();
    const rankingText = formatVerifiedHandRanking({
      category: seatRank.category,
      bestFive,
      kickers: seatRank.kickers,
      locale,
    });
    if (!rankingText) return disabledPresentation();

    const focusedHoleCards = new Set<string>();
    for (const card of bestFive) {
      if (boardSet.has(card)) boardCardCodes.add(card);
      else if (visibleHoleCards.has(card)) focusedHoleCards.add(card);
      else return disabledPresentation();
    }
    if (bestFive.filter((card) => boardSet.has(card)).length + focusedHoleCards.size !== 5) return disabledPresentation();
    holeCardCodesByPlayerId.set(winnerId, focusedHoleCards);
    winners.push({
      playerId: winnerId,
      playerName: seat.display_name,
      seatNumber: seat.seat_number,
      category: seatRank.category,
      bestFive,
      kickers: [...seatRank.kickers],
      rankingText,
      holeBestFive: focusedHoleCards,
    });
  }

  for (const seat of frame.seats) {
    const isWinner = settlementWinnerIds.has(seat.player_id);
    const payoutAward = seat.payout_award ?? 0;
    if ((seat.pot_winner === true || payoutAward > 0) !== isWinner) return disabledPresentation();
  }

  return {
    enabled: true,
    handId,
    frameIndex: frame.index,
    isChop: frame.showdownResult === "chop",
    winners,
    potLayers,
    focus: {
      enabled: true,
      winnerPlayerIds: settlementWinnerIds,
      boardCardCodes,
      holeCardCodesByPlayerId,
    },
  };
}

/** Backward-compatible focus projection for existing felt callers and tests. */
export function resolveVerifiedBestFiveFocus(input: ResolveBestFiveFocusInput): BestFiveFocus {
  return resolveVerifiedShowdownPresentation(input).focus;
}
