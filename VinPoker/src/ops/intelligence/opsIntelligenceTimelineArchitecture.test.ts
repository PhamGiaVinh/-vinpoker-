import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Wave 3 architecture", () => {
  it("uses an injected Ops client and mounts the reader only from exact tournament scope", () => {
    const query = read("src/ops/intelligence/opsIntelligenceTimelineQuery.ts");
    const panel = read("src/ops/intelligence/OpsIntelligenceTimelinePanel.tsx");
    expect(query).not.toContain("@/integrations/supabase/client");
    expect(query).toContain('["ops", clubId, "intelligence", "timeline-v1", tournamentId]');
    expect(panel).toContain('if (props.scope.kind === "club") return null');
    expect(panel).toContain('if (props.scope.kind === "festival")');
    expect(panel).not.toMatch(/setInterval|subscribe\(|channel\(/u);
  });
  it("keeps Wave 3 aggregate-only and makes no forecast or Gemini call", () => {
    const panel = read("src/ops/intelligence/OpsIntelligenceTimelinePanel.tsx");
    const migration = read("supabase/pending-migrations/20260914120000_ops_intelligence_timeline_v1.sql");
    expect(panel).not.toMatch(/forecastTurnout|Gemini|series-intelligence-copilot/u);
    expect(migration).not.toMatch(/playerName|dealerName|player_id'|dealer_id'/u);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION .* FROM PUBLIC, anon/u);
    expect(migration).toMatch(/GRANT EXECUTE .* TO authenticated/u);
    expect(migration).toContain("ENTRY_SEATED_AT_MISSING");
    expect(migration).toContain("ENTRY_BUST_BEFORE_SEAT");
    expect(migration).toContain("CONFIRMED_AT_MISSING");
    expect(migration).toContain("FUTURE_CONFIRMED_AT");
  });
});
