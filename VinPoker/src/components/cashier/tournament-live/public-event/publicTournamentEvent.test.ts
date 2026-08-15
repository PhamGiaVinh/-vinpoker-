import { describe, expect, it } from "vitest";
import {
  PublicSnapshotContractError,
  buildPublicTables,
  derivePublicAverageStack,
  derivePublicClock,
  isSnapshotStale,
  tickPublicClock,
  type RawPublicSeat,
  type RawPublicTable,
} from "./publicTournamentEvent";

const table = (overrides: Partial<RawPublicTable> = {}): RawPublicTable => ({
  tableId: "physical-table-55",
  label: "Bàn 55",
  status: "running",
  maxSeats: 9,
  ...overrides,
});

const seat = (overrides: Partial<RawPublicSeat> = {}): RawPublicSeat => ({
  tableId: "physical-table-55",
  seatNumber: 1,
  playerName: "Nguyễn Trung Kiên",
  chipCount: 40_000,
  avatarUrl: null,
  isActive: true,
  ...overrides,
});

describe("derivePublicClock", () => {
  const base = {
    tournamentStatus: "live",
    clockStatus: "paused",
    isRunning: false,
    isBreak: false,
    levelNumber: 7,
    remainingSeconds: 735,
    smallBlind: 5_000,
    bigBlind: 10_000,
    bigBlindAnte: 10_000,
    nextSmallBlind: 6_000,
    nextBigBlind: 12_000,
    nextBigBlindAnte: 12_000,
  };

  it.each([
    [{ ...base, tournamentStatus: "completed", isRunning: true }, "completed", false],
    [{ ...base, tournamentStatus: "upcoming", isBreak: true }, "not_started", false],
    [{ ...base, isBreak: true, isRunning: true }, "break", false],
    [{ ...base, isRunning: true }, "running", true],
    [base, "paused", false],
  ] as const)("uses explicit precedence for %s", (raw, phase, isAdvancing) => {
    expect(derivePublicClock(raw)).toMatchObject({ phase, isAdvancing });
  });
});

describe("buildPublicTables", () => {
  it("keeps an authoritative running 0/9 table", () => {
    const result = buildPublicTables([table()], []);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].seats).toHaveLength(9);
    expect(result.tables[0].seats.every((row) => row.playerName == null)).toBe(true);
  });

  it("never builds a fake table for an orphan active seat", () => {
    const result = buildPublicTables([table()], [seat({ tableId: "closed-table" })]);
    expect(result.tables.map((row) => row.id)).toEqual(["physical-table-55"]);
    expect(result.hasOrphanSeats).toBe(true);
  });

  it.each([[0], [10], [2.5]])("fails closed on invalid seat %s", (seatNumber) => {
    const result = buildPublicTables([table()], [seat({ seatNumber })]);
    expect(result.tables[0].dataQuality).toBe("inconsistent");
    expect(result.tables[0].seats.every((row) => row.playerName == null)).toBe(true);
  });

  it("fails closed on duplicate seats", () => {
    const result = buildPublicTables([table()], [seat(), seat({ playerName: "Yang Qun" })]);
    expect(result.tables[0].dataQuality).toBe("inconsistent");
  });

  it("rejects a non-9-max contract instead of dropping seat 10", () => {
    expect(() => buildPublicTables([table({ maxSeats: 10 })], [])).toThrowError(PublicSnapshotContractError);
  });

  it("does not render a closed table", () => {
    expect(buildPublicTables([table({ status: "closed" })], []).tables).toEqual([]);
  });
});

describe("public snapshot quality", () => {
  it("computes average stack only for a complete matching roster", () => {
    const exact = buildPublicTables(
      [table()],
      [seat({ chipCount: 40_000 }), seat({ seatNumber: 2, chipCount: 20_000 })],
    );
    expect(derivePublicAverageStack(exact, 2)).toEqual({ averageStack: 30_000, exact: true });
    expect(derivePublicAverageStack(exact, 3)).toEqual({ averageStack: null, exact: false });
  });

  it("only advances the local timer while the clock is running", () => {
    expect(tickPublicClock(120, true)).toBe(119);
    expect(tickPublicClock(120, false)).toBe(120);
    expect(tickPublicClock(0, true)).toBe(0);
  });

  it("marks a last-good snapshot stale after 15 seconds", () => {
    const refreshedAt = "2026-08-15T10:00:00.000Z";
    expect(isSnapshotStale(refreshedAt, Date.parse(refreshedAt) + 15_000)).toBe(false);
    expect(isSnapshotStale(refreshedAt, Date.parse(refreshedAt) + 15_001)).toBe(true);
  });
});
