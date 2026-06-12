import { describe, expect, it } from "vitest";
import { displayLabel, isDisplayOnline } from "./displayAdminRpc";

describe("isDisplayOnline", () => {
  const now = 1_000_000_000_000;
  it("is offline with no heartbeat", () => {
    expect(isDisplayOnline(null, now)).toBe(false);
  });
  it("is online within the 90s window", () => {
    expect(isDisplayOnline(new Date(now - 10_000).toISOString(), now)).toBe(true);
    expect(isDisplayOnline(new Date(now - 89_000).toISOString(), now)).toBe(true);
  });
  it("is offline past the 90s window", () => {
    expect(isDisplayOnline(new Date(now - 91_000).toISOString(), now)).toBe(false);
    expect(isDisplayOnline(new Date(now - 600_000).toISOString(), now)).toBe(false);
  });
});

describe("displayLabel", () => {
  it("prefers the custom name", () => {
    expect(displayLabel({ name: "Sảnh chính", display_number: 3 })).toBe("Sảnh chính");
  });
  it("falls back to TV + number", () => {
    expect(displayLabel({ name: null, display_number: 3 })).toBe("TV 3");
    expect(displayLabel({ name: "  ", display_number: 2 })).toBe("TV 2");
  });
  it("falls back to plain TV when nothing is set", () => {
    expect(displayLabel({ name: null, display_number: null })).toBe("TV");
  });
});
