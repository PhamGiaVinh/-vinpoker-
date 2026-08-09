import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("Series Club Pulse V1 architecture boundary", () => {
  it("keeps contracts and mapping pure while isolating Supabase to one fixed RPC adapter", () => {
    const contract = source("src/lib/series-intelligence/seriesClubLivePulseV1.ts");
    const adapter = source("src/lib/series-intelligence/seriesClubLivePulseRpc.ts");
    expect(contract).not.toMatch(/supabase|\.rpc\(|\bfetch\s*\(/i);
    expect(adapter).toContain('const CLUB_PULSE_RPC = "get_series_club_live_pulse_v1"');
    expect(adapter).toContain("parseSeriesClubLivePulseV1(data)");
    expect(adapter).not.toMatch(/\.from\s*\(/);
  });

  it("does not wire the live adapter into UI or enable either Copilot flag", () => {
    const panel = source("src/components/series-intelligence/VCopilotPanel.tsx");
    const page = source("src/pages/SeriesIntelligence.tsx");
    const flags = source("src/lib/featureFlags.ts");
    expect(panel).not.toMatch(/seriesClubLivePulseRpc|getSeriesClubLivePulseV1/);
    expect(page).not.toMatch(/seriesClubLivePulseRpc|getSeriesClubLivePulseV1/);
    expect(flags).toMatch(/seriesVCopilotV1:\s*false/);
    expect(flags).not.toMatch(/seriesClubPulseV1:\s*true/);
  });
});
