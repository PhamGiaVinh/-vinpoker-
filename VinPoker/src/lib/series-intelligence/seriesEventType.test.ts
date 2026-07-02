import { describe, it, expect } from "vitest";
import { TYPE_KEYWORDS, TYPE_LABEL, typeOf } from "./seriesEventType";

describe("typeOf", () => {
  it("classifies by keyword in the event name, case-insensitive", () => {
    expect(typeOf("VSOP Mystery Bounty 2M")).toBe("mystery");
    expect(typeOf("TURBO 500K")).toBe("turbo");
    expect(typeOf("Satellite to Main")).toBe("satellite");
  });

  it("resolves the MOST SPECIFIC phrase first (super high roller is not swallowed by high roller)", () => {
    expect(typeOf("Super High Roller 100M")).toBe("super high roller");
    expect(typeOf("High Roller 25M")).toBe("high roller");
  });

  it("'Hyper Turbo' classifies as hyper (the conventional name), not turbo", () => {
    expect(typeOf("Hyper Turbo 500K")).toBe("hyper");
    expect(typeOf("Turbo 500K")).toBe("turbo");
  });

  it("uses the explicit keyword when provided", () => {
    expect(typeOf("Event #12", "plo")).toBe("plo");
  });

  it("falls back to 'other' when nothing matches (and for null/empty)", () => {
    expect(typeOf("Daily 1M2")).toBe("other");
    expect(typeOf(null)).toBe("other");
    expect(typeOf("")).toBe("other");
  });

  it("every keyword + 'other' has a Vietnamese label", () => {
    for (const k of TYPE_KEYWORDS) expect(TYPE_LABEL[k]).toBeTruthy();
    expect(TYPE_LABEL.other).toBeTruthy();
  });
});
