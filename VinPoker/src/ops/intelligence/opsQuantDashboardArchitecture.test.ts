import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { operationsQueryOptions, pulseQueryOptions, registrationQ0QueryOptions, sepayQ0QueryOptions } from "./opsIntelligenceQueryOptions";
import { isOpsQuantDashboardQ1Enabled } from "./opsQuantDashboardGate";

const read = (path: string) => readFileSync(path, "utf8");

describe("Ops Quant Dashboard Q1 architecture", () => {
  it("has an explicit kill switch and keeps its source rollout on", () => {
    expect(isOpsQuantDashboardQ1Enabled(false)).toBe(false);
    expect(isOpsQuantDashboardQ1Enabled(true)).toBe(true);
    expect(read("src/lib/featureFlags.ts")).toMatch(/opsQuantDashboardQ1:\s*true/);
  });

  it("uses one canonical query option source across Q1 and existing panels", () => {
    const command = read("src/ops/intelligence/OpsIntelligenceCommandCenterV1.tsx");
    const q0 = read("src/ops/intelligence/OpsQuantDataHealthQ0Panel.tsx");
    const quant = read("src/ops/intelligence/OpsQuantDashboardQ1View.tsx");
    expect(command).toContain("pulseQueryOptions");
    expect(command).toContain("operationsQueryOptions");
    expect(q0).toContain("registrationQ0QueryOptions");
    expect(q0).toContain("sepayQ0QueryOptions");
    expect(quant).not.toMatch(/queryKey:\s*\[/);
  });

  it("keeps unsafe global clients and Gemini out of the Ops Q1 graph", () => {
    const sources = ["src/ops/intelligence/OpsIntelligenceWorkspaceQ1.tsx", "src/ops/intelligence/OpsQuantDashboardQ1View.tsx", "src/ops/intelligence/opsQuantDashboardQ1Queries.ts"].map(read).join("\n");
    expect(sources).not.toContain("@/integrations/supabase/client");
    expect(sources).not.toContain("seriesCopilotEdgeClient");
    expect(sources).not.toContain("@google/genai");
  });

  it("builds stable canonical query keys", () => {
    const client = {} as Parameters<typeof pulseQueryOptions>[0];
    expect(pulseQueryOptions(client, "club").queryKey).toEqual(["ops", "club", "intelligence", "pulse"]);
    expect(operationsQueryOptions(client, "club", true).queryKey).toEqual(["ops", "club", "intelligence", "operations", "q0"]);
    expect(registrationQ0QueryOptions(client, "club").queryKey).toEqual(["ops", "club", "quant-q0", "registration"]);
    expect(sepayQ0QueryOptions(client, "club").queryKey).toEqual(["ops", "club", "quant-q0", "sepay"]);
  });
});
