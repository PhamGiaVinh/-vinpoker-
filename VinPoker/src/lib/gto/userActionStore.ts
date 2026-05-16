import { GTOAction, GTOPosition, OPEN_RANGE_50BB } from "./openRanges50bb";
import { handAt } from "./handMath";

export type UserActionMap = Record<GTOPosition, Record<string, GTOAction>>;

const KEY = "gto.userActionMap";

export function allHands(): string[] {
  const arr: string[] = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) arr.push(handAt(r, c));
  return arr;
}

export function seedFromGTO(pos: GTOPosition): Record<string, GTOAction> {
  const src = OPEN_RANGE_50BB[pos];
  const out: Record<string, GTOAction> = {};
  for (const h of allHands()) out[h] = (src[h] ?? "fold") as GTOAction;
  return out;
}

export function loadUserMap(): Partial<UserActionMap> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<UserActionMap>;
  } catch {
    return {};
  }
}

export function saveUserMap(map: Partial<UserActionMap>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function clearAllToFold(): Record<string, GTOAction> {
  const out: Record<string, GTOAction> = {};
  for (const h of allHands()) out[h] = "fold";
  return out;
}
