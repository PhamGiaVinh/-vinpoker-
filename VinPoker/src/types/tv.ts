// TvData is the frozen contract between the TV display (PR A, mock)
// and the live data hook useTournamentTvData (PR B).
// Nullable/optional fields render as hidden when absent — the TV must
// never show placeholders for data the schema does not have yet.

export interface TvLevel {
  levelNumber: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
  isBreak: boolean;
}

export interface TvPrize {
  position: number;
  amount: number;
}

export type TvTournamentStatus =
  | "scheduled"
  | "live"
  | "final_table"
  | "finished"
  | "cancelled";

export interface TvData {
  tournamentName: string;
  clubName: string;
  clubLogoUrl?: string | null;
  /** Free-text note, e.g. "Hết đăng ký đầu Level 11". Hidden when null. */
  eventNote?: string | null;
  status: TvTournamentStatus;
  isRunning: boolean;
  isBreak: boolean;
  remainingSeconds: number;
  currentLevel: TvLevel | null;
  nextLevel: TvLevel | null;
  /** Seconds until the next scheduled break starts. Null when no break ahead. */
  nextBreakSeconds: number | null;
  playersRemaining: number;
  totalEntries: number;
  reEntries: number | null;
  averageStack: number;
  /** Sum of confirmed buy-ins (VND). Null until wired to live data. */
  totalBuyIns: number | null;
  prizePool: number | null;
  guarantee?: number | null;
  prizes: TvPrize[];
  sponsorText?: string | null;
  /** Tournament starting stack (chips) — used to derive total chips in play. */
  startingStack: number;
  /** Per-entry buy-in / rake (VND) — feed a prize-pool estimate when prize_pool is stale. */
  buyIn: number | null;
  rakeAmount: number | null;
  /** Club cover photo (clubs.cover_url) → the broadcast clock's replaceable background. */
  clubCoverUrl?: string | null;
}
