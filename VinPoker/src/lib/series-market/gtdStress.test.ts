import { describe, expect, it } from "vitest";
import { canonicalize } from "../series-intelligence/provenanceHash";
import {
  createGtdStressScenario,
  GTD_STRESS_CALCULATION_PROTOCOL_ID,
  GTD_STRESS_CALCULATION_PROTOCOL_VERSION,
  type GtdStressInput,
  type GtdStressMoneyEvidenceInput,
} from "./gtdStress";

const resolved = (
  minorUnits: string,
  currency = "KRW",
  scale = 0,
  claimIds: readonly string[] = ["claim-1"],
): GtdStressMoneyEvidenceInput => ({
  state: "resolved",
  value: { minorUnits, currency, scale },
  claimIds,
});

const quantiles = {
  label: "Historical Benchmark" as const,
  interpretation: "historical comparable field quantiles" as const,
  p10: "80",
  p25: "90",
  p50: "100",
  p75: "110",
  p90: "120",
};

function input(overrides: Partial<GtdStressInput> = {}): GtdStressInput {
  return {
    targetEventId: "event-1",
    sourceArtifactId: "artifact-1",
    comparableProvenance: {
      comparableAnalysisId: "analysis-1",
      selectionProtocolId: "jeju-comparable-v0",
      distributionMethodId: "nearest-rank-count-quantiles-v1",
    },
    gtd: resolved("1000", "KRW", 0, ["gtd-b", "gtd-a"]),
    prizeContributionPerEntry: resolved("100", "KRW", 0, ["contribution-b", "contribution-a"]),
    historicalComparableQuantiles: quantiles,
    evidenceQuality: "unverified",
    calculationProtocolId: GTD_STRESS_CALCULATION_PROTOCOL_ID,
    calculationProtocolVersion: GTD_STRESS_CALCULATION_PROTOCOL_VERSION,
    ...overrides,
  };
}

describe("deterministic GTD Stress V0", () => {
  it("calculates exact ceiling, exact divisibility, and a one-minor-unit remainder", async () => {
    const exact = await createGtdStressScenario(input());
    const remainder = await createGtdStressScenario(input({ gtd: resolved("1001") }));
    expect(exact.state).toBe("available");
    expect(remainder.state).toBe("available");
    if (exact.state !== "available" || remainder.state !== "available") return;
    expect(exact.requiredEntries).toBe("10");
    expect(remainder.requiredEntries).toBe("11");
  });

  it("uses BigInt arithmetic for very large amounts", async () => {
    const result = await createGtdStressScenario(input({
      gtd: resolved("999999999999999999999999999999999999999"),
      prizeContributionPerEntry: resolved("3"),
    }));
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.requiredEntries).toBe("333333333333333333333333333333333333333");
  });

  it("normalizes differing exact scales without FX conversion", async () => {
    const result = await createGtdStressScenario(input({
      gtd: resolved("1000", "krw", 0),
      prizeContributionPerEntry: resolved("2500", "KRW", 2),
    }));
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.calculationScale).toBe(2);
    expect(result.requiredEntries).toBe("40");
    expect(result.quantileScenarios[0].historicalPrizeContribution).toEqual({
      type: "money",
      minorUnits: "200000",
      currency: "KRW",
      scale: 2,
    });
  });

  it.each([
    ["invalid_scale", input({ gtd: resolved("1000", "KRW", 19) })],
    ["currency_mismatch", input({ prizeContributionPerEntry: resolved("100", "USD", 0) })],
    ["missing_gtd", input({ gtd: { state: "missing", value: null, claimIds: ["gtd-missing"] } })],
    ["missing_prize_contribution", input({
      prizeContributionPerEntry: { state: "missing", value: null, claimIds: ["contribution-missing"] },
    })],
    ["zero_prize_contribution", input({ prizeContributionPerEntry: resolved("0") })],
    ["unavailable_historical_distribution", input({ historicalComparableQuantiles: null })],
    ["conflicting_evidence", input({
      gtd: { state: "conflicting", value: null, claimIds: ["gtd-a", "gtd-b"] },
    })],
  ] as const)("returns explicit unavailable state %s", async (reason, caseInput) => {
    const result = await createGtdStressScenario(caseInput);
    expect(result.state).toBe("unavailable");
    if (result.state !== "unavailable") return;
    expect(result.unavailableReason).toBe(reason);
    expect(result.requiredEntries).toBeNull();
    expect(result.quantileScenarios).toEqual([]);
  });

  it("accepts GTD zero while keeping it distinct from missing GTD", async () => {
    const zero = await createGtdStressScenario(input({ gtd: resolved("0") }));
    const missing = await createGtdStressScenario(input({
      gtd: { state: "missing", value: null, claimIds: ["gtd-a", "gtd-b"] },
    }));
    expect(zero.state).toBe("available");
    if (zero.state === "available") {
      expect(zero.requiredEntries).toBe("0");
      expect(zero.quantileScenarios.every((scenario) => scenario.shortfall.minorUnits === "0")).toBe(true);
    }
    expect(missing.state).toBe("unavailable");
    expect(zero.scenarioId).not.toBe(missing.scenarioId);
  });

  it("computes every quantile scenario and signed invariants exactly", async () => {
    const result = await createGtdStressScenario(input({
      gtd: resolved("10000"),
      prizeContributionPerEntry: resolved("100"),
    }));
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.quantileScenarios.map((scenario) => scenario.quantile)).toEqual([
      "p10", "p25", "p50", "p75", "p90",
    ]);
    expect(result.quantileScenarios.map((scenario) => scenario.historicalFieldEntries)).toEqual([
      "80", "90", "100", "110", "120",
    ]);
    expect(result.quantileScenarios.map((scenario) => scenario.signedGtdGap.minorUnits)).toEqual([
      "-2000", "-1000", "0", "1000", "2000",
    ]);
    expect(result.quantileScenarios.map((scenario) => scenario.shortfall.minorUnits)).toEqual([
      "2000", "1000", "0", "0", "0",
    ]);
    expect(result.quantileScenarios.map((scenario) => scenario.surplus.minorUnits)).toEqual([
      "0", "0", "0", "1000", "2000",
    ]);
    expect(result.quantileScenarios.map((scenario) => scenario.requiredEntriesGap)).toEqual([
      "-20", "-10", "0", "10", "20",
    ]);
  });

  it("treats a non-monotonic historical distribution as unavailable", async () => {
    const result = await createGtdStressScenario(input({
      historicalComparableQuantiles: { ...quantiles, p75: "70" },
    }));
    expect(result.state).toBe("unavailable");
    if (result.state === "unavailable") {
      expect(result.unavailableReason).toBe("unavailable_historical_distribution");
    }
  });

  it("makes identity order-invariant for claims and sensitive to source and quantiles", async () => {
    const original = await createGtdStressScenario(input());
    const reordered = await createGtdStressScenario(input({
      gtd: resolved("1000", "KRW", 0, ["gtd-a", "gtd-b"]),
      prizeContributionPerEntry: resolved("100", "KRW", 0, ["contribution-a", "contribution-b"]),
    }));
    const changedSource = await createGtdStressScenario(input({ sourceArtifactId: "artifact-2" }));
    const changedMoney = await createGtdStressScenario(input({ gtd: resolved("1001") }));
    const changedQuantile = await createGtdStressScenario(input({
      historicalComparableQuantiles: { ...quantiles, p90: "121" },
    }));
    expect(reordered.scenarioId).toBe(original.scenarioId);
    expect(changedSource.scenarioId).not.toBe(original.scenarioId);
    expect(changedMoney.scenarioId).not.toBe(original.scenarioId);
    expect(changedQuantile.scenarioId).not.toBe(original.scenarioId);
  });

  it("rejects duplicate claim IDs after normalization", async () => {
    await expect(createGtdStressScenario(input({
      gtd: resolved("1000", "KRW", 0, ["claim-a", "claim-a"]),
    }))).rejects.toMatchObject({ code: "DUPLICATE_GTD_STRESS_CLAIM" });
  });

  it("returns deeply immutable byte-identical output for identical inputs", async () => {
    const callerInput = input();
    const callerInputBefore = canonicalize(callerInput);
    const first = await createGtdStressScenario(callerInput);
    const second = await createGtdStressScenario(callerInput);
    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(canonicalize(callerInput)).toBe(callerInputBefore);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.comparableProvenance)).toBe(true);
    expect(Object.isFrozen(first.quantileScenarios)).toBe(true);
    if (first.state === "available") expect(Object.isFrozen(first.quantileScenarios[0].shortfall)).toBe(true);
  });

  it("preserves unverified evidence and historical-only language", async () => {
    const result = await createGtdStressScenario(input());
    expect(result.evidenceQuality).toBe("unverified");
    expect(result.evidenceState).toBe("unverified_evidence");
    expect(result.limitations.join(" ")).toContain("unverified");
    expect(result.allowedClaims.join(" ")).not.toMatch(
      /overlay probability|probability of overlay|probability of reaching GTD|optimal GTD|recommended GTD|safe GTD|expected entries|forecast interval/i,
    );
    expect(result.label).toBe("Historical GTD Stress");
    if (result.state === "available") {
      expect(result.quantileScenarios.every(
        (scenario) => scenario.interpretation === "historical comparable field quantiles",
      )).toBe(true);
    }
  });
});
