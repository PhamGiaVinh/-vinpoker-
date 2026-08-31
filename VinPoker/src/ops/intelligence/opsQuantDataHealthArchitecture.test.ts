import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("Ops Quant Data Health Q0 architecture", () => {
  const opsSources = [
    "src/ops/intelligence/OpsQuantDataHealthQ0Panel.tsx",
    "src/ops/intelligence/opsQuantDataHealthAdapter.ts",
    "src/ops/intelligence/opsQuantDataHealthQ0.ts",
  ].map(read).join("\n");
  const migration = read("supabase/pending-migrations/20270114000000_ops_quant_data_health_q0.sql");
  const flags = read("src/lib/featureFlags.ts");

  it("keeps Q0 default dark and prevents browser reads when the panel is not mounted", () => {
    expect(flags).toMatch(/opsQuantDataHealthQ0:\s*false/);
    expect(read("src/ops/intelligence/OpsIntelligenceCommandCenterV1.tsx")).toContain("q0Enabled && <OpsQuantDataHealthQ0Panel");
    expect(read("src/ops/intelligence/opsQuantDataHealthGate.ts")).toMatch(/sourceFlag\s*\|\|\s*\(environment\.dev\s*&&\s*environment\.e2eFlag === "true"\)/u);
  });

  it("does not import legacy pace, Gemini, raw audit or direct bank queries", () => {
    expect(opsSources).not.toContain("useEventPace");
    expect(opsSources).not.toMatch(/gemini|GoogleGenAI|@google\/genai/iu);
    expect(opsSources).not.toMatch(/\.from\(["']bank_transactions["']\)|\.from\(["']audit_logs["']\)/u);
  });

  it("exports only read RPC names and no SePay writer", () => {
    expect(opsSources).toContain("get_ops_registration_pace_q0");
    expect(opsSources).toContain("get_ops_sepay_read_state_q0");
    expect(opsSources).not.toMatch(/(?:manual_confirm|auto_confirm|settle_bank_transaction|ignore_bank_transaction|confirm_registration_and_assign_seat)/iu);
  });

  it("pins owner auth, search_path and least-privilege grants in pending DB source", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(3);
    expect(migration.match(/public\.is_club_owner\(v_actor, p_club_id\)/g)).toHaveLength(2);
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_ops_registration_pace_q0(uuid) TO authenticated");
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE).*bank_transactions/iu);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.resolve_sepay_account_club_v1(text) FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION public.resolve_sepay_account_club_v1");
  });

  it("uses canonical SePay account authority and excludes future registration observations", () => {
    expect(migration).toContain("public.resolve_sepay_account_club_v1(account.account_number)");
    expect(migration).toContain("bt.provider = 'sepay'");
    expect(migration).toContain("bt.account_number = ANY(v_account_numbers)");
    expect(migration).toContain("tr.confirmed_at <= v_as_of");
    expect(migration).toContain("FUTURE_CONFIRMED_AT");
  });

  it("does not return raw SePay or player identity fields", () => {
    const returns = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.get_ops_sepay_read_state_q0"));
    expect(returns).not.toMatch(/jsonb_build_object\([^;]*(?:account_number|content|provider_txn_id|raw_payload|raw_body|player_id)/iu);
  });
});
