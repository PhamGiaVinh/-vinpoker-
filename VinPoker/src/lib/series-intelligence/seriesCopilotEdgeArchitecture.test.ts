import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "supabase", "functions", "series-intelligence-copilot");
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("V Copilot Edge source boundary", () => {
  it("keeps secrets server-side and never uses service role or browser Gemini env", () => {
    const all = readdirSync(ROOT).filter((file) => file.endsWith(".ts")).map(source).join("\n");
    expect(all).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|VITE_[A-Z_]*GEMINI/);
    expect(source("index.ts")).toContain('Deno.env.get("GEMINI_API_KEY")');
    expect(source("index.ts")).not.toContain('Deno.env.get("SERIES_GEMINI_API_KEY")');
    expect(source("geminiProvider.ts")).toContain('SERIES_GEMINI_MODEL_ID = "gemini-3.6-flash"');
    expect(source("index.ts")).not.toContain("SERIES_GEMINI_MODEL");
    expect(all).not.toContain("gemini-flash-latest");
  });

  it("uses fixed owner-context RPCs and does not query row-level player tables", () => {
    const handler = source("handler.ts");
    expect(handler).toContain("get_series_club_live_pulse_v1");
    expect(handler).toContain("series_consume_copilot_rate_limit_v1");
    expect(handler).toContain("series_get_approved_schedule_candidates_v1");
    expect(handler).not.toMatch(/from\(["'](?:profiles|players|club_members|tournament_entries|tournament_seats)["']\)/);
    expect(handler).not.toContain("SERVICE_ROLE");
    expect(handler).not.toContain("process_local_prototype");
  });

  it("wires the browser through the reviewed Edge adapter with both rollout flags active", () => {
    const flags = readFileSync(join(process.cwd(), "src", "lib", "featureFlags.ts"), "utf8");
    const client = readFileSync(join(process.cwd(), "src", "lib", "series-intelligence", "seriesCopilotEdgeClient.ts"), "utf8");
    const panel = readFileSync(join(process.cwd(), "src", "components", "series-intelligence", "VCopilotPanel.tsx"), "utf8");
    expect(client).toContain('const FUNCTION_NAME = "series-intelligence-copilot"');
    expect(client).toContain("supabase.functions.invoke(FUNCTION_NAME");
    expect(panel).toContain("askSeriesCopilotEdgeV1");
    expect(flags).toMatch(/seriesClubPulseV1:\s*true/);
    expect(flags).toMatch(/seriesVCopilotV1:\s*true/);
  });
});
