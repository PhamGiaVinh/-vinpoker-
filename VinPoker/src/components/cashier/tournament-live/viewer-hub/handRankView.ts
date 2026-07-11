import { evaluate5, kCombinations, RANK_VAL } from "@/lib/poker/handEval";
import { toEvalCard } from "@/lib/tracker-poker/trackerShowdown";
import type { HandCategory } from "./handFeedDerive";

export interface HandRankView {
  category: HandCategory;
  bestFive: string[];
  primaryRanks: string[];
  kickerRanks: string[];
  score: number;
}

const RANK_LABEL: Record<number, string> = {
  14: "A", 13: "K", 12: "Q", 11: "J", 10: "T",
  9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2",
};

function categoryFromScore(score: number): HandCategory {
  const band = Math.floor(score / 1e10);
  if (band === 8) return score - 8e10 === 14 ? "royal_flush" : "straight_flush";
  return (["high_card", "pair", "two_pair", "trips", "straight", "flush", "full_house", "quads"] as HandCategory[])[band] ?? "high_card";
}

function rankGroups(cards: string[]): Array<{ rank: number; count: number }> {
  const counts = new Map<number, number>();
  for (const card of cards) {
    const rank = RANK_VAL[toEvalCard(card)[0]];
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
}

/** Display-only evaluator adapter. Winner and payout still come from verified settlement. */
export function buildHandRankView(holeCards: string[], board: string[]): HandRankView | null {
  const cards = [...holeCards, ...board].filter(Boolean);
  if (holeCards.length !== 2 || cards.length < 5) return null;

  let bestFive: string[] = [];
  let score = -1;
  for (const indexes of kCombinations(cards.length, 5)) {
    const candidate = indexes.map((index) => cards[index]);
    const next = evaluate5(candidate.map(toEvalCard));
    if (next > score) {
      score = next;
      bestFive = candidate;
    }
  }

  const category = categoryFromScore(score);
  const groups = rankGroups(bestFive);
  let primary: number[] = [];
  let kickers: number[] = [];

  if (category === "quads") {
    primary = groups.filter((g) => g.count === 4).map((g) => g.rank);
    kickers = groups.filter((g) => g.count === 1).map((g) => g.rank);
  } else if (category === "full_house") {
    primary = groups.map((g) => g.rank);
  } else if (category === "trips") {
    primary = groups.filter((g) => g.count === 3).map((g) => g.rank);
    kickers = groups.filter((g) => g.count === 1).map((g) => g.rank).sort((a, b) => b - a);
  } else if (category === "two_pair") {
    primary = groups.filter((g) => g.count === 2).map((g) => g.rank).sort((a, b) => b - a);
    kickers = groups.filter((g) => g.count === 1).map((g) => g.rank);
  } else if (category === "pair") {
    primary = groups.filter((g) => g.count === 2).map((g) => g.rank);
    kickers = groups.filter((g) => g.count === 1).map((g) => g.rank).sort((a, b) => b - a);
  } else {
    primary = groups.map((g) => g.rank).sort((a, b) => b - a);
  }

  return {
    category,
    bestFive,
    primaryRanks: primary.map((rank) => RANK_LABEL[rank]),
    kickerRanks: kickers.map((rank) => RANK_LABEL[rank]),
    score,
  };
}
