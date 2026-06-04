import { PRESETS } from "./presets";
import { percentRange } from "./handMath";

function presetPercent(name: string): number {
  const hands = PRESETS[name];
  if (!hands) return 100;
  return percentRange(hands);
}

/** Heuristic equity from range tightness — NOT a real solver. */
function heuristicEquity(heroPct: number, villainPct: number) {
  // Tighter range → higher equity. Diff drives advantage.
  const diff = villainPct - heroPct; // bigger = villain looser = hero better
  const hero = Math.max(35, Math.min(72, 50 + diff * 0.35));
  return { hero, villain: 100 - hero, tie: 0 };
}
