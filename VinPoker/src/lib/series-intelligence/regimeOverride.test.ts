import { describe, it, expect, beforeEach } from "vitest";
import {
  emptyRegimeMark,
  parseRegimeMark,
  serializeRegimeMark,
  setRegimeChanged,
  MAX_REGIME_NOTE_LEN,
  REGIME_OVERRIDE_VERSION,
  REGIME_OVERRIDE_STORAGE_KEY,
  keyFor,
  regimeMarkHasContent,
  resolveClubMark,
  loadRegimeMark,
  watchlistSuggestsRegimeChange,
  REGIME_WATCHLIST,
  REGIME_WATCHLIST_THRESHOLD,
} from "./regimeOverride";

const NOW = "2026-07-03T10:00:00.000Z";
const LATER = "2026-07-04T10:00:00.000Z";

describe("regimeOverride — parse (untrusted JSON)", () => {
  it("null/empty → empty mark", () => {
    expect(parseRegimeMark(null)).toEqual(emptyRegimeMark());
    expect(parseRegimeMark("")).toEqual(emptyRegimeMark());
  });

  it("garbage / non-object → empty mark (never throws)", () => {
    expect(parseRegimeMark("{not json")).toEqual(emptyRegimeMark());
    expect(parseRegimeMark("42")).toEqual(emptyRegimeMark());
    expect(parseRegimeMark("null")).toEqual(emptyRegimeMark());
    expect(parseRegimeMark("[1,2]").changed).toBe(false);
  });

  it("changed only true for strict boolean true (not truthy)", () => {
    expect(parseRegimeMark(JSON.stringify({ changed: "true" })).changed).toBe(false);
    expect(parseRegimeMark(JSON.stringify({ changed: 1 })).changed).toBe(false);
    expect(parseRegimeMark(JSON.stringify({ changed: true, markedAt: NOW })).changed).toBe(true);
  });

  it("drops a stale markedAt when changed is false", () => {
    const m = parseRegimeMark(JSON.stringify({ changed: false, markedAt: NOW }));
    expect(m.markedAt).toBeNull();
  });

  it("coerces + caps the note; non-string note → empty", () => {
    expect(parseRegimeMark(JSON.stringify({ note: 123 })).note).toBe("");
    const long = "x".repeat(MAX_REGIME_NOTE_LEN + 50);
    expect(parseRegimeMark(JSON.stringify({ note: long })).note.length).toBe(MAX_REGIME_NOTE_LEN);
  });

  it("always normalizes version", () => {
    expect(parseRegimeMark(JSON.stringify({ version: 999, changed: true })).version).toBe(REGIME_OVERRIDE_VERSION);
  });
});

describe("regimeOverride — setRegimeChanged (pure reducer)", () => {
  it("marking changed stamps markedAt from nowIso", () => {
    const m = setRegimeChanged(emptyRegimeMark(), true, "luật siết", NOW);
    expect(m.changed).toBe(true);
    expect(m.markedAt).toBe(NOW);
    expect(m.note).toBe("luật siết");
  });

  it("keeps the ORIGINAL markedAt when already changed (editing note doesn't reset the clock)", () => {
    const first = setRegimeChanged(emptyRegimeMark(), true, "a", NOW);
    const edited = setRegimeChanged(first, true, "a + more", LATER);
    expect(edited.markedAt).toBe(NOW); // unchanged
    expect(edited.note).toBe("a + more");
  });

  it("unsetting clears markedAt", () => {
    const on = setRegimeChanged(emptyRegimeMark(), true, "x", NOW);
    const off = setRegimeChanged(on, false, "x", LATER);
    expect(off.changed).toBe(false);
    expect(off.markedAt).toBeNull();
  });

  it("caps the note", () => {
    const m = setRegimeChanged(emptyRegimeMark(), true, "y".repeat(500), NOW);
    expect(m.note.length).toBe(MAX_REGIME_NOTE_LEN);
  });
});

describe("regimeOverride — round-trip", () => {
  it("serialize → parse is identity for a changed mark", () => {
    const m = setRegimeChanged(emptyRegimeMark(), true, "cú gãy chế độ", NOW);
    expect(parseRegimeMark(serializeRegimeMark(m))).toEqual(m);
  });

  it("serialize → parse is identity for an empty mark", () => {
    expect(parseRegimeMark(serializeRegimeMark(emptyRegimeMark()))).toEqual(emptyRegimeMark());
  });
});

// TP8 — per-club scoping + migration + watchlist tripwire.
const changedRaw = (note: string) => serializeRegimeMark(setRegimeChanged(emptyRegimeMark(), true, note, NOW));

describe("regimeOverride — TP8 keyFor + resolveClubMark (pure)", () => {
  it("keyFor: per-club key vs the legacy global key", () => {
    expect(keyFor("club-1")).toBe(`${REGIME_OVERRIDE_STORAGE_KEY}.club-1`);
    expect(keyFor("")).toBe(REGIME_OVERRIDE_STORAGE_KEY);
    expect(keyFor(null)).toBe(REGIME_OVERRIDE_STORAGE_KEY);
    expect(keyFor(undefined)).toBe(REGIME_OVERRIDE_STORAGE_KEY);
  });

  it("regimeMarkHasContent: changed OR note", () => {
    expect(regimeMarkHasContent(emptyRegimeMark())).toBe(false);
    expect(regimeMarkHasContent(setRegimeChanged(emptyRegimeMark(), true, "", NOW))).toBe(true);
    expect(regimeMarkHasContent(setRegimeChanged(emptyRegimeMark(), false, "note", NOW))).toBe(true);
  });

  it("per-club mark with content wins (no migration)", () => {
    const r = resolveClubMark(changedRaw("club mark"), changedRaw("legacy"), "club-1");
    expect(r.migrate).toBe(false);
    expect(r.mark.note).toBe("club mark");
  });

  it("empty per-club + legacy-with-content → migrate the legacy mark once", () => {
    const r = resolveClubMark(null, changedRaw("legacy"), "club-1");
    expect(r.migrate).toBe(true);
    expect(r.mark.changed).toBe(true);
    expect(r.mark.note).toBe("legacy");
  });

  it("empty per-club + empty legacy → empty, no migration", () => {
    const r = resolveClubMark(null, null, "club-1");
    expect(r.migrate).toBe(false);
    expect(r.mark.changed).toBe(false);
  });

  it("global context (clubId '') uses its own raw and never migrates", () => {
    const r = resolveClubMark(changedRaw("global"), changedRaw("legacy"), "");
    expect(r.migrate).toBe(false);
    expect(r.mark.note).toBe("global");
  });

  it("two clubs resolve INDEPENDENTLY (isolation)", () => {
    const a = resolveClubMark(changedRaw("A-only"), changedRaw("legacy"), "A"); // own mark
    const b = resolveClubMark(null, changedRaw("legacy"), "B"); // inherits legacy
    expect(a.mark.note).toBe("A-only");
    expect(a.migrate).toBe(false);
    expect(b.mark.note).toBe("legacy");
    expect(b.migrate).toBe(true);
  });
});

describe("regimeOverride — TP8 loadRegimeMark storage (jsdom localStorage)", () => {
  beforeEach(() => localStorage.clear());

  it("migrates a legacy global mark into the club key and persists it", () => {
    localStorage.setItem(REGIME_OVERRIDE_STORAGE_KEY, changedRaw("legacy"));
    const m = loadRegimeMark("club-1");
    expect(m.note).toBe("legacy");
    expect(parseRegimeMark(localStorage.getItem(keyFor("club-1"))).note).toBe("legacy"); // persisted once
  });

  it("a club's own mark is isolated from another club", () => {
    localStorage.setItem(keyFor("A"), changedRaw("A-only"));
    expect(loadRegimeMark("A").note).toBe("A-only");
    expect(loadRegimeMark("B").changed).toBe(false); // B: no own mark, no legacy → empty
  });
});

describe("regimeOverride — TP8 watchlist tripwire", () => {
  it("suggests only at/above the threshold", () => {
    expect(REGIME_WATCHLIST_THRESHOLD).toBe(2);
    expect(REGIME_WATCHLIST.length).toBe(5);
    expect(watchlistSuggestsRegimeChange(0)).toBe(false);
    expect(watchlistSuggestsRegimeChange(1)).toBe(false);
    expect(watchlistSuggestsRegimeChange(2)).toBe(true);
    expect(watchlistSuggestsRegimeChange(5)).toBe(true);
  });
});
