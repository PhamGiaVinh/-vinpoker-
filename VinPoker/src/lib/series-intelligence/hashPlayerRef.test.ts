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

  // SHARED CLIENT/SERVER TEST VECTOR — the autosync migration hashes player_id server-side as
  // encode(extensions.digest(lower(trim(player_id::text)),'sha256'),'hex'). This asserts the CLIENT produces the
  // identical hex for the same uuid, so auto-captured and manually-captured rows reconcile as the same person.
  // The identical constant is asserted in _dryrun_series_capture_autosync.sql (H1_hash_parity) and the migration header.
  it("matches the server (pgcrypto) hash for the shared app_user_id vector", async () => {
    expect(await hashPlayerRef("11111111-1111-1111-1111-111111111111")).toBe(
      "bafde89c041e1756082b933aaf16cad8e65dec48de748479352f657e89dd6da5",
    );
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
