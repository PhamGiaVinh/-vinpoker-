import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../series-intelligence/provenanceHash";
import { SeriesMarketValidationError } from "./normalization";
import {
  createD1ACorrectionRecord,
  createScheduleSupplyReceipt,
  createVietnamScheduleSupplyBundle,
  SCHEDULE_FIELD_ORDER,
  type ScheduleSeedEvent,
} from "./vietnamScheduleSupply";
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
const ARTIFACT_REPOSITORY_PATH =
  "src/lib/series-market/datasets/vietnam/schedule-supply/v1/research/schedule-supply-v1.json";
const CORRECTION_PATH = join(
  RELEASE_ROOT,
  "corrections/d1a-correction-001-center-p-after-dark.json",
);
const SUPERSEDED = {
  releaseId:
    "series-market:v1:vietnam-schedule-supply:v1:release:dbd23425e5318a23e07779e2a448120a6c361b16149c90c0ef9481ca816ac150",
  artifactId:
    "series-market:v1:vietnam-schedule-supply:v1:artifact:62a3ec31affac9cf655242f364107b1fbc34b56bf346696d168e39fac0c23c72",
  artifactFileSha256: "dc656a5bca1cde8a657ad79e5cf1631c422ec496f9a055caff3be7157a4c8ca8",
  receiptId:
    "series-market:v1:vietnam-schedule-supply:v1:receipt:240651066c3352afdc16803733cb7bbefbeace72ca495eaedaac075b38a55cc5",
} as const;

function stableJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalize(value)), null, 2)}\n`;
}

async function createCorrection(
  events: readonly ScheduleSeedEvent[] = VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS,
) {
  const bundle = await createVietnamScheduleSupplyBundle({
    sourceCutoff: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCE_CUTOFF,
    sources: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
    events,
  });
  const artifactBytes = stableJson(bundle.artifact);
  const receipt = await createScheduleSupplyReceipt({
    release: bundle.release,
    artifact: bundle.artifact,
    artifactPath: ARTIFACT_REPOSITORY_PATH,
    artifactFileSha256: createHash("sha256").update(artifactBytes).digest("hex"),
    sources: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
  });
  const correction = await createD1ACorrectionRecord({
    correctedAt: "2026-07-28T15:56:43.914Z",
    originalMergeCommit: "8ea4e3594cbfdddddf490117d4f64493ea86c5d1",
    superseded: SUPERSEDED,
    corrected: {
      release: bundle.release,
      artifact: bundle.artifact,
      receipt,
    },
    sources: VIETNAM_SCHEDULE_SUPPLY_V1_SOURCES,
    events,
    affected: {
      sourceId: "center-p-jul-17-2026",
      eventKey: "center-p-after-dark",
      field: "prize_contribution",
      supersededClaimId:
        "series-market:v1:vietnam-schedule-supply:v1:claim:d52765f3d54f786cac6eeddb33e727a9dd57ee592b014b2ff3ec9624ae03a4c9",
      oldMinorUnits: "3000000",
      newMinorUnits: "2000000",
      currency: "VND",
      scale: 0,
      reason: "confirmed visual transcription correction",
      preservedSourceImageSha256:
        "ae86830b97335debcf88e480bc0cf20572426af76ae8456aa2108e88da602cca",
    },
    previousMetrics: {
      eventRequiredEntries: "10",
      seriesDateRequiredEntries: "1114",
      within14DayCollisionRequiredEntries: "2266",
    },
  });
  return { bundle, receipt, correction };
}

describe("D1A Center-P After Dark correction", () => {
  it("uses the poster values and derives required entries without hard-coded corrected totals", async () => {
    const { bundle, correction } = await createCorrection();
    const event = bundle.artifact.events.find((row) => row.eventKey === "center-p-after-dark");
    const metric = bundle.artifact.requiredEntriesByEvent.find(
      (row) => row.competitionKey === "center-p-event-9-after-dark",
    );
    const centerTotal = bundle.artifact.combinedRequiredEntriesByDate.find(
      (row) => row.date === "2026-07-17",
    );

    expect(event?.prizeContributionMinorUnits).toBe("2000000");
    expect(event?.organizerFeeMinorUnits).toBe("300000");
    expect(event?.gtd).toEqual({
      type: "monetary",
      minorUnits: "30000000",
      currency: "VND",
      scale: 0,
    });
    expect(metric?.requiredEntries).toBe("15");
    expect(centerTotal?.totalRequiredEntries).toBe("1119");
    expect(bundle.artifact.collisionReports.every(
      (row) => row.combinedRequiredEntries === "2271",
    )).toBe(true);
    expect(correction.downstreamMetricDeltas).toEqual([
      {
        metric: "event_required_entries",
        previousValue: "10",
        correctedValue: "15",
        delta: "5",
      },
      {
        metric: "series_date_required_entries",
        previousValue: "1114",
        correctedValue: "1119",
        delta: "5",
      },
      {
        metric: "within_14_day_collision_required_entries",
        previousValue: "2266",
        correctedValue: "2271",
        delta: "5",
      },
    ]);
  });

  it("rejects the superseded 3,000,000 value in the correction audit fixture", async () => {
    const events = structuredClone(VIETNAM_SCHEDULE_SUPPLY_V1_EVENTS) as ScheduleSeedEvent[];
    const index = events.findIndex((event) => event.eventKey === "center-p-after-dark");
    events[index] = { ...events[index], prizeContributionMinorUnits: "3000000" };

    await expect(createCorrection(events)).rejects.toMatchObject({
      name: SeriesMarketValidationError.name,
      code: "D1A_CORRECTION_SEED_MISMATCH",
    });
  });

  it("records a resolved second-pass audit for all 46 source rows", async () => {
    const { correction } = await createCorrection();

    expect(correction.rowAudits).toHaveLength(46);
    expect(new Set(correction.rowAudits.map((row) => row.eventKey)).size).toBe(46);
    expect(correction.rowAudits.every(
      (row) => row.status === "manual_verified_against_preserved_poster",
    )).toBe(true);
    expect(correction.rowAudits.every((row) => row.unresolvedFields.length === 0)).toBe(true);
    expect(correction.rowAudits.every(
      (row) => row.auditedFields.length === SCHEDULE_FIELD_ORDER.length,
    )).toBe(true);
  });

  it("links immutable superseded identities to distinct corrected identities", async () => {
    const { bundle, receipt, correction } = await createCorrection();

    expect(correction.superseded).toEqual(SUPERSEDED);
    expect(correction.corrected).toEqual({
      releaseId: bundle.release.releaseId,
      artifactId: bundle.artifact.artifactId,
      artifactFileSha256: receipt.artifactFileSha256,
      receiptId: receipt.receiptId,
    });
    expect(correction.corrected.releaseId).not.toBe(correction.superseded.releaseId);
    expect(correction.corrected.artifactId).not.toBe(correction.superseded.artifactId);
    expect(correction.corrected.artifactFileSha256).not.toBe(
      correction.superseded.artifactFileSha256,
    );
    expect(correction.corrected.receiptId).not.toBe(correction.superseded.receiptId);
    expect(correction.affectedClaims[0].correctedClaimId).not.toBe(
      correction.affectedClaims[0].supersededClaimId,
    );
    expect(correction.preservedSourceImageSha256).toBe(
      "ae86830b97335debcf88e480bc0cf20572426af76ae8456aa2108e88da602cca",
    );
    expect(correction.status).toBe("superseded_by_corrected_release");
  });

  it("commits the exact deterministic correction record", async () => {
    const { correction } = await createCorrection();
    const committed = JSON.parse(readFileSync(CORRECTION_PATH, "utf8"));

    expect(canonicalize(committed)).toBe(canonicalize(correction));
    expect(Object.isFrozen(correction)).toBe(true);
    expect(Object.isFrozen(correction.rowAudits)).toBe(true);
  });
});
