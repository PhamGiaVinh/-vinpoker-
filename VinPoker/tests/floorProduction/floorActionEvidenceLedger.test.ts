import { describe, expect, it } from "vitest";
import {
  baselineEvidence,
  discoveryEvidence,
} from "../../e2e/floor-action-evidence";
import type { FloorButtonCoverageEntry } from "../../e2e/floor-button-coverage.manifest";

const entry = (
  overrides: Partial<FloorButtonCoverageEntry> = {},
): FloorButtonCoverageEntry => ({
  id: "example-action",
  route: "/floor",
  role: "floor",
  viewport: "all",
  label: "Example",
  expectedState: "enabled",
  expectedBackendCall: "example_rpc",
  expectedDbInvariant: "exact owned row changes once",
  fixtureScenario: "ACCESS",
  destructive: true,
  ...overrides,
});

describe("Floor action evidence ledger", () => {
  it("starts enabled actions BLOCKED until an actual browser action supplies evidence", () => {
    expect(baselineEvidence(entry()).status).toBe("BLOCKED");
    const discovered = discoveryEvidence(entry(), "mobile-390x844", true);
    expect(discovered.status).toBe("BLOCKED");
    expect(discovered.stateMismatch).toBe(false);
  });

  it("classifies observed navigation, disabled and excluded controls without pretending to click", () => {
    expect(discoveryEvidence(
      entry({ expectedState: "navigation-only", destructive: false }),
      "desktop-1280x900",
      true,
    ).status).toBe("NAVIGATION_ONLY");
    expect(discoveryEvidence(
      entry({ expectedState: "disabled" }),
      "desktop-1280x900",
      false,
    ).status).toBe("EXPECTED_DISABLED");
    expect(discoveryEvidence(
      entry({ exclusionReason: "EXCLUDED_WITH_REASON: policy" }),
      "desktop-1280x900",
      true,
    ).status).toBe("EXCLUDED_WITH_REASON");
  });

  it("fails closed on an observed state mismatch", () => {
    const unexpectedlyEnabled = discoveryEvidence(
      entry({ expectedState: "disabled" }),
      "tablet-portrait",
      true,
    );
    expect(unexpectedlyEnabled.status).toBe("BLOCKED");
    expect(unexpectedlyEnabled.stateMismatch).toBe(true);
    const unexpectedlyDisabled = discoveryEvidence(
      entry({ expectedState: "enabled" }),
      "tablet-portrait",
      false,
    );
    expect(unexpectedlyDisabled.status).toBe("BLOCKED");
    expect(unexpectedlyDisabled.stateMismatch).toBe(true);
  });
});
