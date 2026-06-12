import { describe, expect, it } from "vitest";
import { computeNextBreak } from "./computeNextBreak";
import type { TvLevel } from "@/types/tv";

const level = (levelNumber: number, durationMinutes: number, isBreak = false): TvLevel => ({
  levelNumber,
  smallBlind: isBreak ? 0 : levelNumber * 100,
  bigBlind: isBreak ? 0 : levelNumber * 200,
  ante: isBreak ? 0 : levelNumber * 200,
  durationMinutes,
  isBreak,
});

const LEVELS: TvLevel[] = [
  level(1, 20),
  level(2, 20),
  level(3, 10, true),
  level(4, 20),
  level(5, 20),
];

describe("computeNextBreak", () => {
  it("sums current remaining plus full levels until the break", () => {
    // level 1 with 5:00 left → 300 + level 2 (1200) = 1500s to the level-3 break
    expect(computeNextBreak(LEVELS, 1, 300)).toBe(1500);
  });

  it("returns just the remaining seconds when the break is next", () => {
    expect(computeNextBreak(LEVELS, 2, 47)).toBe(47);
  });

  it("returns null while on a break level", () => {
    expect(computeNextBreak(LEVELS, 3, 600)).toBeNull();
  });

  it("returns null when no break lies ahead", () => {
    expect(computeNextBreak(LEVELS, 4, 900)).toBeNull();
    expect(computeNextBreak(LEVELS, 5, 900)).toBeNull();
  });

  it("returns null for unknown or missing level numbers", () => {
    expect(computeNextBreak(LEVELS, 99, 300)).toBeNull();
    expect(computeNextBreak(LEVELS, null, 300)).toBeNull();
    expect(computeNextBreak([], 1, 300)).toBeNull();
  });
});
