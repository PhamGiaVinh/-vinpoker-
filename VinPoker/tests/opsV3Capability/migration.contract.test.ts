import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(repo, "supabase/migrations/20270110000000_ops_unified_capability_scope.sql"),
  "utf8",
);

describe("Ops V3 capability migration contract", () => {
  it("binds all public RPCs to auth.uid with no caller-supplied user id", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).not.toMatch(/get_my_ops_capability_scope\s*\([^)]*user/iu);
    expect(migration).not.toMatch(/get_my_ops_global_capability\s*\([^)]*user/iu);
  });

  it("keeps F&B facets separate and uses direct membership sources", () => {
    for (const source of [
      "club_floors",
      "club_cashiers",
      "club_trackers",
      "club_dealer_controls",
      "club_accountants",
      "club_chip_masters",
      "club_marketers",
      "club_fnb_staff",
    ]) {
      expect(migration).toContain(`public.${source}`);
    }
    expect(migration).toContain("can_fnb_cashier");
    expect(migration).toContain("can_fnb_server");
    expect(migration).toContain("can_fnb_kitchen");
  });

  it("uses an empty search path and least-privilege function ACL", () => {
    expect(migration.match(/SET search_path = ''/gu)).toHaveLength(3);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.get_my_ops_capability_scope\(\) FROM PUBLIC, anon, service_role;/u);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_my_ops_capability_scope\(\) TO authenticated;/u);
  });

  it("does not expand super-admin into the login scope", () => {
    const scopeBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_my_ops_capability_scope"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_my_ops_global_capability"),
    );
    expect(scopeBody).not.toContain("super_admin");
  });

  it("supports bounded exact-id verification for a refreshed super-admin route", () => {
    expect(migration).toContain("OR c.id::text = v_search");
    expect(migration).toContain("v_limit := least(greatest(coalesce(p_limit, 50), 1), 100)");
  });
});
