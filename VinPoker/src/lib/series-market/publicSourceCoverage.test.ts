import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatasetRelease, SourceClaim } from "./contracts";
import { importJejuSeed, type JejuImportDataset, type JejuSeedSourceManifest } from "./jejuSeedAdapter";
import {
  createPublicSourceCoverageArtifact,
  createPublicSourceCoverageReceipt,
  PUBLIC_SOURCE_COVERAGE_PRIVATE_FIELD_KEYS,
  type PublicSourceCoverageInput,
} from "./publicSourceCoverage";
import { canonicalize } from "../series-intelligence/provenanceHash";

const ROOT = process.cwd().endsWith("VinPoker") ? process.cwd() : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(ROOT, "src/lib/series-market/datasets/jeju/v1");

async function loadInput(): Promise<{ readonly input: PublicSourceCoverageInput; readonly dataset: JejuImportDataset }> {
  const raw = readFileSync(join(RELEASE_ROOT, "raw/jeju_events_seed_v0.csv"), "utf8");
  const manifest = JSON.parse(readFileSync(join(RELEASE_ROOT, "source-manifest.json"), "utf8")) as JejuSeedSourceManifest;
  const release = JSON.parse(readFileSync(join(RELEASE_ROOT, "release.json"), "utf8")) as DatasetRelease;
  const { dataset } = await importJejuSeed(raw, manifest);
  return {
    dataset,
    input: {
      release,
      scope: {
        marketKey: "jeju",
        scopeKind: "defined_market",
        scopeDefinition: "Jeju-only public live-poker event corpus.",
      },
      entities: [...dataset.festivals, ...dataset.events],
      claims: dataset.claims,
      conflicts: dataset.conflicts,
    },
  };
}

function replaceClaim(claims: readonly SourceClaim[], replacement: SourceClaim): readonly SourceClaim[] {
  return claims.map((claim) => claim.id === replacement.id ? replacement : claim);
}

describe("public source coverage audit", () => {
  it("derives the Jeju V1 corpus coverage deterministically without implementation totals", async () => {
    const { input } = await loadInput();
    const first = await createPublicSourceCoverageArtifact(input);
    const second = await createPublicSourceCoverageArtifact({
      ...input,
      entities: [...input.entities].reverse(),
      claims: [...input.claims].reverse(),
      conflicts: [...input.conflicts].reverse(),
    });

    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(first.artifactId).toBe(second.artifactId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.fieldCoverage)).toBe(true);
    expect(first.counts).toEqual({
      festivals: 5,
      events: 87,
      entities: 92,
      totalClaims: 972,
      presentClaims: 794,
      missingClaims: 178,
      conflictingClaims: 0,
      conflictGroups: 0,
      entriesOutcomeAvailableEvents: 87,
      gtdStressEligibleEvents: 7,
    });
    expect(first.counts.gtdStressEligibleEvents).toBeLessThan(first.counts.events);
  });

  it("includes release and source cutoff in the content-addressed identity", async () => {
    const { input } = await loadInput();
    const baseline = await createPublicSourceCoverageArtifact(input);
    const releaseChanged = await createPublicSourceCoverageArtifact({
      ...input,
      release: { ...input.release, id: `${input.release.id}-alternate` },
    });
    const cutoffChanged = await createPublicSourceCoverageArtifact({
      ...input,
      release: { ...input.release, sourceCutoff: "2026-07-15T00:00:00.000Z" },
    });

    expect(releaseChanged.artifactId).not.toBe(baseline.artifactId);
    expect(cutoffChanged.artifactId).not.toBe(baseline.artifactId);
  });

  it("keeps explicit zero distinct from missing and conflict distinct from missing", async () => {
    const { input } = await loadInput();
    const missingGtd = input.claims.find((claim) => claim.field === "gtd" && claim.value.type === "missing");
    expect(missingGtd).toBeDefined();
    if (!missingGtd) throw new Error("fixture must contain a missing GTD claim");

    const zero: SourceClaim = {
      ...missingGtd,
      kind: "reported",
      status: "unverified",
      value: { type: "money", minorUnits: "0", currency: "KRW", scale: 0 },
      rawValue: "0",
    };
    const conflict: SourceClaim = {
      ...zero,
      status: "conflicting",
    };
    const missingAudit = await createPublicSourceCoverageArtifact(input);
    const zeroAudit = await createPublicSourceCoverageArtifact({
      ...input,
      claims: replaceClaim(input.claims, zero),
    });
    const conflictAudit = await createPublicSourceCoverageArtifact({
      ...input,
      claims: replaceClaim(input.claims, conflict),
    });
    const missingGtdCoverage = missingAudit.fieldCoverage.find((row) => row.entityType === "event" && row.field === "gtd");
    const zeroGtdCoverage = zeroAudit.fieldCoverage.find((row) => row.entityType === "event" && row.field === "gtd");
    const conflictGtdCoverage = conflictAudit.fieldCoverage.find((row) => row.entityType === "event" && row.field === "gtd");

    expect(missingGtdCoverage?.missingClaims).toBeGreaterThan(zeroGtdCoverage?.missingClaims ?? 0);
    expect(zeroGtdCoverage?.presentClaims).toBeGreaterThan(missingGtdCoverage?.presentClaims ?? 0);
    expect(conflictAudit.counts.conflictingClaims).toBe(1);
    expect(conflictGtdCoverage?.evidenceStatusCounts.conflicting).toBe(1);
  });

  it("preserves unverified evidence and derives field-level gaps", async () => {
    const { input } = await loadInput();
    const audit = await createPublicSourceCoverageArtifact(input);
    const status = audit.evidenceStateCoverage.find((row) => row.status === "unverified");
    const gtd = audit.fieldCoverage.find((row) => row.entityType === "event" && row.field === "gtd");
    const prize = audit.fieldCoverage.find((row) => row.entityType === "event" && row.field === "buy_in_prize");
    const organizerFee = audit.fieldCoverage.find((row) => row.entityType === "event" && row.field === "organizer_fee");

    expect(status?.claimCount).toBe(audit.counts.totalClaims);
    expect(gtd?.missingClaims).toBe(80);
    expect(prize?.missingClaims).toBe(49);
    expect(organizerFee?.missingClaims).toBe(49);
    expect(audit.capabilityReadiness.find((row) => row.capabilityKey === "historical_gtd_stress")?.state).toBe("partially_supported");
  });

  it("blocks unsupported future capabilities with machine-readable reasons", async () => {
    const { input } = await loadInput();
    const audit = await createPublicSourceCoverageArtifact(input);
    const byKey = new Map(audit.capabilityReadiness.map((row) => [row.capabilityKey, row] as const));

    expect(byKey.get("registration_curve_nowcasting")).toMatchObject({ state: "blocked_missing_time_series" });
    expect(byKey.get("registration_curve_nowcasting")?.reasonCodes).toContain("registration_timestamp_curves_are_private_and_absent");
    expect(byKey.get("causal_intervention_analysis")).toMatchObject({ state: "blocked_missing_required_fields" });
    expect(byKey.get("cross_market_evaluation")).toMatchObject({ state: "blocked_insufficient_market_diversity" });
    expect(byKey.get("production_forecast_eligibility")).toMatchObject({ state: "not_production_eligible" });
  });

  it("separates market release plans and keeps cross-market corpus references immutable", async () => {
    const { input } = await loadInput();
    const audit = await createPublicSourceCoverageArtifact(input);
    const plans = new Map(audit.marketReleasePlan.plannedReleases.map((plan) => [plan.releaseKey, plan] as const));
    const jeju = plans.get("jeju-v2");
    const vietnam = plans.get("vietnam-v1");
    const sea = plans.get("sea-v1");

    expect(jeju?.allowedMarketKeys).toEqual(["jeju"]);
    expect(vietnam?.allowedMarketKeys).toEqual(["vietnam"]);
    expect(sea?.allowedMarketKeys).toEqual(["sea"]);
    expect(jeju?.releasePlanId).not.toBe(vietnam?.releasePlanId);
    expect(audit.marketReleasePlan.crossMarketCorpus.immutableConstituentReleaseIds).toEqual([input.release.id]);
    expect(audit.marketReleasePlan.crossMarketCorpus.state).toBe("not_created");
    expect(audit.marketReleasePlan.crossMarketCorpus.compatibilityRules).toContain("no_fx_conversion");
  });

  it("creates a separate immutable file-integrity receipt without accepting private fields", async () => {
    const { input } = await loadInput();
    const artifact = await createPublicSourceCoverageArtifact(input);
    const receipt = await createPublicSourceCoverageReceipt({
      artifact,
      artifactPath: "src/lib/series-market/datasets/jeju/v1/research/public-source-coverage-v1.json",
      artifactFileSha256: "a".repeat(64),
    });

    expect(receipt.artifactId).toBe(artifact.artifactId);
    expect(receipt.artifactFileSha256).toBe("a".repeat(64));
    expect(artifact.privateFieldsExcluded).toEqual(PUBLIC_SOURCE_COVERAGE_PRIVATE_FIELD_KEYS);
    expect(Object.keys(artifact)).not.toContain("privateOperatorData");
  });

  it("fails closed when coverage inputs depart from the immutable release", async () => {
    const { input } = await loadInput();
    await expect(createPublicSourceCoverageArtifact({
      ...input,
      claims: input.claims.slice(1),
    })).rejects.toMatchObject({ code: "PUBLIC_COVERAGE_CLAIM_RELEASE_MISMATCH" });
  });
});
