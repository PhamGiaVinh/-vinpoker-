// Shared in-app clipboard for copying ranges between GTO tab, Builder tab,
// and the admin RangeEditor. Also mirrors to the OS clipboard as JSON so it
// survives page reloads and works cross-tab.

import type { Range } from "./rangeTree";
import { normalizeHandAction } from "./rangeTree";

const STORAGE_KEY = "gto_range_clipboard_v1";

export interface ClipboardPayload {
  sourceSpotKey?: string;
  range: Range;
  copiedAt: number;
}

let memory: ClipboardPayload | null = null;
const subs = new Set<() => void>();

function loadFromStorage(): ClipboardPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.range) return null;
    return parsed as ClipboardPayload;
  } catch {
    return null;
  }
}

function getClipboard(): ClipboardPayload | null {
  if (memory) return memory;
  memory = loadFromStorage();
  return memory;
}

export async function copyRangeToClipboard(range: Range, sourceSpotKey?: string) {
  const payload: ClipboardPayload = {
    sourceSpotKey,
    range,
    copiedAt: Date.now(),
  };
  memory = payload;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
  // Best-effort sync to OS clipboard so user can paste in DevTools / another tab
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));
  } catch {}
  subs.forEach((cb) => { try { cb(); } catch {} });
}

export async function pasteRangeFromClipboard(): Promise<Range | null> {
  // Try OS clipboard first (in case user copied JSON from somewhere)
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const parsed = JSON.parse(text);
      const r = parsed?.range ?? parsed;
      if (r && typeof r === "object") return normalizeRange(r);
    }
  } catch {}
  const cb = getClipboard();
  return cb ? normalizeRange(cb.range) : null;
}

function subscribeClipboard(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

function normalizeRange(raw: any): Range {
  const out: Range = {};
  for (const h of Object.keys(raw)) {
    const v = raw[h];
    if (v && typeof v === "object") out[h] = normalizeHandAction(v);
  }
  return out;
}
