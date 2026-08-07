import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), "../.github/workflows/tracker-pr2a-disposable-db.yml"),
  "utf8",
);
const baseline = readFileSync(
  resolve(process.cwd(), "tests/trackerUnifiedOps/disposableDb.baseline.sql"),
  "utf8",
);
const integration = readFileSync(
  resolve(process.cwd(), "tests/trackerUnifiedOps/disposableDb.integration.sql"),
  "utf8",
);

describe("Tracker PR2A disposable database contract", () => {
  it("uses PostgreSQL 17 with trust auth and read-only repository permissions", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  it("does not contain linked-project, deployment, or production commands", () => {
    expect(workflow).not.toMatch(/--linked|db push|functions deploy|vercel --prod/i);
    expect(workflow).not.toContain("orlesggcjamwuknxwcpk");
    expect(workflow).not.toMatch(/SUPABASE_(URL|KEY|SERVICE_ROLE_KEY)/i);
  });

  it("applies the exact migration and tests a separate clean rollback copy", () => {
    expect(workflow).toContain(
      "supabase/migrations/20270108000003_tracker_unified_ops_v2_context_safe_start.sql",
    );
    expect(workflow).toContain("createdb tracker_pr2a_rollback -T tracker_pr2a");
    expect(workflow).toContain("tracker_pr2a_injected_failure");
    expect(workflow).toContain("PR2A_ROLLBACK_PROOF=PASS");
  });

  it("keeps the Deno check bounded to a non-PR2A syntax target", () => {
    expect(workflow).toContain("denoland/setup-deno@v2");
    expect(workflow).toContain(
      "deno check --no-config supabase/functions/health/index.ts",
    );
    expect(workflow).toContain("PR2A_DENO=PASS_HEALTH_BASELINE_NO_PR2A_EDGE_SOURCE");
  });

  it("keeps the canonical identity domains explicit in the baseline", () => {
    expect(baseline).toContain(
      "canonical identities: seats point at tournament_tables.id; entries point at game_tables.id",
    );
    expect(baseline).toContain("CREATE TABLE public.tournament_tables");
    expect(baseline).toContain("CREATE TABLE public.tournament_entries");
    expect(baseline).toContain("CREATE TABLE public.tournament_hands");
  });

  it("covers wrong-seat zero-write, raw hash, idempotency and terminal replay", () => {
    expect(integration).toContain("seat_entry_mismatch");
    expect(integration).toContain("wrong seat_number performs zero hand writes");
    expect(integration).toContain("negative tracker stack changes context hash");
    expect(integration).toContain("same idempotency request returns replayed receipt");
    expect(integration).toContain("terminal tournament does not block an exact receipt replay");
  });

  it("covers authorization, privacy, advisory-lock concurrency and no auto-void", () => {
    expect(integration).toContain("start RPC grants only authenticated execution");
    expect(integration).toContain("receipt table is not client-readable");
    expect(integration).toContain("concurrent different-key starts serialize without duplicate hands");
    expect(integration).toContain("no stale-lock auto-void or destructive cleanup occurred");
    expect(integration).toContain("dblink_send_query");
  });
});
