import { describe, expect, it } from "vitest";
import type { TvData } from "@/types/tv";
import { mapTvDataToClock } from "./mapClockData";

// Locks the owner's P0 data-correctness rules so they can't silently regress.
const BASE: TvData = {
  tournamentName: "T",
  clubName: "C",
  clubLogoUrl: null,
  eventNote: null,
  status: "live",
  isRunning: true,
  isBreak: false,
  remainingSeconds: 600,
  currentLevel: { levelNumber: 7, smallBlind: 1000, bigBlind: 2000, ante: 0, durationMinutes: 20, isBreak: false },
  nextLevel: { levelNumber: 8, smallBlind: 1500, bigBlind: 3000, ante: 0, durationMinutes: 20, isBreak: false },
  nextBreakSeconds: 300,
  playersRemaining: 40,
  totalEntries: 90,
  reEntries: 12,
  averageStack: 50_000,
  totalBuyIns: 90_000_000,
  prizePool: null,
  guarantee: null,
  prizes: [
    { position: 1, amount: 35_000_000 },
    { position: 2, amount: 21_000_000 },
  ],
  sponsorText: null,
  startingStack: 30_000,
  buyIn: 1_000_000,
  rakeAmount: 100_000,
  clubCoverUrl: "https://cdn/cover.jpg",
};

describe("mapTvDataToClock — owner P0 data-correctness rules", () => {
  it("prizePool P0-2: uses a real positive prize_pool when present", () => {
    expect(mapTvDataToClock({ ...BASE, prizePool: 120_000_000 }).prizePool).toContain("120.000.000");
  });
  it("prizePool P0-2: falls back to GTD when prize_pool is 0/null (never stale)", () => {
    expect(mapTvDataToClock({ ...BASE, prizePool: 0, guarantee: 100_000_000 }).prizePool).toContain("100.000.000");
  });
  it("prizePool P0-2: estimates from confirmed buy-ins when no prize_pool/GTD", () => {
    expect(mapTvDataToClock({ ...BASE, prizePool: null, guarantee: null, totalBuyIns: 90_000_000 }).prizePool).toContain("90.000.000");
  });
  it("prizePool P0-2: estimates entries × (buy_in − rake) when buy-ins missing", () => {
    // 90 × (1,000,000 − 100,000) = 81,000,000
    expect(mapTvDataToClock({ ...BASE, prizePool: null, guarantee: null, totalBuyIns: null }).prizePool).toContain("81.000.000");
  });
  it('prizePool P0-2: "—" when nothing is known', () => {
    expect(mapTvDataToClock({ ...BASE, prizePool: null, guarantee: null, totalBuyIns: null, buyIn: null }).prizePool).toBe("—");
  });
  it("totalChips P0-1: prefers average × remaining when both real", () => {
    // 50,000 × 40 = 2,000,000
    expect(mapTvDataToClock(BASE).totalChips).toContain("2.000.000");
  });
  it("totalChips P0-1: falls back to entries × starting_stack", () => {
    // 90 × 30,000 = 2,700,000
    expect(mapTvDataToClock({ ...BASE, averageStack: 0, playersRemaining: 0 }).totalChips).toContain("2.700.000");
  });
  it("players P0-3: falls back to entries when remaining is 0", () => {
    expect(mapTvDataToClock({ ...BASE, playersRemaining: 0 }).players).toBe(90);
  });
  it("nextBreak P0-4: passes null through (component shows —, never 00:00)", () => {
    expect(mapTvDataToClock({ ...BASE, nextBreakSeconds: null }).nextBreakSecondsLeft).toBeNull();
  });
  it("maps payout rank labels + club cover → background", () => {
    const r = mapTvDataToClock(BASE);
    expect(r.payouts[0].rank).toBe("1st");
    expect(r.clubBackgroundUrl).toBe("https://cdn/cover.jpg");
  });
});
