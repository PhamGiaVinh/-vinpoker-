import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");

describe("Ops production safety affordances", () => {
  it("keeps production Cashier read-only and owner tournament writes scoped", () => {
    const cashier = readFileSync(resolve(repo, "src/pages/ops/OpsCashier.tsx"), "utf8");
    const tournaments = readFileSync(resolve(repo, "src/pages/ops/OpsTournaments.tsx"), "utf8");
    expect(cashier).toContain("OPS MONEY GATE B đang tắt");
    expect(cashier).not.toContain("@/ops/opsMutations");
    expect(cashier).not.toMatch(/\.rpc\s*\(|functions\.invoke/u);
    expect(tournaments).toContain("hasOwnerAccess");
    expect(tournaments).toContain("row.club_id === activeClub && row.can_owner");
    expect(tournaments).not.toContain("closeTournament");
    expect(tournaments).not.toContain("deleteTournament");
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
    const guard = readFileSync(resolve(repo, "supabase/migration-archive/historical-never-replay/20260811000000_p0_guard_v2_bind_actor_to_auth_uid.sql"), "utf8");
    expect(guard).toContain("p_actor_user_id IS DISTINCT FROM auth.uid()");
    expect(guard).toContain("REVOKE EXECUTE ON FUNCTION public.confirm_registration_and_assign_seat");
  });

  it("keeps the new offline buy-in RPC server-only", () => {
    const migration = readFileSync(
      resolve(repo, "supabase/migrations/20270109000000_ops_floor_cashier_canonical_mutations.sql"),
      "utf8",
    );
    expect(migration).not.toMatch(
      /GRANT\s+EXECUTE[\s\S]{0,220}ops_create_offline_buyin_and_seat[\s\S]{0,220}\bTO\s+authenticated\b/iu,
    );
    expect(migration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.ops_create_offline_buyin_and_seat\s*\(uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*;/iu,
    );
  });

  it("keeps enabled profile review behind the server-authoritative approve_verification RPC", () => {
    const gate = readFileSync(resolve(repo, "src/lib/profileReviewGate.ts"), "utf8");
    expect(gate).toContain("server-authoritative");
    expect(gate).toContain("export const PROFILE_REVIEW_ENABLED = true;");
  });
});
