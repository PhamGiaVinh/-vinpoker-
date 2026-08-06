import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = resolve(root, "supabase/migrations/20270107000002_close_dealer_tables_rpc_lineage_v1.sql");
const phoneCallerPath = resolve(root, "src/components/ops/dealer-swing/DealerPhoneCloseTablesSheet.tsx");
const desktopCallerPath = resolve(root, "src/components/cashier/DealerSwingTab.tsx");
const phoneBoundaryPath = resolve(root, "src/components/ops/dealer-swing/dealerPhoneCloseRpc.ts");

const migration = readFileSync(migrationPath, "utf8");
const phoneCaller = readFileSync(phoneCallerPath, "utf8");
const desktopCaller = readFileSync(desktopCallerPath, "utf8");
const phoneBoundary = readFileSync(phoneBoundaryPath, "utf8");

describe("close_dealer_tables RPC lineage Phase 1", () => {
  it("adds a distinct phone RPC without dropping either compatibility overload", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.close_dealer_tables_phone_v1(");
    expect(migration).toContain("public.close_dealer_tables(uuid,uuid,uuid[])");
    expect(migration).toContain("public.close_dealer_tables(uuid,uuid,uuid,uuid[],jsonb,boolean)");
    expect(migration).not.toMatch(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.close_dealer_tables\s*\(/i);
  });

  it("keeps the canonical phone boundary narrow and the desktop caller unchanged", () => {
    expect(phoneCaller).toContain("closeDealerTablesPhone");
    expect(phoneCaller).not.toContain('rpcClose("close_dealer_tables"');
    expect(desktopCaller).toContain('(supabase.rpc as any)("close_dealer_tables"');
    expect(phoneBoundary).toContain("name: typeof DEALER_PHONE_CLOSE_RPC");
    expect(phoneBoundary).not.toContain("name: string");
  });

  it("preserves the guarded security and rollout prerequisites", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, public, extensions");
    expect(migration).toContain("_dealer_swing_phone_actor_allowed");
    expect(migration).toContain("dealer_swing_phone_rollout");
    expect(migration).toContain("dealer_phone_close_requests");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.close_dealer_tables_phone_v1");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.close_dealer_tables_phone_v1");
    expect(migration).not.toMatch(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.dealer_phone_close_requests/i);
  });
});
