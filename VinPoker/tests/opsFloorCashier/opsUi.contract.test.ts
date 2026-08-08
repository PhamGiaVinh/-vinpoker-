import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");

describe("Ops production safety affordances", () => {
  it("keeps cashier mutation gate explicit and owner UX checks present", () => {
    const cashier = readFileSync(resolve(repo, "src/pages/ops/OpsCashier.tsx"), "utf8");
    const tournaments = readFileSync(resolve(repo, "src/pages/ops/OpsTournaments.tsx"), "utf8");
    expect(cashier).toContain("OPS_CASHIER_MUTATIONS_ENABLED");
    expect(cashier).toContain("money_path_disabled");
    expect(tournaments).toContain("hasOwnerAccess");
    expect(tournaments).toContain("deleteTournament");
  });

  it("does not leave a direct tournament delete in application source", () => {
    const files = [
      "src/ops/opsMutations.ts", "src/components/floor/useFloorTournaments.ts",
      "src/hooks/useTournaments.ts", "src/pages/SuperAdmin.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(repo, file), "utf8");
      expect(source).not.toMatch(/from\(["']tournaments["']\)[\s\S]{0,120}\.delete\(/u);
    }
  });

  it("keeps registration actor spoof protection in the canonical migration", () => {
    const guard = readFileSync(resolve(repo, "supabase/migrations/20260811000000_p0_guard_v2_bind_actor_to_auth_uid.sql"), "utf8");
    expect(guard).toContain("p_actor_user_id IS DISTINCT FROM auth.uid()");
    expect(guard).toContain("REVOKE EXECUTE ON FUNCTION public.confirm_registration_and_assign_seat");
  });
});
