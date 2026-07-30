import { describe, expect, it } from "vitest";
import {
  opsAuthStorageKey,
  projectRefFromSupabaseUrl,
} from "@/integrations/supabase/opsClientConfig";
import { resolveOpsEntry } from "@/ops/auth/opsCapabilityRouting";
import {
  floorScopeFingerprint,
  isCurrentTournamentScope,
  type VerifiedTournamentScope,
} from "@/ops/auth/opsTournamentScope";

describe("Ops authentication boundary", () => {
  it("derives an environment-specific storage key that differs from the player key", () => {
    const production = opsAuthStorageKey("https://productionref.supabase.co");
    const preview = opsAuthStorageKey("https://previewref.supabase.co");
    expect(production).toBe("sb-productionref-ops-auth-token");
    expect(preview).toBe("sb-previewref-ops-auth-token");
    expect(production).not.toBe("sb-productionref-auth-token");
    expect(production).not.toBe(preview);
  });

  it("falls back to a local-only key segment for malformed URLs", () => {
    expect(projectRefFromSupabaseUrl("not-a-url")).toBe("local");
    expect(opsAuthStorageKey("not-a-url")).toBe("sb-local-ops-auth-token");
  });

});

describe("Ops capability routing", () => {
  it.each([
    [{ hasOwnerAccess: false, hasFloorAccess: true, hasCashierAccess: false }, "/ops/floor"],
    [{ hasOwnerAccess: false, hasFloorAccess: false, hasCashierAccess: true }, "/ops/cashier"],
    [{ hasOwnerAccess: true, hasFloorAccess: true, hasCashierAccess: true }, "/ops/select-module"],
    [{ hasOwnerAccess: false, hasFloorAccess: true, hasCashierAccess: true }, "/ops/select-module"],
    [{ hasOwnerAccess: false, hasFloorAccess: false, hasCashierAccess: false }, "access-denied"],
  ] as const)("routes caller-bound capabilities without role enums", (input, expected) => {
    expect(resolveOpsEntry(input)).toBe(expected);
  });

  it("never reuses an authorization result after tournament or club scope changes", () => {
    const scopeA = floorScopeFingerprint(["club-a"]);
    const verifiedA: VerifiedTournamentScope = {
      status: "allowed",
      tournamentId: "tournament-a",
      scopeFingerprint: scopeA,
    };
    expect(isCurrentTournamentScope(verifiedA, "tournament-a", scopeA)).toBe(true);
    expect(isCurrentTournamentScope(verifiedA, "tournament-b", scopeA)).toBe(false);
    expect(isCurrentTournamentScope(
      verifiedA,
      "tournament-a",
      floorScopeFingerprint(["club-b"]),
    )).toBe(false);
  });
});
