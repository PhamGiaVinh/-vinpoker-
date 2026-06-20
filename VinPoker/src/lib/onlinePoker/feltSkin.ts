// src/lib/onlinePoker/feltSkin.ts
// UI-4 — optional table-felt SKIN preference (visual only). Default = the Stadium Dark
// EMERALD felt that preserves the PokerVN identity; "premium" is the warm burgundy + gold
// Casino Luxe skin, allowed ONLY inside the poker-table felt (never the global app theme).
// Persisted to localStorage; read/write never throw.

export type FeltSkin = 'emerald' | 'premium';
export const FELT_SKIN_KEY = 'vinpoker:poker:felt-skin';

/** Read the saved felt skin (default emerald). */
export function readFeltSkin(): FeltSkin {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FELT_SKIN_KEY) === 'premium'
      ? 'premium'
      : 'emerald';
  } catch {
    return 'emerald';
  }
}

/** Persist the felt skin. */
export function writeFeltSkin(skin: FeltSkin): void {
  try { localStorage.setItem(FELT_SKIN_KEY, skin); } catch { /* ignore */ }
}
