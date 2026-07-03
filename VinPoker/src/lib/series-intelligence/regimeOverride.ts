// Series Intelligence — LOCAL-ONLY "regime changed" mark (PR5b, pure + persistence, client-only).
//
// The regime caveat (RegimeNotice) is static: "the current market/legal regime is ASSUMED to hold".
// This lets the owner actively MARK "the regime has changed" (law tightened / legalized / crackdown)
// so every forward-looking number escalates its warning.
//
// ⚠️ SCOPE — LOCAL ONLY. This is stored in THIS browser's localStorage. It is NOT a club setting: other
// operators, other devices, and other agents do NOT see it. The official club-wide regime flag (DB +
// audit of who flipped it) is a separate, owner-gated increment. Copy in the UI must say so.
//
// SAFETY: localStorage only, never touches the DB. Stored JSON is untrusted → validated to a fixed
// shape (we do NOT iterate its keys, so no prototype-pollution surface; still coerce every field).

export const REGIME_OVERRIDE_STORAGE_KEY = "vinpoker.seriesRegimeOverride.v1";
export const REGIME_OVERRIDE_VERSION = 1;
export const MAX_REGIME_NOTE_LEN = 280;

export interface RegimeMark {
  version: number;
  /** true = owner has flagged that the regime changed → forward-looking numbers should escalate. */
  changed: boolean;
  /** Optional short owner note (why / what changed). Capped + trimmed. */
  note: string;
  /** ISO instant the mark was last set to `changed:true` (null when not changed). */
  markedAt: string | null;
}

export function emptyRegimeMark(): RegimeMark {
  return { version: REGIME_OVERRIDE_VERSION, changed: false, note: "", markedAt: null };
}

const coerceNote = (v: unknown): string => (typeof v === "string" ? v : "").slice(0, MAX_REGIME_NOTE_LEN);

/** Parse untrusted stored JSON → a valid RegimeMark (fixed shape; bad/missing fields → safe defaults). */
export function parseRegimeMark(raw: string | null): RegimeMark {
  if (!raw) return emptyRegimeMark();
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return emptyRegimeMark();
  }
  if (typeof obj !== "object" || obj === null) return emptyRegimeMark();
  const o = obj as Record<string, unknown>;
  const changed = o.changed === true;
  const markedAt = typeof o.markedAt === "string" ? o.markedAt : null;
  return {
    version: REGIME_OVERRIDE_VERSION,
    changed,
    note: coerceNote(o.note),
    // markedAt only meaningful when changed; drop a stale timestamp if not changed.
    markedAt: changed ? markedAt : null,
  };
}

/**
 * Pure reducer: set the changed flag + note, stamping `markedAt` from the supplied `nowIso` when it
 * transitions into `changed` (keeps an existing timestamp if already changed; clears it when unset).
 * `nowIso` is passed in (not read from the clock) so the reducer stays pure/testable.
 */
export function setRegimeChanged(prev: RegimeMark, changed: boolean, note: string, nowIso: string): RegimeMark {
  return {
    version: REGIME_OVERRIDE_VERSION,
    changed,
    note: coerceNote(note),
    markedAt: changed ? (prev.changed && prev.markedAt ? prev.markedAt : nowIso) : null,
  };
}

export function serializeRegimeMark(mark: RegimeMark): string {
  return JSON.stringify({
    version: REGIME_OVERRIDE_VERSION,
    changed: mark.changed,
    note: coerceNote(mark.note),
    markedAt: mark.changed ? mark.markedAt : null,
  });
}

// --- browser I/O (guarded; never throws into React) -------------------------

export function loadRegimeMark(): RegimeMark {
  if (typeof window === "undefined") return emptyRegimeMark();
  try {
    return parseRegimeMark(window.localStorage.getItem(REGIME_OVERRIDE_STORAGE_KEY));
  } catch {
    return emptyRegimeMark();
  }
}

function writeRegimeMark(mark: RegimeMark): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REGIME_OVERRIDE_STORAGE_KEY, serializeRegimeMark(mark));
  } catch {
    /* quota / disabled storage — non-fatal, the mark just won't persist */
  }
}

// --- same-tab reactive store (useSyncExternalStore backing) -----------------
// localStorage's `storage` event only fires in OTHER tabs; this tiny store keeps every
// useRegimeOverride() consumer in the SAME tab in sync when the switch toggles.

const listeners = new Set<() => void>();
let snapshot: RegimeMark | null = null;

export function getRegimeSnapshot(): RegimeMark {
  if (snapshot === null) snapshot = loadRegimeMark();
  return snapshot;
}

export function subscribeRegime(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === REGIME_OVERRIDE_STORAGE_KEY) {
      snapshot = loadRegimeMark();
      listeners.forEach((l) => l());
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Commit a new mark: persist + update the shared snapshot + notify same-tab subscribers. */
export function commitRegimeMark(mark: RegimeMark): void {
  writeRegimeMark(mark);
  snapshot = mark;
  listeners.forEach((l) => l());
}
