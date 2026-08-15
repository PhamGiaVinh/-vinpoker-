export type PublicClockPhase =
  | "running"
  | "paused"
  | "break"
  | "not_started"
  | "completed";

export type PublicDataQuality = "exact" | "partial" | "stale";

export interface PublicBlindLevel {
  levelNumber: number;
  smallBlind: number;
  bigBlind: number;
  bigBlindAnte: number;
  durationMinutes: number;
  isBreak: boolean;
}

export interface PublicSeat {
  seatNumber: number;
  playerName: string | null;
  chipCount: number | null;
  avatarUrl: string | null;
}

export interface PublicTable {
  /** Physical table identity: game_tables.id. */
  id: string;
  label: string;
  status: "running";
  maxSeats: 9;
  dataQuality: "exact" | "inconsistent";
  seats: PublicSeat[];
}

export interface PublicTournamentEventSnapshot {
  tournament: {
    id: string;
    name: string;
    status: string;
  };
  clock: {
    phase: PublicClockPhase;
    isAdvancing: boolean;
    levelNumber: number | null;
    remainingSeconds: number | null;
    smallBlind: number;
    bigBlind: number;
    bigBlindAnte: number;
    nextSmallBlind: number | null;
    nextBigBlind: number | null;
    nextBigBlindAnte: number | null;
  };
  entries: number;
  playersRemaining: number | null;
  averageStack: number | null;
  structure: PublicBlindLevel[];
  tables: PublicTable[];
  refreshedAt: string;
  dataQuality: PublicDataQuality;
}

export interface RawPublicClock {
  tournamentStatus: string;
  clockStatus?: string | null;
  isRunning: boolean;
  isBreak: boolean;
  levelNumber: number | null;
  remainingSeconds: number | null;
  smallBlind: number;
  bigBlind: number;
  bigBlindAnte: number;
  nextSmallBlind: number | null;
  nextBigBlind: number | null;
  nextBigBlindAnte: number | null;
}

export interface RawPublicTable {
  /** Physical table identity: game_tables.id. Never tournament_tables.id. */
  tableId: string;
  label: string;
  status: string;
  maxSeats: number;
}

export interface RawPublicSeat {
  /** Must use the same physical identity as RawPublicTable.tableId. */
  tableId: string;
  seatNumber: number;
  playerName: string | null;
  chipCount: number | null;
  avatarUrl: string | null;
  isActive: boolean;
}

export class PublicSnapshotContractError extends Error {
  constructor(
    public readonly code: "DATA_CONTRACT_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "PublicSnapshotContractError";
  }
}

const COMPLETED_STATUSES = new Set(["completed", "finished", "closed", "cancelled"]);
const NOT_STARTED_STATUSES = new Set(["upcoming", "scheduled", "draft", "registration"]);
const RUNNING_TABLE_STATUSES = new Set(["running", "active", "open"]);

export function derivePublicClock(raw: RawPublicClock): PublicTournamentEventSnapshot["clock"] {
  const tournamentStatus = raw.tournamentStatus.trim().toLowerCase();
  const clockStatus = raw.clockStatus?.trim().toLowerCase() ?? "";

  let phase: PublicClockPhase;
  if (COMPLETED_STATUSES.has(tournamentStatus) || clockStatus === "completed") {
    phase = "completed";
  } else if (
    NOT_STARTED_STATUSES.has(tournamentStatus)
    || clockStatus === "not_started"
    || (!raw.isRunning && !raw.isBreak && raw.levelNumber == null)
  ) {
    phase = "not_started";
  } else if (raw.isBreak) {
    phase = "break";
  } else if (raw.isRunning) {
    phase = "running";
  } else {
    phase = "paused";
  }

  return {
    phase,
    isAdvancing: phase === "running",
    levelNumber: raw.levelNumber,
    remainingSeconds: normalizeOptionalCount(raw.remainingSeconds),
    smallBlind: normalizeCount(raw.smallBlind),
    bigBlind: normalizeCount(raw.bigBlind),
    bigBlindAnte: normalizeCount(raw.bigBlindAnte),
    nextSmallBlind: normalizeOptionalCount(raw.nextSmallBlind),
    nextBigBlind: normalizeOptionalCount(raw.nextBigBlind),
    nextBigBlindAnte: normalizeOptionalCount(raw.nextBigBlindAnte),
  };
}

export interface PublicTablesResult {
  tables: PublicTable[];
  hasOrphanSeats: boolean;
  hasInconsistentTable: boolean;
  activeSeatCount: number;
  allActiveChipsKnown: boolean;
  activeChipTotal: number;
}

export function buildPublicTables(
  tableRows: RawPublicTable[],
  seatRows: RawPublicSeat[],
): PublicTablesResult {
  const runningRows = tableRows.filter((row) => RUNNING_TABLE_STATUSES.has(row.status.toLowerCase()));
  const activeSeats = seatRows.filter((row) => row.isActive);

  for (const table of runningRows) {
    if (table.maxSeats !== 9) {
      throw new PublicSnapshotContractError(
        "DATA_CONTRACT_UNSUPPORTED",
        `Public table ${table.tableId} declares ${table.maxSeats} seats; only 9-max is supported.`,
      );
    }
  }

  const runningIds = new Set(runningRows.map((table) => table.tableId));
  const seatsByTable = new Map<string, RawPublicSeat[]>();
  let hasOrphanSeats = false;
  let activeChipTotal = 0;
  let allActiveChipsKnown = true;

  for (const seat of activeSeats) {
    if (!runningIds.has(seat.tableId)) {
      hasOrphanSeats = true;
      continue;
    }
    const bucket = seatsByTable.get(seat.tableId) ?? [];
    bucket.push(seat);
    seatsByTable.set(seat.tableId, bucket);
    if (seat.chipCount == null || !Number.isFinite(seat.chipCount) || seat.chipCount < 0) {
      allActiveChipsKnown = false;
    } else {
      activeChipTotal += seat.chipCount;
    }
  }

  let hasInconsistentTable = false;
  const tables = runningRows.map<PublicTable>((table) => {
    const occupied = seatsByTable.get(table.tableId) ?? [];
    const seen = new Set<number>();
    const invalid = occupied.some((seat) => {
      if (!Number.isInteger(seat.seatNumber) || seat.seatNumber < 1 || seat.seatNumber > 9) return true;
      if (seen.has(seat.seatNumber)) return true;
      seen.add(seat.seatNumber);
      return false;
    });
    hasInconsistentTable ||= invalid;

    const bySeat = invalid
      ? new Map<number, RawPublicSeat>()
      : new Map(occupied.map((seat) => [seat.seatNumber, seat]));

    return {
      id: table.tableId,
      label: table.label,
      status: "running",
      maxSeats: 9,
      dataQuality: invalid ? "inconsistent" : "exact",
      seats: Array.from({ length: 9 }, (_, index) => {
        const seatNumber = index + 1;
        const seat = bySeat.get(seatNumber);
        return {
          seatNumber,
          playerName: seat?.playerName ?? null,
          chipCount: seat?.chipCount ?? null,
          avatarUrl: seat?.avatarUrl ?? null,
        };
      }),
    };
  });

  return {
    tables,
    hasOrphanSeats,
    hasInconsistentTable,
    activeSeatCount: activeSeats.length,
    allActiveChipsKnown,
    activeChipTotal,
  };
}

export function derivePublicAverageStack(
  result: PublicTablesResult,
  playersRemaining: number | null,
): { averageStack: number | null; exact: boolean } {
  const complete = playersRemaining != null
    && playersRemaining > 0
    && result.activeSeatCount === playersRemaining
    && result.allActiveChipsKnown
    && !result.hasOrphanSeats
    && !result.hasInconsistentTable;

  if (!complete) return { averageStack: null, exact: false };
  return {
    averageStack: Math.round(result.activeChipTotal / playersRemaining),
    exact: true,
  };
}

export function tickPublicClock(
  remainingSeconds: number | null,
  isAdvancing: boolean,
  elapsedSeconds = 1,
): number | null {
  if (remainingSeconds == null || !isAdvancing) return remainingSeconds;
  return Math.max(0, remainingSeconds - Math.max(0, Math.floor(elapsedSeconds)));
}

export function isSnapshotStale(refreshedAt: string, nowMs: number, staleAfterMs = 15_000): boolean {
  const refreshedMs = Date.parse(refreshedAt);
  return !Number.isFinite(refreshedMs) || nowMs - refreshedMs > staleAfterMs;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeOptionalCount(value: number | null): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? Math.max(0, value) : null;
}
