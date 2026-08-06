import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src");
const SI = join(ROOT, "lib", "series-intelligence");
const runtimeFiles = ["decisionPacketRuntimeTypes.ts", "decisionPacketRpc.ts", "decisionPacketReadModel.ts"];

describe("D2B private runtime boundary", () => {
  it("keeps D2B local: no public-market, UI, legacy-cache, model or global generated-type dependency", () => {
    for (const name of runtimeFiles) {
      const source = readFileSync(join(SI, name), "utf8");
      expect(source).not.toMatch(/series-market|components\/|pages\/|series_event_actuals|series_decision_logs|series_registration_events|types\.ts/i);
    }
  });

  it("exposes only the three named D2B RPCs and no caller-controlled rpc name", () => {
    const source = readFileSync(join(SI, "decisionPacketRpc.ts"), "utf8");
    expect(source).toContain("series_promote_native_event_actual_v1");
    expect(source).toContain("series_reconcile_event_actual_v1");
    expect(source).toContain("series_get_decision_event_state_v1");
    expect(source).not.toMatch(/rpc\(\s*name\s*[:,)]/);
    expect(source).not.toMatch(/export\s+(?:const|function)\s+.*rpc/i);
  });

  it("adds no Decision Room UI or D2B feature flag", () => {
    const sourceFiles = readdirSync(ROOT, { recursive: true }).filter((path) => typeof path === "string" && path.endsWith(".ts") || typeof path === "string" && path.endsWith(".tsx")) as string[];
    for (const relative of sourceFiles) {
      if (relative.includes("node_modules")) continue;
      if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) continue;
      const source = readFileSync(join(ROOT, relative), "utf8");
      expect(source).not.toContain("seriesDecisionRoom");
      if (!relative.replaceAll("\\", "/").includes("lib/series-intelligence/decisionPacket")) expect(source).not.toContain("decisionPacketRpc");
    }
  });
});
