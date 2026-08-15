import type {
  PublicClockPhase,
  PublicTournamentEventSnapshot,
} from "./publicTournamentEvent";

const longName = "Nguyễn Trung Kiên Championship Edition";

function makeSeats(
  rows: Array<[number, string, number]>,
): PublicTournamentEventSnapshot["tables"][number]["seats"] {
  const bySeat = new Map(rows.map(([seatNumber, playerName, chipCount]) => [seatNumber, { playerName, chipCount }]));
  return Array.from({ length: 9 }, (_, index) => {
    const seatNumber = index + 1;
    const row = bySeat.get(seatNumber);
    return {
      seatNumber,
      playerName: row?.playerName ?? null,
      chipCount: row?.chipCount ?? null,
      avatarUrl: null,
    };
  });
}

export function makePublicTournamentFixture(
  phase: PublicClockPhase = "running",
  quality: PublicTournamentEventSnapshot["dataQuality"] = "exact",
): PublicTournamentEventSnapshot {
  const isAdvancing = phase === "running";
  return {
    tournament: {
      id: "fixture-public-event",
      name: "HSOP · Main Event Championship",
      status: phase === "completed" ? "completed" : phase === "not_started" ? "upcoming" : "live",
    },
    clock: {
      phase,
      isAdvancing,
      levelNumber: phase === "not_started" ? null : 14,
      remainingSeconds: phase === "not_started" || phase === "completed" ? null : 12 * 60 + 18,
      smallBlind: phase === "not_started" ? 0 : 50_000,
      bigBlind: phase === "not_started" ? 0 : 100_000,
      bigBlindAnte: phase === "not_started" ? 0 : 100_000,
      nextSmallBlind: phase === "completed" ? null : 75_000,
      nextBigBlind: phase === "completed" ? null : 150_000,
      nextBigBlindAnte: phase === "completed" ? null : 150_000,
    },
    entries: 188,
    playersRemaining: 16,
    averageStack: quality === "partial" ? null : 2_937_500,
    structure: [
      { levelNumber: 13, smallBlind: 40_000, bigBlind: 80_000, bigBlindAnte: 80_000, durationMinutes: 40, isBreak: false },
      { levelNumber: 14, smallBlind: 50_000, bigBlind: 100_000, bigBlindAnte: 100_000, durationMinutes: 40, isBreak: false },
      { levelNumber: 15, smallBlind: 75_000, bigBlind: 150_000, bigBlindAnte: 150_000, durationMinutes: 40, isBreak: false },
      { levelNumber: 16, smallBlind: 0, bigBlind: 0, bigBlindAnte: 0, durationMinutes: 15, isBreak: true },
    ],
    tables: [
      {
        id: "physical-table-55",
        label: "Bàn 55",
        status: "running",
        maxSeats: 9,
        dataQuality: "exact",
        seats: makeSeats([
          [1, "Vũ Đức Tâm", 4_000_000],
          [2, "Sơn Hwi Young", 3_850_000],
          [3, longName, 7_420_000],
          [4, "Bạch Đăng Huy", 1_240_000],
          [5, "Hwang YangHo", 5_670_000],
          [6, "Nguyễn Minh Hiếu", 2_350_000],
          [8, "Yang Qun", 890_000],
        ]),
      },
      {
        id: "physical-table-56",
        label: "Bàn 56",
        status: "running",
        maxSeats: 9,
        dataQuality: "exact",
        seats: makeSeats([]),
      },
      {
        id: "physical-table-57",
        label: "Bàn 57",
        status: "running",
        maxSeats: 9,
        dataQuality: quality === "partial" ? "inconsistent" : "exact",
        seats: makeSeats([
          [1, "Phil Ivey", 6_200_000],
          [2, "Tom Dwan", 1_430_000],
          [5, "Adrian Mateos", 3_020_000],
          [7, "Jungleman", 9_900_000],
          [9, "Samuel Muller", 770_000],
        ]),
      },
    ],
    refreshedAt: quality === "stale" ? "2026-08-15T10:00:00.000Z" : new Date().toISOString(),
    dataQuality: quality,
  };
}
