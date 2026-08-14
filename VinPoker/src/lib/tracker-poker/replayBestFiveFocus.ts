import type { ReplayFrame } from "./replayEngine";
import type { ReplayPublicSettlement } from "./replaySettlement";

export type BestFiveFocus = {
  enabled: boolean;
  winnerPlayerIds: ReadonlySet<string>;
  boardCardCodes: ReadonlySet<string>;
  holeCardCodesByPlayerId: ReadonlyMap<string, ReadonlySet<string>>;
};

type ResolveBestFiveFocusInput = {
  handId: string;
  frame: ReplayFrame;
  finalFrameIndex: number;
  settlement: ReplayPublicSettlement | null | undefined;
};

const CARD_RE = /^[AKQJT2-9][shdc]$/;
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

function disabledFocus(): BestFiveFocus {
  return {
    enabled: false,
    winnerPlayerIds: new Set(),
    boardCardCodes: new Set(),
    holeCardCodesByPlayerId: new Map(),
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

function normalizeUniqueCards(values: readonly string[]): string[] | null {
  const normalized = values.map(normalizeReplayCardCode);
  if (normalized.some((card) => card === null)) return null;
  const cards = normalized as string[];
  return new Set(cards).size === cards.length ? cards : null;
}

function equalSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function safeAdd(current: number, amount: number): number | null {
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const next = current + amount;
  return Number.isSafeInteger(next) ? next : null;
}

/**
 * Resolves display-only best-five emphasis from a verified final replay frame.
 * It never evaluates cards or chooses winners, and any inconsistency disables
 * the whole focus treatment rather than partially decorating the showdown.
 */
export function resolveVerifiedBestFiveFocus({
  handId,
  frame,
  finalFrameIndex,
  settlement,
}: ResolveBestFiveFocusInput): BestFiveFocus {
  if (
    !handId.trim()
    || settlement?.status !== "verified"
    || frame.index !== finalFrameIndex
    || !frame.payoutVerified
    || !frame.revealHoleCards
    || (frame.showdownResult !== "winner" && frame.showdownResult !== "chop")
  ) {
    return disabledFocus();
  }

  const visibleBoard = frame.displayCards.filter((card) => card.length > 0);
  if (visibleBoard.length !== 5) return disabledFocus();
  const boardCards = normalizeUniqueCards(visibleBoard);
  if (!boardCards) return disabledFocus();
  const boardSet = new Set(boardCards);

  const seatsByPlayerId = new Map<string, ReplayFrame["seats"][number]>();
  const visibleHoleCardsByPlayerId = new Map<string, Set<string>>();
  const allVisibleCards = new Set(boardCards);

  for (const seat of frame.seats) {
    if (!seat.player_id || seatsByPlayerId.has(seat.player_id)) return disabledFocus();
    seatsByPlayerId.set(seat.player_id, seat);
    if (seat.hole_cards == null) continue;
    if (seat.hole_cards.length !== 2) return disabledFocus();
    const holeCards = normalizeUniqueCards(seat.hole_cards);
    if (!holeCards) return disabledFocus();
    for (const card of holeCards) {
      if (allVisibleCards.has(card)) return disabledFocus();
      allVisibleCards.add(card);
    }
    visibleHoleCardsByPlayerId.set(seat.player_id, new Set(holeCards));
  }

  const settlementPlayers = new Map<string, ReplayPublicSettlement["players"][number]>();
  for (const player of settlement.players) {
    if (!player.playerId || settlementPlayers.has(player.playerId)) return disabledFocus();
    settlementPlayers.set(player.playerId, player);
  }

  const awardByPlayerId = new Map<string, number>();
  const settlementWinnerIds = new Set<string>();
  for (const pot of settlement.pots) {
    if (pot.winnerIds.length === 0 || new Set(pot.winnerIds).size !== pot.winnerIds.length) return disabledFocus();
    const potWinnerIds = new Set(pot.winnerIds);
    for (const winnerId of pot.winnerIds) settlementWinnerIds.add(winnerId);
    for (const allocation of pot.allocations) {
      if (allocation.potId !== pot.potId || !potWinnerIds.has(allocation.winnerId)) return disabledFocus();
      const next = safeAdd(awardByPlayerId.get(allocation.winnerId) ?? 0, allocation.amount);
      if (next === null) return disabledFocus();
      awardByPlayerId.set(allocation.winnerId, next);
    }
  }
  if (settlementWinnerIds.size === 0) return disabledFocus();

  const frameWinnerIds = new Set(frame.showdownWinnerIds ?? []);
  if (!equalSets(settlementWinnerIds, frameWinnerIds)) return disabledFocus();

  for (const seat of frame.seats) {
    const isWinner = settlementWinnerIds.has(seat.player_id);
    const payoutAward = seat.payout_award ?? 0;
    if ((seat.pot_winner === true || payoutAward > 0) !== isWinner) return disabledFocus();
  }

  const ranksByPlayerId = new Map<string, ReplayPublicSettlement["handRanks"][number]>();
  for (const rank of settlement.handRanks) {
    if (!rank.playerId || ranksByPlayerId.has(rank.playerId)) return disabledFocus();
    ranksByPlayerId.set(rank.playerId, rank);
  }

  const boardCardCodes = new Set<string>();
  const holeCardCodesByPlayerId = new Map<string, ReadonlySet<string>>();

  for (const winnerId of settlementWinnerIds) {
    const seat = seatsByPlayerId.get(winnerId);
    const player = settlementPlayers.get(winnerId);
    const rank = ranksByPlayerId.get(winnerId);
    const allocatedAward = awardByPlayerId.get(winnerId) ?? 0;
    if (
      !seat
      || !player
      || !rank
      || allocatedAward <= 0
      || player.potAward !== allocatedAward
      || seat.pot_winner !== true
      || seat.payout_award !== allocatedAward
      || rank.bestFive.length !== 5
    ) {
      return disabledFocus();
    }

    const bestFive = normalizeUniqueCards(rank.bestFive);
    if (!bestFive || bestFive.length !== 5) return disabledFocus();
    const visibleHoleCards = visibleHoleCardsByPlayerId.get(winnerId) ?? new Set<string>();
    const winnerUniverse = new Set([...boardSet, ...visibleHoleCards]);
    if (bestFive.some((card) => !winnerUniverse.has(card))) return disabledFocus();

    const focusedHoleCards = new Set<string>();
    for (const card of bestFive) {
      if (boardSet.has(card)) boardCardCodes.add(card);
      else if (visibleHoleCards.has(card)) focusedHoleCards.add(card);
      else return disabledFocus();
    }
    if (bestFive.filter((card) => boardSet.has(card)).length + focusedHoleCards.size !== 5) return disabledFocus();
    holeCardCodesByPlayerId.set(winnerId, focusedHoleCards);
  }

  return {
    enabled: true,
    winnerPlayerIds: settlementWinnerIds,
    boardCardCodes,
    holeCardCodesByPlayerId,
  };
}
