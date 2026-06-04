export type Street = "preflop" | "flop" | "turn" | "river";
const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

export interface EVAction {
  action: string;
  ev: number;
  freq: number;
}

const DEFAULT_EV_DATA: Record<Street, EVAction[]> = {
  preflop: [
    { action: "Fold", ev: -1.0, freq: 30 },
    { action: "Call", ev: 0.25, freq: 40 },
    { action: "Raise 2.5x", ev: 0.75, freq: 20 },
    { action: "Raise 3x", ev: 0.5, freq: 10 },
  ],
  flop: [
    { action: "Check", ev: -0.5, freq: 35 },
    { action: "Bet 1/3", ev: 0.8, freq: 25 },
    { action: "Bet 2/3", ev: 0.6, freq: 40 },
  ],
  turn: [
    { action: "Check", ev: -0.3, freq: 45 },
    { action: "Bet 1/2", ev: 0.4, freq: 30 },
    { action: "Bet Pot", ev: 0.2, freq: 25 },
  ],
  river: [
    { action: "Check", ev: -0.2, freq: 60 },
    { action: "Bet 2/3", ev: 0.35, freq: 25 },
    { action: "All-In", ev: -0.1, freq: 15 },
  ],
};

const KEY = "gto.evCustom";

function loadEV(): Record<Street, EVAction[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_EV_DATA);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_EV_DATA), ...parsed };
  } catch {
    return structuredClone(DEFAULT_EV_DATA);
  }
}

function saveEV(data: Record<Street, EVAction[]>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function resetEV() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
