import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";

const panel = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/HandHistoryPanel.tsx"), "utf8");
const control = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/HistoricalSettlementDisplayControl.tsx"), "utf8");

describe("historical settlement display capability", () => {
  it("defaults off and does not mount the historical Edge caller in the legacy path", () => {
    expect(FEATURES.trackerHistoricalSettlementDisplay).toBe(false);
    expect(panel).toContain("FEATURES.trackerHistoricalSettlementDisplay && !editMode");
  });

  it("submits only an intent plus preview CAS values, never a browser winner or stack", () => {
    expect(control).toContain('mode: "preview"');
    expect(control).toContain('mode: "commit"');
    expect(control).toContain("expected_source_revision: preview.sourceRevision");
    expect(control).toContain("parseHistoricalSettlementDisplayPreview(data, crypto.randomUUID())");
    expect(control).toContain("idempotency_key: preview.idempotencyKey");
    expect(control).not.toMatch(/\bwinner_id\s*:/);
    expect(control).not.toMatch(/\bending_stack\s*:/);
  });
});
