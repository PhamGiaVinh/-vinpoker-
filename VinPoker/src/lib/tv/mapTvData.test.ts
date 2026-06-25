import { describe, expect, it } from "vitest";
import {
  mapTournamentStatus,
  mapTvData,
  type ClockRpcPayload,
  type TvDataSources,
  type TvTournamentRow,
} from "./mapTvData";

// Fixtures mirror the real payload shapes:
// get_tournament_clock JSONB (migration 20260608000001) + table rows.

const RUNNING_CLOCK: ClockRpcPayload = {
  tournament_id: "t-1",
  status: "live",
  is_running: true,
  elapsed_seconds: 180,
  remaining_seconds: 1020,
  current_level: {
    id: "lv-8",
    level_number: 8,
    small_blind: 1000,
    big_blind: 2000,
    ante: 2000,
    duration_minutes: 20,
    is_break: false,
  },
  is_break: false,
  next_level: {
    id: "lv-9",
    level_number: 9,
    small_blind: 1500,
    big_blind: 3000,
    ante: 3000,
    duration_minutes: 20,
    is_break: false,
  },
};

const TOURNAMENT: TvTournamentRow = {
  name: "VinPoker Weekly Deepstack",
  status: "live",
  players_remaining: 42,
  average_stack: 48500,
  prize_pool: 87_300_000,
  starting_stack: 30_000,
  guarantee_amount: null,
  buy_in: 1_000_000,
  rake_amount: 100_000,
  club: { name: "VinPoker Club", cover_url: null, tv_logo_url: null, tv_brand_name: null, tv_bg_url: null },
};

const LEVEL_ROWS = [
  { level_number: 8, small_blind: 1000, big_blind: 2000, ante: 2000, duration_minutes: 20, is_break: false },
  { level_number: 9, small_blind: 1500, big_blind: 3000, ante: 3000, duration_minutes: 20, is_break: false },
  { level_number: 10, small_blind: 0, big_blind: 0, ante: 0, duration_minutes: 10, is_break: true },
];

const SOURCES: TvDataSources = {
  clock: RUNNING_CLOCK,
  tournament: TOURNAMENT,
  levels: LEVEL_ROWS,
  totalEntries: 97,
  totalBuyIns: 97_000_000,
  reEntries: 12,
  prizes: [
    { position: 2, amount: "21000000.00" }, // NUMERIC arrives as string — must coerce
    { position: 1, amount: 35_000_000 },
  ],
  displayRemainingSeconds: 1015,
};

describe("mapTournamentStatus", () => {
  it("maps DB statuses onto the TvTournamentStatus union", () => {
    expect(mapTournamentStatus("live")).toBe("live");
    expect(mapTournamentStatus("active")).toBe("live");
    expect(mapTournamentStatus("break")).toBe("live");
    expect(mapTournamentStatus("final_table")).toBe("final_table");
    expect(mapTournamentStatus("finished")).toBe("finished");
    expect(mapTournamentStatus("completed")).toBe("finished");
    expect(mapTournamentStatus("cancelled")).toBe("cancelled");
    expect(mapTournamentStatus("upcoming")).toBe("scheduled");
    expect(mapTournamentStatus("registering")).toBe("scheduled");
    expect(mapTournamentStatus("drawing")).toBe("scheduled");
    expect(mapTournamentStatus(null)).toBe("scheduled");
  });
});

describe("mapTvData", () => {
  it("maps a running clock payload into the frozen TvData contract", () => {
    const data = mapTvData(SOURCES);
    expect(data.tournamentName).toBe("VinPoker Weekly Deepstack");
    expect(data.clubName).toBe("VinPoker Club");
    expect(data.status).toBe("live");
    expect(data.isRunning).toBe(true);
    expect(data.isBreak).toBe(false);
    expect(data.remainingSeconds).toBe(1015); // drift-corrected display value, not the RPC snapshot
    expect(data.currentLevel).toEqual({
      levelNumber: 8,
      smallBlind: 1000,
      bigBlind: 2000,
      ante: 2000,
      durationMinutes: 20,
      isBreak: false,
    });
    expect(data.nextLevel?.levelNumber).toBe(9);
    // 1015 left in lv8 + full lv9 (1200) = 2215s to the lv10 break
    expect(data.nextBreakSeconds).toBe(2215);
    expect(data.playersRemaining).toBe(42);
    expect(data.totalEntries).toBe(97);
    expect(data.reEntries).toBe(12);
    expect(data.averageStack).toBe(48500);
    expect(data.totalBuyIns).toBe(97_000_000);
    expect(data.prizePool).toBe(87_300_000);
  });

  it("coerces NUMERIC prize strings and sorts by position", () => {
    const data = mapTvData(SOURCES);
    expect(data.prizes).toEqual([
      { position: 1, amount: 35_000_000 },
      { position: 2, amount: 21_000_000 },
    ]);
  });

  it("hides schema-less fields instead of inventing placeholders", () => {
    const data = mapTvData(SOURCES);
    expect(data.eventNote).toBeNull();
    expect(data.guarantee).toBeNull();
    expect(data.clubLogoUrl).toBeNull();
    expect(data.sponsorText).toBeNull();
  });

  it("handles the clock-not-started payload as a pre-start screen", () => {
    const data = mapTvData({
      ...SOURCES,
      clock: {
        tournament_id: "t-1",
        status: "registering",
        is_running: false,
        elapsed_seconds: 0,
        remaining_seconds: 0,
        current_level: null,
        is_break: false,
        message: "Clock not started",
      },
      tournament: { ...TOURNAMENT, status: "registering" },
      displayRemainingSeconds: 0,
    });
    expect(data.status).toBe("scheduled");
    expect(data.isRunning).toBe(false);
    expect(data.currentLevel).toBeNull();
    expect(data.nextLevel).toBeNull();
    expect(data.nextBreakSeconds).toBeNull();
    expect(data.remainingSeconds).toBe(0);
  });

  it("passes failed-aggregate nulls through so tiles hide", () => {
    const data = mapTvData({ ...SOURCES, totalBuyIns: null, reEntries: null });
    expect(data.totalBuyIns).toBeNull();
    expect(data.reEntries).toBeNull();
  });

  it("flags break state from the clock payload during break levels", () => {
    const data = mapTvData({
      ...SOURCES,
      clock: {
        ...RUNNING_CLOCK,
        is_break: true,
        current_level: {
          id: "lv-10",
          level_number: 10,
          small_blind: 0,
          big_blind: 0,
          ante: 0,
          duration_minutes: 10,
          is_break: true,
        },
        next_level: null,
      },
      displayRemainingSeconds: 480,
    });
    expect(data.isBreak).toBe(true);
    expect(data.nextBreakSeconds).toBeNull(); // on the break itself
  });

  it("defaults missing numeric fields to safe zeros", () => {
    const data = mapTvData({
      ...SOURCES,
      tournament: { ...TOURNAMENT, players_remaining: null, average_stack: null, prize_pool: null, club: null },
    });
    expect(data.playersRemaining).toBe(0);
    expect(data.averageStack).toBe(0);
    expect(data.prizePool).toBeNull();
    expect(data.clubName).toBe("");
  });

  it("drops zero/invalid prize rows", () => {
    const data = mapTvData({
      ...SOURCES,
      prizes: [
        { position: 1, amount: 0 },
        { position: 2, amount: "not-a-number" },
        { position: 3, amount: 5_000_000 },
      ],
    });
    expect(data.prizes).toEqual([{ position: 3, amount: 5_000_000 }]);
  });
});
