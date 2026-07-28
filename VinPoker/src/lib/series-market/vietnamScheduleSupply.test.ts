import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../series-intelligence/provenanceHash";
import {
  createVietnamScheduleSupplyBundle,
  SCHEDULE_EVIDENCE_QUALITY,
  type ScheduleEvidenceSource,
  type ScheduleSeedEvent,
} from "./vietnamScheduleSupply";
import { SeriesMarketValidationError } from "./normalization";
import {
  VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
  VIETNAM_SCHEDULE_SUPPLY_V1_SOURCE_CUTOFF,
  VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
} from "./vietnamScheduleSupplySeed";

const ROOT = process.cwd().endsWith("VinPoker") ? process.cwd() : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(
  ROOT,
  "src/lib/series-market/datasets/vietnam/schedule-supply/v1",
);

function cloneSources(): ScheduleEvidenceSource[] {
  return structuredClone(VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES) as ScheduleEvidenceSource[];
}

function cloneEvents(): ScheduleSeedEvent[] {
  return structuredClone(VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS) as ScheduleSeedEvent[];
}

function eventIndex(events: readonly ScheduleSeedEvent[], key: string): number {
  const index = events.findIndex((event) => event.eventKey === key);
  if (index < 0) throw new Error(`missing test event ${key}`);
  return index;
}

async function createBundle(
  sources: readonly ScheduleEvidenceSource[] = VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
  events: readonly ScheduleSeedEvent[] = VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
  sourceCutoff = VIETNAM_SCHEDULE_SUPPLY_V1_SOURCE_CUTOFF,
) {
  return createVietnamScheduleSupplyBundle({ sourceCutoff, sources, events });
}

describe("Vietnam Schedule Supply V1 evidence", () => {
  it("preserves exactly three distinct original PNG byte streams", () => {
    expect(VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES).toHaveLength(3);
    const hashes = new Set<string>();
    for (const source of VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES) {
      const bytes = readFileSync(join(ROOT, source.sourcePath));
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.byteLength.toString()).toBe(source.sourceByteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sourceSha256);
      hashes.add(source.sourceSha256);
    }
    expect(hashes.size).toBe(3);
  });

  it("is byte-stable under semantic source and row ordering", async () => {
    const first = await createBundle();
    const second = await createBundle(
      [...VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES].reverse(),
      [...VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS].reverse(),
    );

    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(first.release.releaseId).toBe(second.release.releaseId);
    expect(first.inclusionManifest.inclusionManifestId).toBe(
      second.inclusionManifest.inclusionManifestId,
    );
    expect(first.artifact.artifactId).toBe(second.artifact.artifactId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.artifact.events)).toBe(true);
    expect(Object.isFrozen(first.artifact.claims)).toBe(true);
  });

  it("content-addresses source bytes, cutoff, missing, zero, and conflict separately", async () => {
    const baseline = await createBundle();
    const changedSources = cloneSources();
    changedSources[0] = {
      ...changedSources[0],
      sourceSha256: `${changedSources[0].sourceSha256[0] === "a" ? "b" : "a"}${changedSources[0].sourceSha256.slice(1)}`,
    };
    const changedCutoff = await createBundle(
      VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
      VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
      "2026-07-28T14:06:00.000Z",
    );
    const zeroEvents = cloneEvents();
    const zeroIndex = eventIndex(zeroEvents, "rpt-d1-s2-high-roller-opener-satellite");
    zeroEvents[zeroIndex] = {
      ...zeroEvents[zeroIndex],
      gtd: { type: "monetary", minorUnits: "0", currency: "VND", scale: 0 },
    };
    const conflictEvents = cloneEvents();
    const conflictIndex = eventIndex(conflictEvents, "center-p-mini-deepstack");
    conflictEvents[conflictIndex] = {
      ...conflictEvents[conflictIndex],
      conflictingFields: ["gtd"],
    };

    const sourceChanged = await createBundle(changedSources);
    const zeroChanged = await createBundle(VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES, zeroEvents);
    const conflictChanged = await createBundle(VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES, conflictEvents);

    expect(sourceChanged.release.releaseId).not.toBe(baseline.release.releaseId);
    expect(changedCutoff.release.releaseId).not.toBe(baseline.release.releaseId);
    expect(zeroChanged.release.releaseId).not.toBe(baseline.release.releaseId);
    expect(conflictChanged.release.releaseId).not.toBe(baseline.release.releaseId);
    expect(conflictChanged.artifact.claims.some((claim) => claim.extractionStatus === "conflicting")).toBe(true);
  });

  it("extracts 46 rows and keeps every claim unverified with field provenance", async () => {
    const { artifact } = await createBundle();

    expect(artifact.eventCount).toBe("46");
    expect(artifact.claimCount).toBe("1288");
    expect(artifact.events).toHaveLength(46);
    expect(artifact.claims).toHaveLength(1288);
    expect(artifact.claims.every((claim) => claim.evidenceQuality === SCHEDULE_EVIDENCE_QUALITY)).toBe(true);
    expect(artifact.claims.every((claim) => claim.sourcePath.startsWith("docs/series/evidence/vietnam/inbox/"))).toBe(true);
    expect(artifact.claims.every((claim) => /^[a-f0-9]{64}$/.test(claim.sourceSha256))).toBe(true);
    expect(artifact.claims.every((claim) => claim.visualRegion.length > 0)).toBe(true);
    expect(artifact.claims.every((claim) => claim.claimId.includes(":claim:"))).toBe(true);
  });

  it("keeps seats and tickets non-monetary and does not infer prize contribution from total buy-in", async () => {
    const { artifact } = await createBundle();
    const nonMonetaryGtdClaims = artifact.claims.filter(
      (claim) => claim.field === "gtd" && (claim.value.type === "seats" || claim.value.type === "tickets"),
    );
    const rptRequired = artifact.requiredEntriesByEvent.filter(
      (metric) => metric.sourceId === "rpt-sep-11-12-2026",
    );
    const rptEventsWithBuyIn = artifact.events.filter(
      (event) => event.sourceId === "rpt-sep-11-12-2026" && event.totalBuyInMinorUnits !== null,
    );

    expect(nonMonetaryGtdClaims.length).toBeGreaterThan(0);
    expect(rptEventsWithBuyIn.length).toBeGreaterThan(0);
    expect(rptEventsWithBuyIn.every((event) => event.prizeContributionMinorUnits === null)).toBe(true);
    expect(rptRequired).toEqual([]);
  });

  it("uses exact integer ceiling arithmetic without mixing currency", async () => {
    const baseline = await createBundle();
    const byCompetition = new Map(
      baseline.artifact.requiredEntriesByEvent.map((metric) => [metric.competitionKey, metric] as const),
    );
    expect(byCompetition.get("center-p-event-7-mini-deepstack")?.requiredEntries).toBe("34");
    expect(byCompetition.get("center-p-event-9-after-dark")?.requiredEntries).toBe("15");
    expect(byCompetition.get("grand-loyal-event-2-high-roller-warm-up")?.requiredEntries).toBe("67");

    const events = cloneEvents();
    const index = eventIndex(events, "center-p-after-dark");
    const hugeGtd = "999999999999999999999999999999999999";
    events[index] = {
      ...events[index],
      gtd: { type: "monetary", minorUnits: hugeGtd, currency: "VND", scale: 0 },
      prizeContributionMinorUnits: "3",
    };
    const huge = await createBundle(VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES, events);
    const metric = huge.artifact.requiredEntriesByEvent.find(
      (row) => row.competitionKey === "center-p-event-9-after-dark",
    );
    expect(metric?.requiredEntries).toBe(
      ((BigInt(hugeGtd) + 2n) / 3n).toString(),
    );

    const usdEvents = cloneEvents().map((event) => event.sourceId !== "grand-loyal-jul-29-2026"
      ? event
      : {
          ...event,
          currency: "USD",
          gtd: event.gtd.type === "monetary"
            ? { ...event.gtd, currency: "USD" }
            : event.gtd,
        });
    const splitCurrency = await createBundle(
      VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
      usdEvents,
    );
    const collisionCurrencies = splitCurrency.artifact.collisionReports.flatMap(
      (collision) => collision.monetaryGtdTotalsByCurrency.map((money) => money.currency),
    );
    expect(collisionCurrencies).toContain("USD");
    expect(collisionCurrencies).toContain("VND");
    expect(splitCurrency.artifact.monetaryGtdTotalsBySeries.some((money) => money.currency === "USD")).toBe(true);
  });

  it("derives deterministic totals, required fields, and collision windows", async () => {
    const { artifact } = await createBundle();
    const gtdBySeries = new Map(
      artifact.monetaryGtdTotalsBySeries.map((row) => [row.key, row.totalMinorUnits] as const),
    );
    const requiredByDate = new Map(
      artifact.combinedRequiredEntriesByDate.map((row) => [row.date, row.totalRequiredEntries] as const),
    );

    expect(gtdBySeries).toEqual(new Map([
      ["center-p-jul-17-2026", "7830000000"],
      ["grand-loyal-jul-29-2026", "8415000000"],
      ["rpt-sep-11-12-2026", "10314000000"],
    ]));
    expect(requiredByDate.get("2026-07-17")).toBe("1119");
    expect(requiredByDate.get("2026-07-29")).toBe("1152");
    expect(artifact.collisionReports.map((report) => report.window)).toEqual([
      "within_14_days",
      "within_30_days",
    ]);
    expect(artifact.collisionReports.every((report) => report.distanceDays === "12")).toBe(true);
    expect(artifact.collisionReports.every((report) => report.combinedRequiredEntries === "2271")).toBe(true);
  });

  it("excludes branding from template identity and includes structural changes", async () => {
    const baseline = await createBundle();
    const brandedSources = cloneSources();
    brandedSources[1] = {
      ...brandedSources[1],
      organizer: "Alternate public organizer label",
      venue: "Alternate public venue label",
      seriesName: "Alternate public series label",
    };
    const branded = await createBundle(brandedSources);
    const baselineFingerprints = new Map(
      baseline.artifact.templateFingerprints.map((row) => [row.eventKey, row.fingerprintId] as const),
    );
    expect(baselineFingerprints.get("center-p-kick-off-day-1c")).toBe(
      baselineFingerprints.get("center-p-kick-off-day-1d"),
    );
    expect(baselineFingerprints.get("center-p-kick-off-day-1c")).toBe(
      baselineFingerprints.get("grand-loyal-madness-kick-off-day-1a"),
    );
    const brandedFingerprints = new Map(
      branded.artifact.templateFingerprints.map((row) => [row.eventKey, row.fingerprintId] as const),
    );
    expect(brandedFingerprints).toEqual(baselineFingerprints);

    const structuralEvents = cloneEvents();
    const index = eventIndex(structuralEvents, "center-p-mini-deepstack");
    structuralEvents[index] = { ...structuralEvents[index], startingStack: "41000" };
    const structural = await createBundle(
      VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
      structuralEvents,
    );
    const changedFingerprint = structural.artifact.templateFingerprints.find(
      (row) => row.eventKey === "center-p-mini-deepstack",
    );
    expect(changedFingerprint?.fingerprintId).not.toBe(
      baselineFingerprints.get("center-p-mini-deepstack"),
    );
  });

  it("fails closed on duplicate rows and incompatible money semantics", async () => {
    await expect(createBundle(
      VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
      [
        ...VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
        VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS[0],
      ],
    )).rejects.toBeInstanceOf(SeriesMarketValidationError);

    const events = cloneEvents();
    const index = eventIndex(events, "center-p-mini-deepstack");
    events[index] = {
      ...events[index],
      gtd: { type: "monetary", minorUnits: "100000000", currency: "USD", scale: 0 },
    };
    await expect(createBundle(VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES, events))
      .rejects.toMatchObject({ code: "SCHEDULE_GTD_CURRENCY_MISMATCH" });
  });

  it("commits a reproducible artifact without decision or probability language", async () => {
    const bundle = await createBundle();
    const committedArtifact = JSON.parse(
      readFileSync(join(RELEASE_ROOT, "research/schedule-supply-v1.json"), "utf8"),
    ) as unknown;
    const committedRelease = JSON.parse(
      readFileSync(join(RELEASE_ROOT, "release.json"), "utf8"),
    ) as unknown;
    const artifactText = canonicalize(bundle.artifact);
    const forbidden = /(?:overlay probability|chance of overlay|optimal GTD|recommended GTD|guaranteed turnout|calibrated interval|causal effect)/i;

    expect(canonicalize(committedArtifact)).toBe(artifactText);
    expect(canonicalize(committedRelease)).toBe(canonicalize(bundle.release));
    expect(artifactText).not.toMatch(forbidden);
  });
});
