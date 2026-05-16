// Bankroll & variance math — pure functions.
// All inputs/outputs are in the user's currency (no unit conversion).

export type GameType = "tournament" | "cash";

export interface BankrollEntry {
  id: string;
  user_id: string;
  entry_date: string; // ISO date
  game_type: GameType;
  buyin: number | null;
  rake: number | null;
  prize_won: number | null;
  entries: number | null;
  stakes: string | null;
  hours: number | null;
  profit_loss: number | null;
  notes: string | null;
  created_at: string;
}

export const entryNetPL = (e: BankrollEntry): number => {
  if (e.game_type === "tournament") {
    const buyin = (e.buyin ?? 0) * (e.entries ?? 1);
    const rake = e.rake ?? 0;
    const prize = e.prize_won ?? 0;
    return prize - buyin - rake;
  }
  return e.profit_loss ?? 0;
};

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export const sampleSD = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
};

export const confidenceInterval = (m: number, sd: number, n: number, z = 1.645) => {
  if (n < 1) return { low: 0, high: 0 };
  const margin = z * (sd / Math.sqrt(n));
  return { low: m - margin, high: m + margin };
};

/** Risk of Ruin: exp(-2 * WR * BR / SD²). Clamps result to [0,1]. */
export const riskOfRuin = (winrate: number, sd: number, bankroll: number): number => {
  if (winrate <= 0 || sd <= 0 || bankroll <= 0) return 1;
  const ror = Math.exp((-2 * winrate * bankroll) / (sd * sd));
  return Math.max(0, Math.min(1, ror));
};

/** Recommended bankroll: -ln(rorTarget) * SD² / (2 * WR). */
export const recommendedBankroll = (sd: number, winrate: number, rorTarget = 0.05): number => {
  if (winrate <= 0 || sd <= 0) return 0;
  return (-Math.log(rorTarget) * sd * sd) / (2 * winrate);
};

/** Max expected downswing: Z² * SD² / (4 * WR). */
export const maxDownswing = (sd: number, winrate: number, z = 2.33): number => {
  if (winrate <= 0 || sd <= 0) return 0;
  return (z * z * sd * sd) / (4 * winrate);
};

export interface ProjectionPoint {
  n: number;
  mean: number;
  lower: number;
  upper: number;
}

/** Project bankroll over future N events. 90% band (1.645 SD). */
export const projectBankroll = (
  current: number,
  winrate: number,
  sd: number,
  horizons: number[] = [100, 500, 1000],
): ProjectionPoint[] => {
  return horizons.map((n) => {
    const expected = current + winrate * n;
    const stdN = sd * Math.sqrt(n);
    return {
      n,
      mean: expected,
      lower: expected - 1.645 * stdN,
      upper: expected + 1.645 * stdN,
    };
  });
};

export interface BankrollSummary {
  n: number;
  totalPL: number;
  currentBR: number;
  totalBuyin: number;
  totalPrize: number;
  roi: number;
  itm: number;
  cashes: number;
  winrate: number; // mean P/L per event
  sd: number;
  tournamentResults: number[];
}

export const computeSummary = (
  entries: BankrollEntry[],
  startingBankroll: number,
): BankrollSummary => {
  const tourneys = entries.filter((e) => e.game_type === "tournament");
  const tournamentResults = tourneys.map(entryNetPL);
  const totalPL = entries.reduce((s, e) => s + entryNetPL(e), 0);
  const totalBuyin = tourneys.reduce(
    (s, e) => s + (e.buyin ?? 0) * (e.entries ?? 1) + (e.rake ?? 0),
    0,
  );
  const totalPrize = tourneys.reduce((s, e) => s + (e.prize_won ?? 0), 0);
  const cashes = tourneys.filter((e) => (e.prize_won ?? 0) > 0).length;
  return {
    n: entries.length,
    totalPL,
    currentBR: startingBankroll + totalPL,
    totalBuyin,
    totalPrize,
    roi: totalBuyin > 0 ? ((totalPrize - totalBuyin) / totalBuyin) * 100 : 0,
    itm: tourneys.length > 0 ? (cashes / tourneys.length) * 100 : 0,
    cashes,
    winrate: tournamentResults.length ? mean(tournamentResults) : 0,
    sd: sampleSD(tournamentResults),
    tournamentResults,
  };
};
