import { useEffect, useState } from "react";
import type { TvData, TvLevel } from "@/types/tv";

// Self-ticking mock for the TV shell (PR A). PR B replaces this with
// useTournamentTvData; the TvData contract is identical so TvClockScreen
// never changes. The mock advances levels on zero and walks into the
// scheduled break so every visual state is demoable.

const MOCK_LEVELS: TvLevel[] = [
  { levelNumber: 1, smallBlind: 100, bigBlind: 200, ante: 200, durationMinutes: 20, isBreak: false },
  { levelNumber: 2, smallBlind: 200, bigBlind: 400, ante: 400, durationMinutes: 20, isBreak: false },
  { levelNumber: 3, smallBlind: 300, bigBlind: 600, ante: 600, durationMinutes: 20, isBreak: false },
  { levelNumber: 4, smallBlind: 400, bigBlind: 800, ante: 800, durationMinutes: 20, isBreak: false },
  { levelNumber: 5, smallBlind: 0, bigBlind: 0, ante: 0, durationMinutes: 10, isBreak: true },
  { levelNumber: 6, smallBlind: 500, bigBlind: 1000, ante: 1000, durationMinutes: 20, isBreak: false },
  { levelNumber: 7, smallBlind: 700, bigBlind: 1400, ante: 1400, durationMinutes: 20, isBreak: false },
  { levelNumber: 8, smallBlind: 1000, bigBlind: 2000, ante: 2000, durationMinutes: 20, isBreak: false },
  { levelNumber: 9, smallBlind: 1500, bigBlind: 3000, ante: 3000, durationMinutes: 20, isBreak: false },
  { levelNumber: 10, smallBlind: 0, bigBlind: 0, ante: 0, durationMinutes: 10, isBreak: true },
  { levelNumber: 11, smallBlind: 2000, bigBlind: 4000, ante: 4000, durationMinutes: 20, isBreak: false },
  { levelNumber: 12, smallBlind: 3000, bigBlind: 6000, ante: 6000, durationMinutes: 20, isBreak: false },
];

interface MockState {
  levelIndex: number;
  remainingSeconds: number;
  isRunning: boolean;
}

const INITIAL_STATE: MockState = {
  levelIndex: 7, // level 8 — matches the reference layout
  remainingSeconds: 23 * 60 + 41,
  isRunning: true,
};

function tickMock(state: MockState): MockState {
  if (!state.isRunning) return state;
  if (state.remainingSeconds > 1) {
    return { ...state, remainingSeconds: state.remainingSeconds - 1 };
  }
  const nextIndex = state.levelIndex + 1;
  if (nextIndex >= MOCK_LEVELS.length) {
    return { ...state, remainingSeconds: 0, isRunning: false };
  }
  return {
    levelIndex: nextIndex,
    remainingSeconds: MOCK_LEVELS[nextIndex].durationMinutes * 60,
    isRunning: true,
  };
}

function nextBreakSeconds(
  levels: TvLevel[],
  levelIndex: number,
  remainingSeconds: number,
): number | null {
  const current = levels[levelIndex];
  if (!current || current.isBreak) return null;
  let total = remainingSeconds;
  for (let i = levelIndex + 1; i < levels.length; i++) {
    if (levels[i].isBreak) return total;
    total += levels[i].durationMinutes * 60;
  }
  return null;
}

function toTvData(state: MockState): TvData {
  const currentLevel = MOCK_LEVELS[state.levelIndex] ?? null;
  const nextLevel = MOCK_LEVELS[state.levelIndex + 1] ?? null;
  return {
    tournamentName: "VinPoker Weekly Deepstack",
    clubName: "VinPoker Club",
    clubLogoUrl: null,
    eventNote: "Hết đăng ký đầu Level 11",
    status: "live",
    isRunning: state.isRunning,
    isBreak: currentLevel?.isBreak ?? false,
    remainingSeconds: state.remainingSeconds,
    currentLevel,
    nextLevel,
    nextBreakSeconds: nextBreakSeconds(MOCK_LEVELS, state.levelIndex, state.remainingSeconds),
    playersRemaining: 42,
    totalEntries: 97,
    reEntries: 12,
    averageStack: 48500,
    totalBuyIns: 97_000_000,
    prizePool: 87_300_000,
    guarantee: 100_000_000,
    prizes: [
      { position: 1, amount: 35_000_000 },
      { position: 2, amount: 21_000_000 },
      { position: 3, amount: 13_000_000 },
      { position: 4, amount: 8_500_000 },
      { position: 5, amount: 5_300_000 },
      { position: 6, amount: 4_500_000 },
    ],
    sponsorText: null,
  };
}

/** Mock TvData ticking once per second. PR A demo source only. */
export function useMockTvData(): TvData {
  const [state, setState] = useState<MockState>(INITIAL_STATE);

  useEffect(() => {
    const id = setInterval(() => setState(tickMock), 1000);
    return () => clearInterval(id);
  }, []);

  return toTvData(state);
}
