import { describe, it, expect } from "vitest";
import { normalizePlayerRef, hashPlayerRef, shortHash } from "./hashPlayerRef";

describe("normalizePlayerRef", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizePlayerRef("  ABC  ")).toBe("abc");
  });
  it("collapses case so the same person reconciles", () => {
    expect(normalizePlayerRef("Nguyen")).toBe(normalizePlayerRef("nguyen"));
  });
});

describe("hashPlayerRef", () => {
  it("is deterministic after normalization and returns 64 hex chars", async () => {
    const a = await hashPlayerRef("  0903356589  ");
    const b = await hashPlayerRef("0903356589");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("differs for different identifiers", async () => {
    expect(await hashPlayerRef("0903356589")).not.toBe(await hashPlayerRef("0903356590"));
  });
  it("never returns the raw input", async () => {
    const raw = "vip-nguyen";
    expect(await hashPlayerRef(raw)).not.toContain(raw);
  });
});

describe("shortHash", () => {
  it("shows a 10-char prefix + ellipsis", () => {
    expect(shortHash("abcdef0123456789deadbeef")).toBe("abcdef0123…");
  });
  it("shows a dash for empty", () => {
    expect(shortHash(null)).toBe("—");
    expect(shortHash(undefined)).toBe("—");
  });
});
