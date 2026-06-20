// Series Intelligence — Series Library (multi-series CSV, client-only, PURE + persistence).
//
// Accumulates uploaded CSV "series" (one file = one series) into a library that persists to
// localStorage (per-device). The descriptive dashboard runs on the ACTIVE series. This module is
// the pure core: types, immutable reducers, and a localStorage layer with a STRICT rehydrate
// validator. SAFETY: client-only, never touches the DB/server. The only untrusted surface is the
// stored JSON on load — `loadLibrary` never throws and sanitizes everything (see validateEnvelope).
//
// NOTE (PATCH 2): event_id is SERIES-LOCAL (the parser emits `csv-<rowNo>`), so it COLLIDES across
// series — every series has csv-1, csv-2, … A later patch that merges the whole library must key
// events by content (event_name / buy-in tier), NEVER by event_id.

import type { SeriesEvent } from "./nativeData";

export interface Series {
  id: string; // crypto.randomUUID()
  name: string; // default = filename sans .csv; editable inline
  seriesDate: string | null; // derived = min non-null event_date across events
  sourceFilename: string;
  events: SeriesEvent[];
  loadedAt: number; // Date.now() at import (recency → default-active)
}

export interface SeriesLibrary {
  series: Series[]; // insertion order = load order
  activeId: string | null;
}

export interface SeriesLibraryEnvelope {
  version: number;
  library: SeriesLibrary;
}

export const SERIES_LIBRARY_STORAGE_KEY = "vinpoker.seriesLibrary.v1";
export const SERIES_LIBRARY_VERSION = 1;
export const MAX_FILE_BYTES = 1_000_000; // ~1MB per uploaded CSV
export const MAX_LIBRARY_BYTES = 4_000_000; // ~4MB serialized envelope (< ~5MB quota)

export interface SizeGuardResult {
  ok: boolean;
  bytes: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// id / derivation helpers
// ---------------------------------------------------------------------------

/** Stable random id (crypto.randomUUID with a dependency-free fallback for odd runtimes). */
export function newSeriesId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sl-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Series date = the earliest non-null event_date in the file (lexical min of yyyy-mm-dd), else null. */
export function deriveSeriesDate(events: SeriesEvent[]): string | null {
  let min: string | null = null;
  for (const e of events) {
    if (e.event_date && (min === null || e.event_date < min)) min = e.event_date;
  }
  return min;
}

/** Build a Series from a parsed file. name = filename without .csv (trimmed), with fallbacks. */
export function makeSeriesFromParse(filename: string, events: SeriesEvent[]): Series {
  const base = (filename ?? "").replace(/\.csv$/i, "").trim();
  return {
    id: newSeriesId(),
    name: base || (filename ?? "").trim() || "Series",
    seriesDate: deriveSeriesDate(events),
    sourceFilename: filename ?? "",
    events,
    loadedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// pure reducers (immutable)
// ---------------------------------------------------------------------------

export function emptyLibrary(): SeriesLibrary {
  return { series: [], activeId: null };
}

/** Append a series; it becomes the active one (default-active = most-recently-loaded). */
export function addSeries(lib: SeriesLibrary, s: Series): SeriesLibrary {
  return { series: [...lib.series, s], activeId: s.id };
}

/** Remove a series; if it was active, re-point active to the most-recently-loaded survivor, else null. */
export function removeSeries(lib: SeriesLibrary, id: string): SeriesLibrary {
  const series = lib.series.filter((s) => s.id !== id);
  if (lib.activeId !== id) return { series, activeId: lib.activeId };
  const newest = series.reduce<Series | null>((acc, s) => (acc === null || s.loadedAt >= acc.loadedAt ? s : acc), null);
  return { series, activeId: newest ? newest.id : null };
}

export function clearLibrary(): SeriesLibrary {
  return emptyLibrary();
}

/** Rename; trims; an empty name is rejected (keeps the old name). */
export function renameSeries(lib: SeriesLibrary, id: string, name: string): SeriesLibrary {
  const next = (name ?? "").trim();
  if (next === "") return lib;
  return { ...lib, series: lib.series.map((s) => (s.id === id ? { ...s, name: next } : s)) };
}

/** Set the active series — only if the id exists in the library. */
export function setActive(lib: SeriesLibrary, id: string): SeriesLibrary {
  if (!lib.series.some((s) => s.id === id)) return lib;
  return { ...lib, activeId: id };
}

// ---------------------------------------------------------------------------
// localStorage persistence + STRICT rehydrate validator (untrusted surface)
// ---------------------------------------------------------------------------
//
// Prototype-pollution safety here is STRUCTURAL: the sanitizers below NEVER iterate the parsed
// object's keys and NEVER spread/merge it — they read a fixed set of allow-listed fields into a
// fresh literal. A `__proto__` / `constructor` key in the input is simply never read, so there is
// nothing to "block" (hence no key-sanitization helper — that would guard a path that can't occur).

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Rebuild a SeriesEvent from untrusted JSON by reading ONLY the known fields into a fresh literal
 * (no spread/merge → prototype pollution is structurally impossible). Returns null to DROP the event
 * when event_id is missing/blank. Numerics that aren't finite numbers become null (BI math stays safe).
 */
function sanitizeEvent(raw: unknown): SeriesEvent | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const event_id = typeof r.event_id === "string" && r.event_id.trim() !== "" ? r.event_id : null;
  if (event_id === null) return null;
  const missing = Array.isArray(r.missingFields) ? r.missingFields.filter((x): x is string => typeof x === "string") : [];
  return {
    event_id,
    event_name: strOrNull(r.event_name),
    event_date: strOrNull(r.event_date),
    buy_in: numOrNull(r.buy_in),
    fee: numOrNull(r.fee),
    serviceFeeAmount: numOrNull(r.serviceFeeAmount),
    gtd: numOrNull(r.gtd),
    prize_pool_actual: numOrNull(r.prize_pool_actual),
    total_entries: numOrNull(r.total_entries),
    unique_entries: numOrNull(r.unique_entries),
    reentries: numOrNull(r.reentries),
    source: "csv", // stored library data is always test data — never trust a claimed "native"
    clubId: typeof r.clubId === "string" ? r.clubId : "csv-test",
    missingFields: missing,
  };
}

/** Rebuild a Series from untrusted JSON. Returns null to DROP it when id is blank or it has no valid events. */
function sanitizeSeries(raw: unknown): Series | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() !== "" ? r.id : null;
  if (id === null) return null;
  const events = Array.isArray(r.events)
    ? r.events.map(sanitizeEvent).filter((e): e is SeriesEvent => e !== null)
    : [];
  if (events.length === 0) return null;
  const sourceFilename = typeof r.sourceFilename === "string" ? r.sourceFilename : "";
  return {
    id,
    name: typeof r.name === "string" && r.name.trim() !== "" ? r.name : sourceFilename || "Series",
    seriesDate: strOrNull(r.seriesDate),
    sourceFilename,
    events,
    loadedAt: typeof r.loadedAt === "number" && Number.isFinite(r.loadedAt) ? r.loadedAt : Date.now(),
  };
}

/** Validate + sanitize a parsed storage envelope → a clean SeriesLibrary. Never throws. */
export function validateEnvelope(parsed: unknown): SeriesLibrary {
  if (parsed === null || typeof parsed !== "object") return emptyLibrary();
  const env = parsed as Record<string, unknown>;
  if (env.version !== SERIES_LIBRARY_VERSION) return emptyLibrary(); // no migration this patch
  const lib = env.library;
  if (lib === null || typeof lib !== "object") return emptyLibrary();
  const rawSeries = (lib as Record<string, unknown>).series;
  const series = Array.isArray(rawSeries)
    ? rawSeries.map(sanitizeSeries).filter((s): s is Series => s !== null)
    : [];
  const rawActive = (lib as Record<string, unknown>).activeId;
  let activeId: string | null = typeof rawActive === "string" && series.some((s) => s.id === rawActive) ? rawActive : null;
  if (activeId === null && series.length > 0) {
    // dangling/absent active → newest survivor
    const newest = series.reduce((acc, s) => (s.loadedAt >= acc.loadedAt ? s : acc), series[0]);
    activeId = newest.id;
  }
  return { series, activeId };
}

export function serializeLibrary(lib: SeriesLibrary): string {
  const envelope: SeriesLibraryEnvelope = { version: SERIES_LIBRARY_VERSION, library: lib };
  return JSON.stringify(envelope);
}

export function checkLibrarySize(serialized: string): SizeGuardResult {
  // Real UTF-8 byte length — multi-byte Vietnamese names (dấu) count correctly, not as 1 code unit.
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > MAX_LIBRARY_BYTES) {
    return { ok: false, bytes, message: `Thư viện quá lớn (${Math.round(bytes / 1000)}KB > ${MAX_LIBRARY_BYTES / 1000}KB). Xóa bớt series.` };
  }
  return { ok: true, bytes };
}

/** Load + sanitize the library from localStorage. Never throws; returns emptyLibrary() on any problem. */
export function loadLibrary(): SeriesLibrary {
  if (typeof localStorage === "undefined") return emptyLibrary();
  try {
    const raw = localStorage.getItem(SERIES_LIBRARY_STORAGE_KEY);
    if (!raw) return emptyLibrary();
    return validateEnvelope(JSON.parse(raw));
  } catch {
    return emptyLibrary();
  }
}

/** Save the library to localStorage with a size guard. Never throws; returns the guard result. */
export function saveLibrary(lib: SeriesLibrary): SizeGuardResult {
  const serialized = serializeLibrary(lib);
  const guard = checkLibrarySize(serialized);
  if (!guard.ok) return guard; // over cap → do NOT write; in-memory state still works
  if (typeof localStorage === "undefined") return { ok: false, bytes: guard.bytes, message: "Không có localStorage." };
  try {
    localStorage.setItem(SERIES_LIBRARY_STORAGE_KEY, serialized);
    return guard;
  } catch {
    return { ok: false, bytes: guard.bytes, message: "Không lưu được (bộ nhớ trình duyệt đầy?)." };
  }
}

/** Remove the stored library (used by "Xóa tất cả" for a clean device wipe). Never throws. */
export function clearStoredLibrary(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(SERIES_LIBRARY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
