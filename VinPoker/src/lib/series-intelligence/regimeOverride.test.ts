import { describe, it, expect } from "vitest";
import {
  emptyRegimeMark,
  parseRegimeMark,
  serializeRegimeMark,
  setRegimeChanged,
  MAX_REGIME_NOTE_LEN,
  REGIME_OVERRIDE_VERSION,
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
