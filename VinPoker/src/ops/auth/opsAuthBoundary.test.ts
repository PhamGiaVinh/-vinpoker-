import { describe, expect, it } from "vitest";
import {
  sharedAuthStorageKey,
  projectRefFromSupabaseUrl,
} from "@/integrations/supabase/opsClientConfig";
import { resolveOpsEntry } from "@/ops/auth/opsCapabilityRouting";
import {
  floorScopeFingerprint,
  isCurrentTournamentScope,
  type VerifiedTournamentScope,
} from "@/ops/auth/opsTournamentScope";

describe("Ops shared-session boundary", () => {
  it("derives the primary app storage key without crossing environments", () => {
    const production = sharedAuthStorageKey("https://productionref.supabase.co");
    const preview = sharedAuthStorageKey("https://previewref.supabase.co");
    expect(production).toBe("sb-productionref-auth-token");
    expect(preview).toBe("sb-previewref-auth-token");
    expect(production).not.toBe(preview);
  });

  it("falls back to a local-only key segment for malformed URLs", () => {
    expect(projectRefFromSupabaseUrl("not-a-url")).toBe("local");
    expect(sharedAuthStorageKey("not-a-url")).toBe("sb-local-auth-token");
  });

});

describe("Ops capability routing", () => {
  it.each([
    [{ availableModuleRoutes: ["/ops/floor"] }, "/ops/floor"],
    [{ availableModuleRoutes: ["/ops/cashier"] }, "/ops/cashier"],
    [{ availableModuleRoutes: ["/ops/floor", "/ops/cashier"] }, "/ops/select-module"],
    [{ availableModuleRoutes: [] }, "access-denied"],
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
