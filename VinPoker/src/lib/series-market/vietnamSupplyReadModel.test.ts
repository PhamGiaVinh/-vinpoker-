import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createVietnamSupplyReadModel,
  EMPTY_VIETNAM_SUPPLY_FILTERS,
  filterVietnamSupplyEvents,
  VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256,
  VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID,
  VIETNAM_SUPPLY_CURRENT_CORRECTION_ID,
  VIETNAM_SUPPLY_CURRENT_RECEIPT_ID,
  VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
  VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
  type VietnamSupplyReadModel,
} from "./vietnamSupplyReadModel";

const ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const DATASET = join(
  ROOT,
  "src/lib/series-market/datasets/vietnam/schedule-supply/v1",
);

const rawArtifact = readFileSync(join(DATASET, "research/schedule-supply-v1.json"), "utf8");
const release = JSON.parse(readFileSync(join(DATASET, "release.json"), "utf8")) as unknown;
const receipt = JSON.parse(
  readFileSync(join(DATASET, "research/schedule-supply-v1.receipt.json"), "utf8"),
) as unknown;
const correction = JSON.parse(
  readFileSync(join(DATASET, "corrections/d1a-correction-001-center-p-after-dark.json"), "utf8"),
) as unknown;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function build(overrides: Partial<{
  rawArtifact: string;
  release: unknown;
  receipt: unknown;
  correction: unknown;
}> = {}) {
  return createVietnamSupplyReadModel({
    rawArtifact: overrides.rawArtifact ?? rawArtifact,
    release: overrides.release ?? release,
    receipt: overrides.receipt ?? receipt,
    correction: overrides.correction ?? correction,
  });
}

describe("Vietnam supply trusted read model", () => {
  let model: VietnamSupplyReadModel;

  beforeAll(async () => {
    model = await build();
  });

  it("binds the corrected release, artifact, receipt, correction, and exact file hash", () => {
    expect(model.releaseId).toBe(VIETNAM_SUPPLY_CURRENT_RELEASE_ID);
    expect(model.artifactId).toBe(VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID);
    expect(model.receiptId).toBe(VIETNAM_SUPPLY_CURRENT_RECEIPT_ID);
    expect(model.correctionId).toBe(VIETNAM_SUPPLY_CURRENT_CORRECTION_ID);
    expect(model.artifactFileSha256).toBe(VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256);
    expect(model.integrityState).toBe("corrected");
  });

  it("exposes the released source, event, and claim counts", () => {
    expect(model.overview).toMatchObject({
      seriesCount: 3,
      sourceCount: 3,
      eventCount: 46,
      claimCount: 1288,
      calculableRequiredMetricCount: 10,
    });
  });

  it("uses exact released GTD totals and calculable required entries", () => {
    expect(model.overview.announcedGtdTotals).toHaveLength(1);
    expect(model.overview.announcedGtdTotals[0]).toMatchObject({
      minorUnits: "26559000000",
      currency: "VND",
      scale: 0,
    });
    expect(model.overview.calculableRequiredEntries).toBe("2271");
  });

  it("keeps RPT required entries unavailable when prize contribution is not split", () => {
    const rpt = model.series.find((series) => series.sourceLabel === "RPT");
    expect(rpt).toMatchObject({
      eventCount: 27,
      calculableRequiredEntries: null,
      calculableRequiredMetricCount: 0,
    });
    expect(rpt?.requiredEntriesReason).toContain("does not explicitly split");
    expect(
      model.events
        .filter((event) => event.sourceLabel === "RPT")
        .every((event) => event.requiredEntries.state === "unavailable"),
    ).toBe(true);
  });

  it("keeps seats, tickets, monetary GTD, and missing GTD distinct", () => {
    const kinds = new Set(model.events.map((event) => event.gtdKind));
    expect(kinds).toEqual(new Set(["monetary", "seats", "tickets", "missing"]));
    expect(model.events.find((event) => event.gtdKind === "seats")?.gtdMoney).toBeNull();
    expect(model.events.find((event) => event.gtdKind === "tickets")?.gtdDisplay).toContain("tickets");
    expect(model.events.find((event) => event.gtdKind === "missing")?.gtdDisplay).toContain("Missing");
  });

  it("preserves total-only buy-in instead of inventing a prize/fee split", () => {
    const rpt = model.events.find(
      (event) => event.sourceLabel === "RPT" && event.totalBuyIn !== null,
    );
    expect(rpt?.buyInDisplay).toContain("total");
    expect(rpt?.prizeContribution).toBeNull();
    expect(rpt?.organizerFee).toBeNull();
  });

  it("represents empty and available collision windows without player-demand claims", () => {
    expect(model.collisionWindows.find((window) => window.key === "same_day")).toMatchObject({
      state: "empty",
      groupCount: 0,
    });
    const fourteen = model.collisionWindows.find((window) => window.key === "within_14_days");
    expect(fourteen).toMatchObject({ state: "available", groupCount: 1 });
    expect(fourteen?.groups[0]).toMatchObject({
      distanceDays: "12",
      combinedRequiredEntries: "2271",
      calculableRequiredEntryEvents: "10",
    });
  });

  it("distinguishes exact template equality from partial RPT structural similarity", () => {
    const exact = model.templates.find((template) => template.matchKind === "exact");
    const partial = model.templates.find((template) => template.matchKind === "partial");
    expect(exact?.sourceLabels).toEqual(["Center-P", "Grand Loyal"]);
    expect(exact?.eventIds).toHaveLength(3);
    expect(partial?.sourceLabels).toEqual(["RPT"]);
    expect(partial?.matchedFields).toEqual(expect.arrayContaining([
      "Event family",
      "Total buy-in",
      "Monetary GTD",
      "Starting stack",
      "Multi-flight",
    ]));
    expect(partial?.requiredEntriesState).toBe("partially_unavailable");
  });

  it("surfaces the corrected Center-P After Dark contribution lineage", () => {
    expect(model.correction).toMatchObject({
      affectedEventKey: "center-p-after-dark",
      affectedField: "prize_contribution",
      correctedReleaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
      supersededReleaseId: VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
    });
    expect(model.correction.oldValue.minorUnits).toBe("3000000");
    expect(model.correction.newValue.minorUnits).toBe("2000000");
  });

  it("keeps every event and claim explicitly unverified with source references", () => {
    expect(model.evidenceQuality).toBe("owner_provided_public_image_unverified");
    for (const event of model.events) {
      expect(event.evidenceQuality).toBe("owner_provided_public_image_unverified");
      expect(event.claims).toHaveLength(28);
      for (const claim of event.claims) {
        expect(claim.evidenceQuality).toBe("owner_provided_public_image_unverified");
        expect(claim.sourcePath).toMatch(/^docs\/series\/evidence\/vietnam\/inbox\//);
        expect(claim.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(claim.visualRegion.length).toBeGreaterThan(0);
      }
    }
  });

  it("deep-freezes the trusted model graph", () => {
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.events)).toBe(true);
    expect(Object.isFrozen(model.events[0])).toBe(true);
    expect(Object.isFrozen(model.events[0]?.claims)).toBe(true);
    expect(Object.isFrozen(model.collisionWindows[0])).toBe(true);
  });

  it("fails closed when exact artifact bytes change", async () => {
    await expect(build({ rawArtifact: `${rawArtifact}\n` })).rejects.toMatchObject({
      code: "VIETNAM_SUPPLY_ARTIFACT_FILE_HASH_MISMATCH",
    });
  });

  it("fails closed for the superseded release identity", async () => {
    const forged = clone(release) as { releaseId: string };
    forged.releaseId = VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID;
    await expect(build({ release: forged })).rejects.toMatchObject({
      code: "VIETNAM_SUPPLY_RELEASE_SUPERSEDED",
    });
  });

  it("fails closed for mismatched receipt lineage", async () => {
    const forged = clone(receipt) as { artifactId: string };
    forged.artifactId = "series-market:v1:vietnam-schedule-supply:v1:artifact:forged";
    await expect(build({ receipt: forged })).rejects.toMatchObject({
      code: "VIETNAM_SUPPLY_GRAPH_LINK_MISMATCH",
    });
  });

  it("fails closed when correction audit no longer covers every row", async () => {
    const forged = clone(correction) as { rowAudits: unknown[] };
    forged.rowAudits = forged.rowAudits.slice(1);
    await expect(build({ correction: forged })).rejects.toMatchObject({
      code: "VIETNAM_SUPPLY_CORRECTION_AUDIT_INCOMPLETE",
    });
  });

  it("fails closed when a release identity set contains duplicates", async () => {
    const forged = clone(release) as { eventIds: string[] };
    forged.eventIds[1] = forged.eventIds[0]!;
    await expect(build({ release: forged })).rejects.toMatchObject({
      code: "VIETNAM_SUPPLY_DUPLICATE_IDENTITY",
    });
  });

  it("filters deterministically across series, GTD, role, required, and missing states", () => {
    const monetary = filterVietnamSupplyEvents(model.events, {
      ...EMPTY_VIETNAM_SUPPLY_FILTERS,
      gtdKind: "monetary",
      requiredState: "calculable",
    });
    expect(monetary.length).toBeGreaterThan(0);
    expect(monetary.every((event) =>
      event.gtdKind === "monetary" && event.requiredEntries.state === "calculable"
    )).toBe(true);

    const rptSatellites = filterVietnamSupplyEvents(model.events, {
      ...EMPTY_VIETNAM_SUPPLY_FILTERS,
      sourceId: "rpt-sep-11-12-2026",
      role: "satellite",
      requiredState: "unavailable",
    });
    expect(rptSatellites.length).toBeGreaterThan(0);
    expect(rptSatellites.every((event) => event.sourceLabel === "RPT")).toBe(true);
  });

  it("does not expose turnout or player-flow numerical fields", () => {
    const serialized = JSON.stringify(model);
    expect(serialized).not.toMatch(/actualEntries|observedEntries|observedTurnout|uniquePlayers|reentries/);
    expect(model.limitations.some((item) => item.includes("player-flow intelligence are unavailable"))).toBe(true);
  });
});
