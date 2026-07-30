import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../series-intelligence/provenanceHash";
import { SeriesMarketValidationError } from "./normalization";
import {
  createOutcomeIntakeRecord,
  createOutcomeReadinessReport,
  createScheduleOutcomeLink,
  createVietnamEventOutcome,
  createVietnamOutcomeCorrection,
  createVietnamOutcomeEvidenceBundle,
  createVietnamOutcomeEvidenceClaim,
  createVietnamOutcomeEvidenceSource,
  createVietnamOutcomeReceipt,
  createVietnamScheduleLinkageContext,
  deriveOutcomeOverlaySurplus,
  isAutomaticAggregateResearchEligible,
  validateOutcomeCorrectionGraph,
  type OutcomeClaimState,
  type OutcomeClaimValue,
  type OutcomeFieldKey,
  type OutcomeValueScope,
  type ScheduleCompetitionReference,
  type VietnamEventOutcome,
  type VietnamOutcomeCorrection,
  type VietnamOutcomeEvidenceClaim,
  type VietnamOutcomeEvidenceSource,
  type VietnamScheduleLinkageContextInput,
} from "./vietnamOutcomeEvidence";
import {
  VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256,
  VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID,
  VIETNAM_SUPPLY_CURRENT_CORRECTION_ID,
  VIETNAM_SUPPLY_CURRENT_RECEIPT_ID,
  VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
  VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
} from "./vietnamSupplyReadModel";

export const SHA_A = "a".repeat(64);
export const SHA_B = "b".repeat(64);
export const EVENT_KEY = "grand-loyal-high-roller-warm-up-outcome";
export const COMPETITION_KEY = "grand-loyal-event-2-high-roller-warm-up";
export const SOURCE_CUTOFF = "2026-08-15T00:00:00.000Z";
export const EVENT_ID =
  "series-market:v1:vietnam-schedule-supply:v1:event:c6912361e0f876ce894036ecbbe08f928c1d5b8034da074d11470271f9aa8d40";

interface CurrentD1AScheduleArtifact {
  readonly events: readonly {
    readonly eventId: string;
    readonly eventKey: string;
    readonly competitionKey: string;
    readonly organizer: string;
    readonly seriesName: string;
    readonly eventName: string;
    readonly scheduleDate: string;
    readonly dayFlightIdentity: string | null;
  }[];
}

const CURRENT_D1A_ARTIFACT = JSON.parse(readFileSync(
  resolve(
    process.cwd(),
    "src/lib/series-market/datasets/vietnam/schedule-supply/v1/research/schedule-supply-v1.json",
  ),
  "utf8",
)) as CurrentD1AScheduleArtifact;

const CURRENT_D1A_COMPETITIONS: readonly ScheduleCompetitionReference[] = Object.freeze(
  CURRENT_D1A_ARTIFACT.events.map((event) => ({
    scheduleEventId: event.eventId,
    scheduleEventKey: event.eventKey,
    competitionKey: event.competitionKey,
    organizer: event.organizer,
    seriesName: event.seriesName,
    eventName: event.eventName,
    eventDate: event.scheduleDate,
    flightIdentity: event.dayFlightIdentity,
  })),
);

const SCOPED_FIELDS = new Set<OutcomeFieldKey>([
  "entries",
  "unique_players",
  "total_bullets",
  "reentry_count",
  "published_gtd",
  "actual_prize_pool",
  "prize_contribution_per_entry",
  "organizer_fee",
  "paid_places",
  "min_cash",
  "first_prize",
  "satellite_seats_awarded",
  "satellite_seats_redeemed",
  "satellite_seats_converted",
]);

export function eventScope(identity = EVENT_KEY): OutcomeValueScope {
  return { basis: "event_total", scopeIdentity: identity };
}

export async function source(
  overrides: Partial<Parameters<typeof createVietnamOutcomeEvidenceSource>[0]> = {},
): Promise<VietnamOutcomeEvidenceSource> {
  return createVietnamOutcomeEvidenceSource({
    sourceKey: "grand-loyal-event-2-final-result",
    sourceCategory: "official_result_page",
    sourceIdentity: {
      kind: "repository_file",
      path: "docs/series/evidence/vietnam/outcomes/reviewed/grand-loyal-event-2-final.html",
      sha256: SHA_A,
      byteLength: "4096",
      mediaType: "text/html",
    },
    organizer: "Grand Loyal Poker Club",
    seriesName: "Grand Loyal Poker Championship V",
    eventName: "High Roller Warm Up Massive GTD",
    publication: { kind: "exact", value: "2026-08-10T10:00:00+07:00" },
    capturedAt: "2026-08-10T10:05:00+07:00",
    expectedCompetitionKey: COMPETITION_KEY,
    reviewerStatus: "reviewed",
    evidenceQuality: "official_result_unverified",
    limitationNotes: ["Public result preserved for research review."],
    ...overrides,
  });
}

function extractionStatus(state: OutcomeClaimState) {
  if (state === "missing") return "missing" as const;
  if (state === "uncertain") return "uncertain" as const;
  if (state === "conflicting") return "conflicting" as const;
  if (state === "rejected") return "rejected" as const;
  return "verified" as const;
}

export async function claim(
  field: OutcomeFieldKey,
  value: OutcomeClaimValue | null,
  state: OutcomeClaimState = "present",
  options: {
    readonly evidenceSource?: VietnamOutcomeEvidenceSource;
    readonly scope?: OutcomeValueScope | null;
    readonly outcomeEventKey?: string;
    readonly region?: string;
  } = {},
): Promise<VietnamOutcomeEvidenceClaim> {
  const evidenceSource = options.evidenceSource ?? await source();
  const outcomeEventKey = options.outcomeEventKey ?? EVENT_KEY;
  return createVietnamOutcomeEvidenceClaim({
    outcomeEventKey,
    source: evidenceSource,
    field,
    state,
    value,
    scope: options.scope === undefined
      ? SCOPED_FIELDS.has(field) ? eventScope(outcomeEventKey) : null
      : options.scope,
    visualOrTextRegion: options.region ?? `result-page:${field}`,
    extractionMethod: "manual_text",
    extractionStatus: extractionStatus(state),
  });
}

function linkageContextInput(
  scheduleCompetitions: readonly ScheduleCompetitionReference[] = CURRENT_D1A_COMPETITIONS,
): VietnamScheduleLinkageContextInput {
  return {
    scheduleReleaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
    scheduleArtifactId: VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID,
    scheduleReceiptId: VIETNAM_SUPPLY_CURRENT_RECEIPT_ID,
    scheduleArtifactFileSha256: VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256,
    scheduleSourceCutoff: "2026-07-28T14:05:00.000Z",
    correctionLineage: [{
      correctionId: VIETNAM_SUPPLY_CURRENT_CORRECTION_ID,
      supersededReleaseId: VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
      correctedReleaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
    }],
    scheduleCompetitions,
  };
}

export async function linkageContext() {
  return createVietnamScheduleLinkageContext(linkageContextInput());
}

export async function outcomeFrom(
  claims: readonly VietnamOutcomeEvidenceClaim[],
  corrections: readonly VietnamOutcomeCorrection[] = [],
  overrides: Partial<Parameters<typeof createVietnamEventOutcome>[0]> = {},
): Promise<VietnamEventOutcome> {
  return createVietnamEventOutcome({
    outcomeEventKey: EVENT_KEY,
    organizer: "Grand Loyal Poker Club",
    seriesName: "Grand Loyal Poker Championship V",
    eventName: "High Roller Warm Up Massive GTD",
    eventDate: "2026-07-29",
    flightIdentity: null,
    currency: "VND",
    claimIds: claims.map((item) => item.claimId),
    correctionIds: corrections.map((item) => item.correctionId),
    ...overrides,
  }, claims, corrections);
}

export async function exactLink(outcome: VietnamEventOutcome, sourceCutoff = SOURCE_CUTOFF) {
  return createScheduleOutcomeLink({
    outcome,
    linkageContext: await linkageContext(),
    sourceCutoff,
    expectedCompetitionKey: COMPETITION_KEY,
    sourceDeclaredCompetitionKey: null,
  });
}

export async function finalGraph(options: {
  readonly includeReentry?: boolean;
  readonly completion?: "result_final" | "result_partial";
  readonly eventDate?: string;
} = {}) {
  const evidenceSource = await source();
  const claims = await Promise.all([
    claim("entries", { type: "integer", value: "59" }, "present", { evidenceSource }),
    claim("unique_players", { type: "integer", value: "50" }, "present", { evidenceSource }),
    claim("total_bullets", { type: "integer", value: "59" }, "present", { evidenceSource }),
    ...(options.includeReentry === false
      ? []
      : [claim("reentry_count", { type: "integer", value: "9" }, "present", { evidenceSource })]),
    claim("actual_prize_pool", {
      type: "money",
      minorUnits: "1940000000",
      currency: "VND",
      scale: 0,
    }, "present", { evidenceSource }),
    claim("published_gtd", {
      type: "money",
      minorUnits: "2000000000",
      currency: "VND",
      scale: 0,
    }, "present", { evidenceSource }),
    claim("completion_status", {
      type: "text",
      value: options.completion ?? "result_final",
    }, "present", { evidenceSource }),
  ]);
  const outcome = await outcomeFrom(claims, [], { eventDate: options.eventDate ?? "2026-07-29" });
  const link = await exactLink(outcome);
  return { evidenceSource, claims, outcome, link, context: await linkageContext() };
}

export async function bundleFrom(graph?: Awaited<ReturnType<typeof finalGraph>>) {
  const resolvedGraph = graph ?? await finalGraph();
  return createVietnamOutcomeEvidenceBundle({
    sourceCutoff: SOURCE_CUTOFF,
    linkageContext: resolvedGraph.context,
    sources: [resolvedGraph.evidenceSource],
    claims: resolvedGraph.claims,
    corrections: [],
    outcomes: [resolvedGraph.outcome],
    links: [resolvedGraph.link],
  });
}

describe("Vietnam Outcome Evidence D1B v2", () => {
  it("is deterministic under semantic ordering and deeply immutable", async () => {
    const graph = await finalGraph();
    const first = await bundleFrom(graph);
    const second = await createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: [...graph.claims].reverse(),
      corrections: [],
      outcomes: [graph.outcome],
      links: [graph.link],
    });
    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.artifact.claims)).toBe(true);
    expect(Object.isFrozen(first.artifact.linkageContext.scheduleCompetitions)).toBe(true);
    expect(first.release.contractVersion).toBe("v2");
    expect(first.release.releaseKey).toBe("vietnam-outcome-evidence-v1");
  });

  it("binds linkage to the complete corrected D1A competition index", async () => {
    const changedCompetition = CURRENT_D1A_COMPETITIONS.map((competition, index) =>
      index === 0
        ? { ...competition, organizer: `${competition.organizer} altered` }
        : competition
    );

    await expect(createVietnamScheduleLinkageContext(
      linkageContextInput(CURRENT_D1A_COMPETITIONS.slice(1)),
    )).rejects.toMatchObject({ code: "OUTCOME_D1A_COMPETITION_INDEX_MISMATCH" });
    await expect(createVietnamScheduleLinkageContext(
      linkageContextInput(changedCompetition),
    )).rejects.toMatchObject({ code: "OUTCOME_D1A_COMPETITION_INDEX_MISMATCH" });
    await expect(createVietnamScheduleLinkageContext({
      ...linkageContextInput(),
      scheduleSourceCutoff: "2026-07-28T14:05:01.000Z",
    })).rejects.toMatchObject({ code: "OUTCOME_D1A_SOURCE_CUTOFF_MISMATCH" });
    await expect(createVietnamScheduleLinkageContext({
      ...linkageContextInput(),
      correctionLineage: [
        ...linkageContextInput().correctionLineage,
        {
          correctionId: "series-market:v1:vietnam-schedule-supply:v1:correction:forged-extra",
          supersededReleaseId: VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
          correctedReleaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
        },
      ],
    })).rejects.toMatchObject({ code: "OUTCOME_D1A_CORRECTION_LINEAGE_INVALID" });
  });

  it("binds source bytes, byte length, media type, and cutoff into identity", async () => {
    const baseline = await source();
    const changedBytes = await source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/reviewed/grand-loyal-event-2-final.html",
        sha256: SHA_B,
        byteLength: "4096",
        mediaType: "text/html",
      },
    });
    const changedLength = await source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/reviewed/grand-loyal-event-2-final.html",
        sha256: SHA_A,
        byteLength: "4097",
        mediaType: "text/html",
      },
    });
    expect(changedBytes.sourceId).not.toBe(baseline.sourceId);
    expect(changedLength.sourceId).not.toBe(baseline.sourceId);
    const graph = await finalGraph();
    const first = await bundleFrom(graph);
    const later = await createVietnamOutcomeEvidenceBundle({
      sourceCutoff: "2026-08-16T00:00:00Z",
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: graph.claims,
      corrections: [],
      outcomes: [graph.outcome],
      links: [await exactLink(graph.outcome, "2026-08-16T00:00:00Z")],
    });
    expect(later.release.releaseId).not.toBe(first.release.releaseId);
  });

  it("preserves exact and not-reported publication semantics", async () => {
    const exact = await source();
    const notReported = await source({
      sourceKey: "grand-loyal-event-2-publication-not-reported",
      publication: { kind: "not_reported" },
    });
    expect(exact.publication).toEqual({ kind: "exact", value: "2026-08-10T03:00:00.000Z" });
    expect(notReported.publication).toEqual({ kind: "not_reported" });
    await expect(source({
      publication: { kind: "exact", value: "2026-08-11T00:00:00Z" },
      capturedAt: "2026-08-10T00:00:00Z",
    })).rejects.toMatchObject({ code: "OUTCOME_PUBLICATION_AFTER_CAPTURE" });
  });

  it("keeps claim state separate from derived supersession", async () => {
    const oldClaim = await claim("entries", { type: "integer", value: "58" }, "present", {
      region: "result-page:entries-old",
    });
    const newerSource = await source({
      sourceKey: "grand-loyal-event-2-final-result-corrected",
      capturedAt: "2026-08-11T10:05:00+07:00",
      publication: { kind: "exact", value: "2026-08-11T10:00:00+07:00" },
    });
    const newClaim = await claim("entries", { type: "integer", value: "59" }, "present", {
      evidenceSource: newerSource,
      region: "result-page:entries-corrected",
    });
    const correction = await createVietnamOutcomeCorrection({
      correctionKey: "grand-loyal-event-2-entries-correction",
      correctedAt: "2026-08-11T04:00:00Z",
      supersededClaimId: oldClaim.claimId,
      supersedingClaimId: newClaim.claimId,
      reason: "Official result corrected the entry count.",
    }, [oldClaim, newClaim]);
    const outcome = await outcomeFrom([oldClaim, newClaim], [correction]);
    const entries = outcome.fields.find((field) => field.field === "entries");
    expect(oldClaim.state).toBe("present");
    expect(entries?.state).toBe("present");
    expect(entries?.value).toEqual({ type: "integer", value: "59" });
    expect(entries?.supersededClaimIds).toEqual([oldClaim.claimId]);
  });

  it("records corrections in inclusion, release, and artifact identities", async () => {
    const evidenceSource = await source();
    const olderSource = await source({
      sourceKey: "grand-loyal-event-2-result-earlier",
      capturedAt: "2026-08-09T10:05:00+07:00",
      publication: { kind: "exact", value: "2026-08-09T10:00:00+07:00" },
    });
    const oldEntries = await claim("entries", { type: "integer", value: "58" }, "present", {
      evidenceSource: olderSource,
      region: "result-page:entries-old",
    });
    const newEntries = await claim("entries", { type: "integer", value: "59" }, "present", {
      evidenceSource,
      region: "result-page:entries-current",
    });
    const completion = await claim("completion_status", {
      type: "text",
      value: "result_final",
    }, "present", { evidenceSource });
    const correction = await createVietnamOutcomeCorrection({
      correctionKey: "grand-loyal-event-2-entries-correction",
      correctedAt: "2026-08-10T04:00:00Z",
      supersededClaimId: oldEntries.claimId,
      supersedingClaimId: newEntries.claimId,
      reason: "Official final result correction.",
    }, [oldEntries, newEntries, completion]);
    const claims = [oldEntries, newEntries, completion];
    const outcome = await outcomeFrom(claims, [correction]);
    const context = await linkageContext();
    const bundle = await createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: context,
      sources: [olderSource, evidenceSource],
      claims,
      corrections: [correction],
      outcomes: [outcome],
      links: [await exactLink(outcome)],
    });
    expect(bundle.inclusionManifest.correctionIds).toEqual([correction.correctionId]);
    expect(bundle.release.correctionIds).toEqual([correction.correctionId]);
    expect(bundle.artifact.corrections).toEqual([correction]);
  });

  it("requires current corrected D1A identity plus key and full metadata for exact linkage", async () => {
    const graph = await finalGraph();
    expect(graph.link.state).toBe("exact");
    expect(graph.link.scheduleEventId).toBe(EVENT_ID);
    expect(isAutomaticAggregateResearchEligible(graph.link)).toBe(true);

    const mismatched = await outcomeFrom(graph.claims, [], { eventName: "Different Event" });
    const link = await createScheduleOutcomeLink({
      outcome: mismatched,
      linkageContext: graph.context,
      sourceCutoff: SOURCE_CUTOFF,
      expectedCompetitionKey: COMPETITION_KEY,
      sourceDeclaredCompetitionKey: null,
    });
    expect(link.state).toBe("conflicting");
    expect(link.reasonCodes).toContain("current_d1a_same_key_metadata_mismatch");
    expect(isAutomaticAggregateResearchEligible(link)).toBe(false);

    await expect(createScheduleOutcomeLink({
      outcome: graph.outcome,
      linkageContext: {
        ...graph.context,
        scheduleCompetitions: graph.context.scheduleCompetitions.slice(1),
      },
      sourceCutoff: SOURCE_CUTOFF,
      expectedCompetitionKey: COMPETITION_KEY,
      sourceDeclaredCompetitionKey: null,
    })).rejects.toMatchObject({ code: "OUTCOME_D1A_COMPETITION_INDEX_MISMATCH" });

    await expect(createScheduleOutcomeLink({
      outcome: graph.outcome,
      linkageContext: graph.context,
      sourceCutoff: "2026-07-28T14:04:59.000Z",
      expectedCompetitionKey: COMPETITION_KEY,
      sourceDeclaredCompetitionKey: null,
    })).rejects.toMatchObject({ code: "OUTCOME_LINK_BEFORE_D1A_CUTOFF" });
  });

  it("keeps fuzzy structural matches as reviewed candidates only", async () => {
    const graph = await finalGraph();
    const candidate = await createScheduleOutcomeLink({
      outcome: graph.outcome,
      linkageContext: graph.context,
      sourceCutoff: SOURCE_CUTOFF,
      expectedCompetitionKey: null,
      sourceDeclaredCompetitionKey: null,
    });
    expect(candidate.state).toBe("candidate");
    expect(candidate.reasonCodes).toContain("structural_candidate_requires_review");
    expect(isAutomaticAggregateResearchEligible(candidate)).toBe(false);
  });

  it("requires explicit event-scope reentry_count for reentry readiness", async () => {
    const graph = await finalGraph({ includeReentry: false });
    const readiness = await createOutcomeReadinessReport(graph.outcome, graph.link);
    expect(readiness.states).toContain("reentry_analysis_blocked");
    expect(readiness.reasonCodes).toContain("explicit_event_total_reentry_count_is_required");
  });

  it("derives overlay only from final, linked, compatible event-total money", async () => {
    const final = await finalGraph();
    expect(deriveOutcomeOverlaySurplus(final.outcome, final.link)).toMatchObject({
      overlay: { minorUnits: "60000000", currency: "VND", scale: 0 },
      surplus: { minorUnits: "0", currency: "VND", scale: 0 },
    });
    const partial = await finalGraph({ completion: "result_partial" });
    expect(deriveOutcomeOverlaySurplus(partial.outcome, partial.link)).toEqual({
      overlay: null,
      surplus: null,
    });
    const future = await finalGraph({ eventDate: "2026-08-16" });
    expect(deriveOutcomeOverlaySurplus(future.outcome, future.link)).toEqual({
      overlay: null,
      surplus: null,
    });
    const currencyMismatchOutcome = await outcomeFrom(final.claims, [], { currency: "USD" });
    const currencyMismatchLink = await exactLink(currencyMismatchOutcome);
    expect(deriveOutcomeOverlaySurplus(currencyMismatchOutcome, currencyMismatchLink)).toEqual({
      overlay: null,
      surplus: null,
    });
  });

  it("uses the Vietnam local date when deciding whether an outcome is future", async () => {
    const graph = await finalGraph();
    const localNextDayLink = await exactLink(graph.outcome, "2026-07-28T18:00:00.000Z");
    expect(deriveOutcomeOverlaySurplus(graph.outcome, localNextDayLink)).toMatchObject({
      overlay: { minorUnits: "60000000" },
      surplus: { minorUnits: "0" },
    });
  });

  it("rejects private IPv4 addresses embedded in IPv6 source URLs", async () => {
    await expect(source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://[::ffff:10.1.2.3]/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    })).rejects.toMatchObject({ code: "INVALID_OUTCOME_PUBLIC_URL" });
  });

  it("enforces same-scope poker count invariants", async () => {
    const evidenceSource = await source();
    const entries = await claim("entries", { type: "integer", value: "10" }, "present", {
      evidenceSource,
    });
    const unique = await claim("unique_players", { type: "integer", value: "11" }, "present", {
      evidenceSource,
    });
    await expect(outcomeFrom([entries, unique]))
      .rejects.toMatchObject({ code: "OUTCOME_UNIQUE_EXCEEDS_ENTRIES" });

    const flightUnique = await claim("unique_players", { type: "integer", value: "11" }, "present", {
      evidenceSource,
      scope: { basis: "flight_only", scopeIdentity: "day-1a" },
    });
    await expect(outcomeFrom([entries, flightUnique])).resolves.toBeDefined();
  });

  it("rejects missing-only, partial-only, and rejected evidence releases", async () => {
    const evidenceSource = await source();
    const missing = await claim("entries", null, "missing", { evidenceSource });
    const missingOutcome = await outcomeFrom([missing]);
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: await linkageContext(),
      sources: [evidenceSource],
      claims: [missing],
      corrections: [],
      outcomes: [missingOutcome],
      links: [await exactLink(missingOutcome)],
    })).rejects.toMatchObject({ code: "OUTCOME_RELEASE_MISSING_ONLY" });

    const partial = await finalGraph({ completion: "result_partial" });
    await expect(bundleFrom(partial))
      .rejects.toMatchObject({ code: "OUTCOME_RELEASE_FINAL_LINKED_OUTCOME_REQUIRED" });

    const rejectedSource = await source({
      sourceKey: "grand-loyal-event-2-rejected",
      sourceCategory: "rejected",
      reviewerStatus: "rejected",
      evidenceQuality: "rejected",
    });
    const rejected = await claim("entries", null, "rejected", { evidenceSource: rejectedSource });
    expect(rejected.state).toBe("rejected");
  });

  it("recomputes every nested identity at the bundle boundary", async () => {
    const graph = await finalGraph();
    const forgedSource = { ...graph.evidenceSource, organizer: "Forged Organizer" };
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [forgedSource],
      claims: graph.claims,
      corrections: [],
      outcomes: [graph.outcome],
      links: [graph.link],
    })).rejects.toMatchObject({ code: "FORGED_OUTCOME_SOURCE" });

    const forgedClaim = { ...graph.claims[0], visualOrTextRegion: "forged-region" };
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: [forgedClaim, ...graph.claims.slice(1)],
      corrections: [],
      outcomes: [graph.outcome],
      links: [graph.link],
    })).rejects.toMatchObject({ code: "FORGED_OUTCOME_CLAIM" });

    const forgedOutcome = { ...graph.outcome, eventName: "Forged Event" };
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: graph.claims,
      corrections: [],
      outcomes: [forgedOutcome],
      links: [graph.link],
    })).rejects.toMatchObject({ code: "FORGED_EVENT_OUTCOME" });

    const forgedLink = { ...graph.link, state: "explicit_source_link" as const };
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: graph.claims,
      corrections: [],
      outcomes: [graph.outcome],
      links: [forgedLink],
    })).rejects.toMatchObject({ code: "FORGED_SCHEDULE_OUTCOME_LINK" });

    const sourceExpectationBypass = await createScheduleOutcomeLink({
      outcome: graph.outcome,
      linkageContext: graph.context,
      sourceCutoff: SOURCE_CUTOFF,
      expectedCompetitionKey: null,
      sourceDeclaredCompetitionKey: COMPETITION_KEY,
    });
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: graph.claims,
      corrections: [],
      outcomes: [graph.outcome],
      links: [sourceExpectationBypass],
    })).rejects.toMatchObject({ code: "OUTCOME_LINK_EXPECTED_KEY_PROVENANCE_MISMATCH" });
  });

  it("requires every claim and link to have exactly one owner", async () => {
    const graph = await finalGraph();
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: graph.claims,
      corrections: [],
      outcomes: [graph.outcome],
      links: [graph.link, graph.link],
    })).rejects.toMatchObject({ code: "DUPLICATE_OUTCOME_LINK" });

    const orphan = await claim("paid_places", { type: "integer", value: "7" }, "present", {
      evidenceSource: graph.evidenceSource,
    });
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: SOURCE_CUTOFF,
      linkageContext: graph.context,
      sources: [graph.evidenceSource],
      claims: [...graph.claims, orphan],
      corrections: [],
      outcomes: [graph.outcome],
      links: [graph.link],
    })).rejects.toMatchObject({ code: "OUTCOME_CLAIM_OWNERSHIP_INVALID" });
  });

  it("detects correction chronology, divergence, convergence, and real cycles", async () => {
    const evidenceSource = await source();
    const first = await claim("entries", { type: "integer", value: "57" }, "present", {
      evidenceSource,
      region: "entries:first",
    });
    const secondSource = await source({
      sourceKey: "grand-loyal-event-2-result-second",
      publication: { kind: "exact", value: "2026-08-11T03:00:00Z" },
      capturedAt: "2026-08-11T03:05:00Z",
    });
    const second = await claim("entries", { type: "integer", value: "58" }, "present", {
      evidenceSource: secondSource,
      region: "entries:second",
    });
    const thirdSource = await source({
      sourceKey: "grand-loyal-event-2-result-third",
      publication: { kind: "exact", value: "2026-08-12T03:00:00Z" },
      capturedAt: "2026-08-12T03:05:00Z",
    });
    const third = await claim("entries", { type: "integer", value: "59" }, "present", {
      evidenceSource: thirdSource,
      region: "entries:third",
    });
    const firstToSecond = await createVietnamOutcomeCorrection({
      correctionKey: "entries-first-to-second",
      correctedAt: "2026-08-11T04:00:00Z",
      supersededClaimId: first.claimId,
      supersedingClaimId: second.claimId,
      reason: "Second official entry count.",
    }, [first, second, third]);
    const secondToThird = await createVietnamOutcomeCorrection({
      correctionKey: "entries-second-to-third",
      correctedAt: "2026-08-12T04:00:00Z",
      supersededClaimId: second.claimId,
      supersedingClaimId: third.claimId,
      reason: "Final official entry count.",
    }, [first, second, third]);
    expect(() => validateOutcomeCorrectionGraph([firstToSecond, secondToThird], [first, second, third]))
      .not.toThrow();
    expect(() => validateOutcomeCorrectionGraph([
      firstToSecond,
      { ...secondToThird, supersededClaimId: first.claimId },
    ] as readonly VietnamOutcomeCorrection[])).toThrowError(
      expect.objectContaining({ code: "OUTCOME_CORRECTION_DIVERGENCE" }),
    );
    expect(() => validateOutcomeCorrectionGraph([
      { ...firstToSecond, supersedingClaimId: third.claimId },
      secondToThird,
    ] as readonly VietnamOutcomeCorrection[])).toThrowError(
      expect.objectContaining({ code: "OUTCOME_CORRECTION_CONVERGENCE" }),
    );
    expect(() => validateOutcomeCorrectionGraph([
      firstToSecond,
      secondToThird,
      {
        ...firstToSecond,
        correctionId: `${firstToSecond.correctionId}-cycle`,
        supersededClaimId: third.claimId,
        supersedingClaimId: first.claimId,
      },
    ] as readonly VietnamOutcomeCorrection[])).toThrowError(
      expect.objectContaining({ code: "OUTCOME_CORRECTION_CYCLE" }),
    );
  });

  it("keeps fictional intake records in a reserved namespace", async () => {
    const intake = await createOutcomeIntakeRecord({
      intakeKey: "fixture.fictional-intake",
      fixtureOnly: true,
      source: {
        sourceKey: "fixture.fictional-source",
        sourceCategory: "public_outcome_post",
        sourceIdentity: {
          kind: "public_url",
          url: "https://example.test/result",
          sha256: null,
          byteLength: null,
          mediaType: null,
        },
        organizer: "Fictional Organizer",
        seriesName: "Fictional Series",
        eventName: "Fictional Event",
        publication: { kind: "not_reported" },
        capturedAt: "2026-08-01T00:00:00Z",
        expectedCompetitionKey: null,
        reviewerStatus: "intake",
        evidenceQuality: "secondary_public_announcement_unverified",
        limitationNotes: ["Fixture only."],
      },
      outcome: {
        outcomeEventKey: "fixture.fictional-event",
        organizer: "Fictional Organizer",
        seriesName: "Fictional Series",
        eventName: "Fictional Event",
        eventDate: "2026-08-01",
        flightIdentity: null,
        currency: "VND",
      },
      claims: [{
        field: "entries",
        state: "uncertain",
        value: { type: "integer", value: "59" },
        scope: { basis: "partial_result", scopeIdentity: "fixture.partial-count" },
        visualOrTextRegion: "fixture result summary",
        extractionMethod: "manual_text",
        extractionStatus: "uncertain",
      }],
      linkage: { expectedCompetitionKey: null, sourceDeclaredCompetitionKey: null },
      reviewerStatus: "intake",
      limitationNotes: ["Fixture only."],
    });
    expect(intake.fixtureOnly).toBe(true);
    expect(intake.intakeKey).toBe("fixture.fictional-intake");
  });

  it("creates exact-byte receipts only from a valid non-empty bundle", async () => {
    const bundle = await bundleFrom();
    const receipt = await createVietnamOutcomeReceipt({
      bundle,
      artifactPath:
        "src/lib/series-market/datasets/vietnam/outcomes/v1/research/outcomes-v1.json",
      artifactFileSha256: SHA_A,
    });
    expect(receipt.releaseId).toBe(bundle.release.releaseId);
    expect(receipt.artifactId).toBe(bundle.artifact.artifactId);
    expect(receipt.artifactFileSha256).toBe(SHA_A);
  });

  it("uses the shared validation error type for fail-closed paths", async () => {
    await expect(source({
      sourceIdentity: {
        kind: "public_url",
        url: "http://example.test/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    })).rejects.toBeInstanceOf(SeriesMarketValidationError);
  });
});

type AdversarialCase = {
  readonly name: string;
  readonly code: string;
  readonly run: () => Promise<unknown>;
};

const D1B_ADVERSARIAL_CASES: readonly AdversarialCase[] = [
  {
    name: "rejects an unknown source category",
    code: "INVALID_OUTCOME_ENUM",
    run: () => source({ sourceCategory: "unknown" as never }),
  },
  {
    name: "rejects an unknown reviewer status",
    code: "INVALID_OUTCOME_ENUM",
    run: () => source({ reviewerStatus: "approved" as never }),
  },
  {
    name: "rejects an unknown evidence quality",
    code: "INVALID_OUTCOME_ENUM",
    run: () => source({ evidenceQuality: "trusted" as never }),
  },
  {
    name: "rejects rejected category without rejected review",
    code: "OUTCOME_REJECTED_SOURCE_STATE",
    run: () => source({ sourceCategory: "rejected" }),
  },
  {
    name: "rejects rejected quality without rejected review",
    code: "OUTCOME_REJECTED_EVIDENCE_STATE",
    run: () => source({ evidenceQuality: "rejected" }),
  },
  {
    name: "rejects repository evidence outside reviewed",
    code: "INVALID_OUTCOME_SOURCE_PATH",
    run: () => source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/inbox/result.html",
        sha256: SHA_A,
        byteLength: "1",
        mediaType: "text/html",
      },
    }),
  },
  {
    name: "rejects repository traversal",
    code: "INVALID_OUTCOME_SOURCE_PATH",
    run: () => source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/reviewed/../secret.html",
        sha256: SHA_A,
        byteLength: "1",
        mediaType: "text/html",
      },
    }),
  },
  {
    name: "rejects absolute repository paths",
    code: "INVALID_OUTCOME_SOURCE_PATH",
    run: () => source({
      sourceIdentity: {
        kind: "repository_file",
        path: "C:/docs/series/evidence/vietnam/outcomes/reviewed/result.html",
        sha256: SHA_A,
        byteLength: "1",
        mediaType: "text/html",
      },
    }),
  },
  {
    name: "rejects malformed source SHA",
    code: "INVALID_OUTCOME_SHA256",
    run: () => source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/reviewed/result.html",
        sha256: "bad",
        byteLength: "1",
        mediaType: "text/html",
      },
    }),
  },
  {
    name: "rejects zero source byte length",
    code: "INVALID_OUTCOME_BYTE_LENGTH",
    run: () => source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/reviewed/result.html",
        sha256: SHA_A,
        byteLength: "0",
        mediaType: "text/html",
      },
    }),
  },
  {
    name: "rejects unapproved media type",
    code: "INVALID_OUTCOME_MEDIA_TYPE",
    run: () => source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/reviewed/result.bin",
        sha256: SHA_A,
        byteLength: "1",
        mediaType: "application/octet-stream" as never,
      },
    }),
  },
  {
    name: "rejects non-HTTPS public URL",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "http://example.com/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects URL credentials",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://user:pass@example.com/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects URL fragments",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://example.com/result#fragment",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects encoded URL control characters",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://example.com/result%0aheader",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects localhost",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://localhost/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects IPv4 loopback",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://127.0.0.1/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects RFC1918 10/8",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://10.1.2.3/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects RFC1918 172.16/12",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://172.20.1.2/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects RFC1918 192.168/16",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://192.168.1.2/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects IPv6 loopback",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://[::1]/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects credential-like query parameters",
    code: "INVALID_OUTCOME_PUBLIC_URL",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://example.com/result?token=secret",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects partial public URL preservation metadata",
    code: "OUTCOME_SOURCE_PRESERVATION_INCOMPLETE",
    run: () => source({
      sourceIdentity: {
        kind: "public_url",
        url: "https://example.com/result",
        sha256: SHA_A,
        byteLength: null,
        mediaType: null,
      },
    }),
  },
  {
    name: "rejects publication after capture",
    code: "OUTCOME_PUBLICATION_AFTER_CAPTURE",
    run: () => source({
      publication: { kind: "exact", value: "2026-08-11T00:00:00Z" },
      capturedAt: "2026-08-10T00:00:00Z",
    }),
  },
  {
    name: "rejects unknown claim field through runtime cast",
    code: "INVALID_OUTCOME_ENUM",
    run: () => claim("player_name" as never, { type: "text", value: "Private" }),
  },
  {
    name: "rejects unknown extraction method",
    code: "INVALID_OUTCOME_ENUM",
    run: async () => createVietnamOutcomeEvidenceClaim({
      outcomeEventKey: EVENT_KEY,
      source: await source(),
      field: "entries",
      state: "present",
      value: { type: "integer", value: "1" },
      scope: eventScope(),
      visualOrTextRegion: "result",
      extractionMethod: "automatic" as never,
      extractionStatus: "verified",
    }),
  },
  {
    name: "rejects unknown extraction status",
    code: "INVALID_OUTCOME_ENUM",
    run: async () => createVietnamOutcomeEvidenceClaim({
      outcomeEventKey: EVENT_KEY,
      source: await source(),
      field: "entries",
      state: "present",
      value: { type: "integer", value: "1" },
      scope: eventScope(),
      visualOrTextRegion: "result",
      extractionMethod: "manual_text",
      extractionStatus: "accepted" as never,
    }),
  },
  {
    name: "rejects self-declared superseded state",
    code: "INVALID_OUTCOME_ENUM",
    run: () => claim("entries", { type: "integer", value: "1" }, "superseded" as never),
  },
  {
    name: "rejects negative counts",
    code: "NEGATIVE_OUTCOME_COUNT",
    run: () => claim("entries", { type: "integer", value: "-1" }),
  },
  {
    name: "rejects negative money",
    code: "NEGATIVE_OUTCOME_MONEY",
    run: () => claim("published_gtd", {
      type: "money",
      minorUnits: "-1",
      currency: "VND",
      scale: 0,
    }),
  },
  {
    name: "rejects wrong value type",
    code: "OUTCOME_VALUE_TYPE_MISMATCH",
    run: () => claim("published_gtd", { type: "integer", value: "1" }),
  },
  {
    name: "rejects count without explicit scope",
    code: "OUTCOME_SCOPE_REQUIRED",
    run: () => claim("entries", { type: "integer", value: "1" }, "present", { scope: null }),
  },
  {
    name: "rejects scope on metadata field",
    code: "OUTCOME_SCOPE_FORBIDDEN",
    run: () => claim("event_name", { type: "text", value: "Event" }, "present", {
      scope: eventScope(),
    }),
  },
  {
    name: "rejects mismatched event-total scope identity",
    code: "OUTCOME_EVENT_SCOPE_MISMATCH",
    run: () => claim("entries", { type: "integer", value: "1" }, "present", {
      scope: eventScope("different-event"),
    }),
  },
  {
    name: "rejects nonzero explicit_zero",
    code: "OUTCOME_EXPLICIT_ZERO_REQUIRED",
    run: () => claim("entries", { type: "integer", value: "1" }, "explicit_zero"),
  },
  {
    name: "rejects present claim without value",
    code: "OUTCOME_VALUE_REQUIRED",
    run: () => claim("entries", null, "present"),
  },
  {
    name: "rejects missing claim with value",
    code: "OUTCOME_VALUE_FORBIDDEN",
    run: () => claim("entries", { type: "integer", value: "1" }, "missing"),
  },
  {
    name: "rejects claim state and extraction status mismatch",
    code: "OUTCOME_CLAIM_EXTRACTION_STATUS_MISMATCH",
    run: async () => createVietnamOutcomeEvidenceClaim({
      outcomeEventKey: EVENT_KEY,
      source: await source(),
      field: "entries",
      state: "uncertain",
      value: { type: "integer", value: "1" },
      scope: eventScope(),
      visualOrTextRegion: "result",
      extractionMethod: "manual_text",
      extractionStatus: "verified",
    }),
  },
  {
    name: "rejects usable claim from rejected source",
    code: "REJECTED_OUTCOME_EVIDENCE",
    run: async () => claim("entries", { type: "integer", value: "1" }, "present", {
      evidenceSource: await source({
        sourceKey: "rejected-result",
        sourceCategory: "rejected",
        reviewerStatus: "rejected",
        evidenceQuality: "rejected",
      }),
    }),
  },
  {
    name: "rejects unique players above entries",
    code: "OUTCOME_UNIQUE_EXCEEDS_ENTRIES",
    run: async () => outcomeFrom(await Promise.all([
      claim("entries", { type: "integer", value: "10" }),
      claim("unique_players", { type: "integer", value: "11" }),
    ])),
  },
  {
    name: "rejects unique players above bullets",
    code: "OUTCOME_UNIQUE_EXCEEDS_BULLETS",
    run: async () => outcomeFrom(await Promise.all([
      claim("unique_players", { type: "integer", value: "11" }),
      claim("total_bullets", { type: "integer", value: "10" }),
    ])),
  },
  {
    name: "rejects reentries above bullets",
    code: "OUTCOME_REENTRIES_EXCEED_BULLETS",
    run: async () => outcomeFrom(await Promise.all([
      claim("reentry_count", { type: "integer", value: "11" }),
      claim("total_bullets", { type: "integer", value: "10" }),
    ])),
  },
  {
    name: "rejects paid places above entries",
    code: "OUTCOME_PAID_PLACES_EXCEED_ENTRIES",
    run: async () => outcomeFrom(await Promise.all([
      claim("paid_places", { type: "integer", value: "11" }),
      claim("entries", { type: "integer", value: "10" }),
    ])),
  },
  {
    name: "rejects redeemed seats above awarded",
    code: "OUTCOME_REDEEMED_EXCEEDS_AWARDED",
    run: async () => outcomeFrom(await Promise.all([
      claim("satellite_seats_redeemed", { type: "integer", value: "11" }),
      claim("satellite_seats_awarded", { type: "integer", value: "10" }),
    ])),
  },
  {
    name: "rejects converted seats above redeemed",
    code: "OUTCOME_CONVERTED_EXCEEDS_REDEEMED",
    run: async () => outcomeFrom(await Promise.all([
      claim("satellite_seats_converted", { type: "integer", value: "11" }),
      claim("satellite_seats_redeemed", { type: "integer", value: "10" }),
    ])),
  },
  {
    name: "rejects noncurrent D1A release identity",
    code: "OUTCOME_D1A_CURRENT_IDENTITY_MISMATCH",
    run: () => createVietnamScheduleLinkageContext({
      scheduleReleaseId: VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
      scheduleArtifactId: VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID,
      scheduleReceiptId: VIETNAM_SUPPLY_CURRENT_RECEIPT_ID,
      scheduleArtifactFileSha256: VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256,
      scheduleSourceCutoff: "2026-07-28T14:05:00Z",
      correctionLineage: [{
        correctionId: VIETNAM_SUPPLY_CURRENT_CORRECTION_ID,
        supersededReleaseId: VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
        correctedReleaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
      }],
      scheduleCompetitions: [{
        scheduleEventId: EVENT_ID,
        scheduleEventKey: "grand-loyal-high-roller-warm-up",
        competitionKey: COMPETITION_KEY,
        organizer: "Grand Loyal Poker Club",
        seriesName: "Grand Loyal Poker Championship V",
        eventName: "High Roller Warm Up Massive GTD",
        eventDate: "2026-07-29",
        flightIdentity: null,
      }],
    }),
  },
  {
    name: "rejects invalid D1A correction lineage",
    code: "OUTCOME_D1A_CORRECTION_LINEAGE_INVALID",
    run: () => createVietnamScheduleLinkageContext({
      scheduleReleaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
      scheduleArtifactId: VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID,
      scheduleReceiptId: VIETNAM_SUPPLY_CURRENT_RECEIPT_ID,
      scheduleArtifactFileSha256: VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256,
      scheduleSourceCutoff: "2026-07-28T14:05:00Z",
      correctionLineage: [{
        correctionId: "series-market:v1:vietnam-schedule-supply:v1:correction:forged",
        supersededReleaseId: VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
        correctedReleaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
      }],
      scheduleCompetitions: [{
        scheduleEventId: EVENT_ID,
        scheduleEventKey: "grand-loyal-high-roller-warm-up",
        competitionKey: COMPETITION_KEY,
        organizer: "Grand Loyal Poker Club",
        seriesName: "Grand Loyal Poker Championship V",
        eventName: "High Roller Warm Up Massive GTD",
        eventDate: "2026-07-29",
        flightIdentity: null,
      }],
    }),
  },
];

describe("Vietnam Outcome Evidence D1B v2 adversarial acceptance matrix", () => {
  it("contains the predeclared 47 table-driven cases", () => {
    expect(D1B_ADVERSARIAL_CASES).toHaveLength(47);
  });

  it.each(D1B_ADVERSARIAL_CASES)("$name", async ({ run, code }) => {
    await expect(run()).rejects.toMatchObject({ code });
  });
});
