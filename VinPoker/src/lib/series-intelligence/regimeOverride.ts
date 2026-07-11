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

// --- TP8: per-club scoping + migration (pure) -------------------------------
// The mark used to be a single GLOBAL localStorage key. TP8 makes it PER-CLUB (so one owner's clubs don't
// share a regime mark), keyed by clubId. An empty clubId ("") keeps the legacy global key — that is exactly
// the pre-TP8 behavior, so with the flag off (no clubId ever supplied) every path is byte-identical.

/** Storage key for a club. Empty/absent clubId → the legacy global key (pre-TP8 behavior). */
export function keyFor(clubId: string | null | undefined): string {
  return clubId ? `${REGIME_OVERRIDE_STORAGE_KEY}.${clubId}` : REGIME_OVERRIDE_STORAGE_KEY;
}

/** A mark is "content" (worth migrating / keeping) when it is changed or carries a note. */
export function regimeMarkHasContent(m: RegimeMark): boolean {
  return m.changed || m.note.trim() !== "";
}

/**
 * PURE decision for a club's effective mark from the two raw strings (per-club key + legacy global key).
 * Per-club wins when it has content; else fall back to the legacy global mark and flag it to be MIGRATED
 * into the per-club key once. Global context (clubId "") always uses its own raw, never migrates.
 */
export function resolveClubMark(
  perClubRaw: string | null,
  legacyRaw: string | null,
  clubId: string,
): { mark: RegimeMark; migrate: boolean } {
  const perClub = parseRegimeMark(perClubRaw);
  if (!clubId || regimeMarkHasContent(perClub)) return { mark: perClub, migrate: false };
  const legacy = parseRegimeMark(legacyRaw);
  if (regimeMarkHasContent(legacy)) return { mark: legacy, migrate: true }; // one-time migrate → per-club key
  return { mark: emptyRegimeMark(), migrate: false };
}

// --- TP8: local watchlist tripwire (pure) -----------------------------------
/** Static local "regime may have changed" signals shown when seriesRegimeTripwire is on. LOCAL-only nudge. */
export const REGIME_WATCHLIST: readonly string[] = [
  "Tin kiểm tra / công an",
  "Động thái Liên đoàn Bridge & Poker",
  "Club đối thủ đóng cửa",
  "Đổi kênh thanh toán",
  "Tin pilot casino người Việt",
];
export const REGIME_WATCHLIST_THRESHOLD = 2;
/** ≥ threshold watchlist signals ticked ⇒ suggest the owner consider marking the regime as changed. */
export function watchlistSuggestsRegimeChange(checkedCount: number): boolean {
  return checkedCount >= REGIME_WATCHLIST_THRESHOLD;
}

// --- browser I/O (guarded; never throws into React) -------------------------

export function loadRegimeMark(clubId = ""): RegimeMark {
  if (typeof window === "undefined") return emptyRegimeMark();
  try {
    const key = keyFor(clubId);
    const perClubRaw = window.localStorage.getItem(key);
    const legacyRaw = clubId ? window.localStorage.getItem(REGIME_OVERRIDE_STORAGE_KEY) : null;
    const { mark, migrate } = resolveClubMark(perClubRaw, legacyRaw, clubId);
    if (migrate) writeRegimeMark(key, mark); // persist the migration once so it doesn't re-run
    return mark;
  } catch {
    return emptyRegimeMark();
  }
}

function writeRegimeMark(key: string, mark: RegimeMark): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, serializeRegimeMark(mark));
  } catch {
    /* quota / disabled storage — non-fatal, the mark just won't persist */
  }
}

// --- same-tab reactive store (useSyncExternalStore backing) -----------------
// localStorage's `storage` event only fires in OTHER tabs; this tiny store keeps every
// useRegimeOverride() consumer in the SAME tab in sync when the switch toggles. `activeClubId` is set by
// the (flag-gated) setter component; readers follow it, so RegimeNotice needs no clubId prop. Default "" =
// global key = pre-TP8 behavior.

const listeners = new Set<() => void>();
const snapshots = new Map<string, RegimeMark>();
let activeClubId = "";

/** Point the store at a club (flag-gated caller). Empty/absent ⇒ the legacy global key. */
export function setActiveRegimeClub(clubId: string | null | undefined): void {
  const c = clubId ?? "";
  if (c === activeClubId) return;
  activeClubId = c;
  listeners.forEach((l) => l()); // active mark changed for every consumer
}

export function getRegimeSnapshot(): RegimeMark {
  const key = keyFor(activeClubId);
  let s = snapshots.get(key);
  if (!s) {
    s = loadRegimeMark(activeClubId);
    snapshots.set(key, s);
  }
  return s;
}

export function subscribeRegime(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent): void => {
    if (e.key && e.key === keyFor(activeClubId)) {
      snapshots.set(e.key, loadRegimeMark(activeClubId));
      listeners.forEach((l) => l());
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Commit a new mark to the ACTIVE club: persist + update the shared snapshot + notify same-tab subscribers. */
export function commitRegimeMark(mark: RegimeMark): void {
  const key = keyFor(activeClubId);
  writeRegimeMark(key, mark);
  snapshots.set(key, mark);
  listeners.forEach((l) => l());
}
