import type { TournamentClockData, PayoutRow } from "@/components/tournament-clock/types";
import type { TvData, TvLevel } from "@/types/tv";
import { bigBlindsOf, formatBlinds, formatChips } from "@/lib/tv/format";

// Map the frozen live TvData contract → the presentational neon-green clock's props.
// All money/chips are formatted to strings here (the component is locale-dumb). The
// data-correctness rules below are the owner's P0 review items — keep the comments.

const RANK = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const rankLabel = (pos: number) => RANK[pos - 1] ?? `${pos}th`;
const vnd = (n: number) => `${formatChips(n)} đ`;

function levelStr(l: TvLevel | null): string {
  if (!l) return "—";
  const base = formatBlinds(l.smallBlind, l.bigBlind);
  return l.ante > 0 ? `${base} / ${formatChips(l.ante)}` : base;
}

export function mapTvDataToClock(d: TvData): TournamentClockData {
  // P0-3 — Players: remaining players; fall back to entries before play has busted anyone
  // (or when players_remaining is null/0 pre-start).
  const players = d.playersRemaining || d.totalEntries || 0;

  // P0-1 — Total chips: NO authoritative total-chips column exists. Prefer the in-play
  // figure (average stack × remaining) when both are real; else the chip-conservation
  // estimate (entries × starting_stack). Both are estimates, valid because every entry
  // buys `starting_stack` chips and chips are conserved (no add-on/adjustment modelled).
  const totalChips =
    d.averageStack > 0 && d.playersRemaining > 0
      ? d.averageStack * d.playersRemaining
      : d.totalEntries * (d.startingStack || 0);

  // P0-2 — Prize pool: tournaments.prize_pool is stale/manual/often 0, so NEVER present it
  // as authoritative. Precedence: a real positive prize_pool → GTD (guarantee) → an estimate
  // from buy-ins (Σ confirmed buy-ins, else entries × max(0, buy_in − rake)). Hidden ("—")
  // when none is available.
  const estimate =
    d.totalBuyIns != null && d.totalBuyIns > 0
      ? d.totalBuyIns
      : d.buyIn != null
        ? d.totalEntries * Math.max(0, d.buyIn - (d.rakeAmount ?? 0))
        : null;
  const prizePoolValue =
    d.prizePool != null && d.prizePool > 0
      ? d.prizePool
      : d.guarantee != null && d.guarantee > 0
        ? d.guarantee
        : estimate;

  const payouts: PayoutRow[] = d.prizes.map((p) => ({ rank: rankLabel(p.position), amount: vnd(p.amount) }));

  const bb = bigBlindsOf(d.averageStack, d.currentLevel?.bigBlind);
  const averageStack =
    d.averageStack > 0
      ? bb != null
        ? `${formatChips(d.averageStack)} · ${bb} BB`
        : formatChips(d.averageStack)
      : "—";

  return {
    title: d.tournamentName,
    players,
    entries: d.totalEntries,
    reEntries: d.reEntries ?? 0,
    prizePool: prizePoolValue != null ? vnd(prizePoolValue) : "—",
    totalChips: totalChips > 0 ? formatChips(totalChips) : "—",
    averageStack,
    levelLabel: d.currentLevel ? `Level ${d.currentLevel.levelNumber}` : d.isBreak ? "Break" : "—",
    secondsLeft: d.remainingSeconds,
    // P0-4 — nextBreakSeconds is already number|null; pass it through, never `|| 0`.
    nextBreakSecondsLeft: d.nextBreakSeconds,
    currentLevel: levelStr(d.currentLevel),
    nextLevel: levelStr(d.nextLevel),
    payouts,
    footerNote: d.eventNote ?? d.sponsorText ?? "",
    clubBackgroundUrl: d.clubCoverUrl ?? null,
    clubLogoUrl: d.clubLogoUrl ?? null,
  };
}
