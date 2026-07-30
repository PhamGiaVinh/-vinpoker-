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
  deriveOutcomeOverlaySurplus,
  isAutomaticAggregateResearchEligible,
  validateOutcomeCorrectionGraph,
  type OutcomeClaimValue,
  type OutcomeFieldKey,
  type OutcomeFieldState,
  type VietnamOutcomeEvidenceClaim,
} from "./vietnamOutcomeEvidence";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const EVENT_KEY = "fixture-main-event";
const COMPETITION_KEY = "fixture-main-event-day-1";

async function source(overrides: Partial<Parameters<typeof createVietnamOutcomeEvidenceSource>[0]> = {}) {
  return createVietnamOutcomeEvidenceSource({
    sourceId: "fixture-official-result",
    sourceCategory: "official_result_poster",
    sourceIdentity: {
      kind: "repository_file",
      path: "docs/series/evidence/vietnam/outcomes/reviewed/fixture-official-result.png",
      sha256: SHA_A,
    },
    organizer: "Fixture Poker Club",
    seriesName: "Fixture Championship",
    eventName: "Main Event",
    publicationAt: "2026-08-01T12:00:00+07:00",
    capturedAt: "2026-08-01T12:10:00+07:00",
    expectedCompetitionKey: COMPETITION_KEY,
    reviewerStatus: "reviewed",
    evidenceQuality: "owner_provided_public_image_unverified",
    limitationNotes: ["Fixture only; not research data."],
    ...overrides,
  });
}

async function claim(
  field: OutcomeFieldKey,
  value: OutcomeClaimValue | null,
  state: OutcomeFieldState = "present",
  sourceOverride?: Awaited<ReturnType<typeof source>>,
) {
  const evidenceSource = sourceOverride ?? await source();
  const status = state === "missing" ? "missing" : state === "uncertain" ? "uncertain" : state === "conflicting" ? "conflicting" : "verified";
  return createVietnamOutcomeEvidenceClaim({
    outcomeEventKey: EVENT_KEY,
    source: evidenceSource,
    field,
    state,
    value,
    visualOrTextRegion: `result-card:${field}`,
    extractionMethod: "manual_visual",
    extractionStatus: status,
    correctionOfClaimId: null,
  });
}

async function exactLink(outcome: Awaited<ReturnType<typeof createVietnamEventOutcome>>) {
  return createScheduleOutcomeLink({
    outcome,
    expectedCompetitionKey: COMPETITION_KEY,
    sourceDeclaredCompetitionKey: null,
    scheduleCompetitions: [{
      competitionKey: COMPETITION_KEY,
      organizer: "Fixture Poker Club",
      seriesName: "Fixture Championship",
      eventName: "Main Event",
      eventDate: "2026-08-01",
      flightIdentity: null,
    }],
  });
}

async function finalOutcome() {
  const claims = await Promise.all([
    claim("entries", { type: "integer", value: "100" }),
    claim("entries_basis", { type: "text", value: "event_total" }),
    claim("unique_players", { type: "integer", value: "80" }),
    claim("total_bullets", { type: "integer", value: "100" }),
    claim("actual_prize_pool", { type: "money", minorUnits: "900000000", currency: "VND", scale: 0 }),
    claim("published_gtd", { type: "money", minorUnits: "1000000000", currency: "VND", scale: 0 }),
    claim("completion_status", { type: "text", value: "result_final" }),
    claim("satellite_seats_awarded", { type: "integer", value: "10" }),
    claim("satellite_seats_redeemed", { type: "integer", value: "9" }),
    claim("satellite_seats_converted", { type: "integer", value: "9" }),
  ]);
  const outcome = await createVietnamEventOutcome({
    outcomeEventKey: EVENT_KEY,
    organizer: "Fixture Poker Club",
    seriesName: "Fixture Championship",
    eventName: "Main Event",
    eventDate: "2026-08-01",
    flightIdentity: null,
    currency: "VND",
    claimIds: claims.map((item) => item.claimId),
  }, claims);
  return { claims, outcome, link: await exactLink(outcome) };
}

describe("Vietnam Outcome Evidence D1B", () => {
  it("is deterministic under semantic input ordering and deep-freezes its result", async () => {
    const { claims, outcome, link } = await finalOutcome();
    const sourceRecord = await source();
    const input = {
      sourceCutoff: "2026-08-02T00:00:00Z",
      sources: [sourceRecord],
      claims,
      outcomeInputs: [{
        outcomeEventKey: EVENT_KEY,
        organizer: "Fixture Poker Club",
        seriesName: "Fixture Championship",
        eventName: "Main Event",
        eventDate: "2026-08-01",
        flightIdentity: null,
        currency: "VND",
        claimIds: claims.map((item) => item.claimId),
      }],
      links: [link],
    } as const;
    const first = await createVietnamOutcomeEvidenceBundle(input);
    const second = await createVietnamOutcomeEvidenceBundle({ ...input, claims: [...claims].reverse() });
    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.artifact.outcomes)).toBe(true);
    expect(first.release.releaseKind).toBe("observed_public_outcome_evidence");
    expect(outcome.outcomeId).toBe(second.artifact.outcomes[0].outcomeId);
  });

  it("content-addresses source bytes and cutoff", async () => {
    const baseline = await source();
    const changed = await source({
      sourceIdentity: {
        kind: "repository_file",
        path: "docs/series/evidence/vietnam/outcomes/reviewed/fixture-official-result.png",
        sha256: SHA_B,
      },
    });
    expect(changed.sourceId).not.toBe(baseline.sourceId);
    const { claims, link } = await finalOutcome();
    const baseInput = {
      sources: [baseline], claims,
      outcomeInputs: [{ outcomeEventKey: EVENT_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null, currency: "VND", claimIds: claims.map((item) => item.claimId) }],
      links: [link],
    } as const;
    const first = await createVietnamOutcomeEvidenceBundle({ ...baseInput, sourceCutoff: "2026-08-02T00:00:00Z" });
    const later = await createVietnamOutcomeEvidenceBundle({ ...baseInput, sourceCutoff: "2026-08-03T00:00:00Z" });
    expect(later.release.releaseId).not.toBe(first.release.releaseId);
  });

  it("keeps missing, explicit zero, uncertain, and conflicting evidence distinct", async () => {
    const missing = await claim("entries", null, "missing");
    const zero = await claim("entries", { type: "integer", value: "0" }, "explicit_zero");
    const uncertain = await claim("entries", { type: "integer", value: "10" }, "uncertain");
    const conflicting = await claim("entries", { type: "integer", value: "10" }, "conflicting");
    expect(new Set([missing.claimId, zero.claimId, uncertain.claimId, conflicting.claimId]).size).toBe(4);
    await expect(claim("entries", { type: "integer", value: "1" }, "explicit_zero"))
      .rejects.toMatchObject({ code: "OUTCOME_EXPLICIT_ZERO_REQUIRED" });
  });

  it("keeps entries, unique players, and bullets as separate evidence fields", async () => {
    const entries = await claim("entries", { type: "integer", value: "100" });
    const unique = await claim("unique_players", { type: "integer", value: "80" });
    const bullets = await claim("total_bullets", { type: "integer", value: "110" });
    const outcome = await createVietnamEventOutcome({
      outcomeEventKey: EVENT_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null, currency: "VND", claimIds: [entries.claimId, unique.claimId, bullets.claimId],
    }, [entries, unique, bullets]);
    expect(outcome.fields.map((field) => field.field)).toEqual(["entries", "unique_players", "total_bullets"]);
  });

  it("will not promote flight or series counts to event-total readiness", async () => {
    for (const basis of ["flight_only", "series_total"] as const) {
      const entries = await claim("entries", { type: "integer", value: "50" });
      const basisClaim = await claim("entries_basis", { type: "text", value: basis });
      const outcome = await createVietnamEventOutcome({
        outcomeEventKey: EVENT_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null, currency: "VND", claimIds: [entries.claimId, basisClaim.claimId],
      }, [entries, basisClaim]);
      const report = await createOutcomeReadinessReport(outcome, await exactLink(outcome));
      expect(report.states).not.toContain("entries_only");
      expect(report.reasonCodes).toContain("entries_basis_is_not_explicit_event_total");
    }
  });

  it("does not synthesize prize pools or entries and uses exact compatible money only for overlay", async () => {
    const { outcome } = await finalOutcome();
    const derived = deriveOutcomeOverlaySurplus(outcome);
    expect(derived.overlay?.minorUnits).toBe("100000000");
    expect(derived.surplus?.minorUnits).toBe("0");
    const entries = await claim("entries", { type: "integer", value: "100" });
    const entriesOnly = await createVietnamEventOutcome({
      outcomeEventKey: EVENT_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null, currency: "VND", claimIds: [entries.claimId],
    }, [entries]);
    expect(deriveOutcomeOverlaySurplus(entriesOnly)).toEqual({ overlay: null, surplus: null });
    const gtd = await claim("published_gtd", { type: "money", minorUnits: "10", currency: "VND", scale: 0 });
    const usdPool = await claim("actual_prize_pool", { type: "money", minorUnits: "9", currency: "USD", scale: 0 });
    const splitCurrency = await createVietnamEventOutcome({
      outcomeEventKey: EVENT_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null, currency: null, claimIds: [gtd.claimId, usdPool.claimId],
    }, [gtd, usdPool]);
    expect(deriveOutcomeOverlaySurplus(splitCurrency)).toEqual({ overlay: null, surplus: null });
  });

  it("fails closed for fuzzy-only and ambiguous schedule linkage", async () => {
    const { outcome } = await finalOutcome();
    const candidate = await createScheduleOutcomeLink({
      outcome, expectedCompetitionKey: null, sourceDeclaredCompetitionKey: null,
      scheduleCompetitions: [{ competitionKey: COMPETITION_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null }],
    });
    expect(candidate.state).toBe("candidate");
    expect(isAutomaticAggregateResearchEligible(candidate)).toBe(false);
    const ambiguous = await createScheduleOutcomeLink({
      outcome, expectedCompetitionKey: null, sourceDeclaredCompetitionKey: null,
      scheduleCompetitions: [
        { competitionKey: "fixture-main-event-a", organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null },
        { competitionKey: "fixture-main-event-b", organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null },
      ],
    });
    expect(ambiguous.state).toBe("ambiguous");
    expect(ambiguous.candidateCompetitionKeys).toEqual(["fixture-main-event-a", "fixture-main-event-b"]);
    expect(isAutomaticAggregateResearchEligible(ambiguous)).toBe(false);

    const declaredButUnknown = await createScheduleOutcomeLink({
      outcome,
      expectedCompetitionKey: null,
      sourceDeclaredCompetitionKey: "unknown-declared-competition",
      scheduleCompetitions: [{ competitionKey: COMPETITION_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null }],
    });
    expect(declaredButUnknown.state).toBe("unlinked");
    expect(declaredButUnknown.reasonCodes).toContain("explicit_schedule_competition_key_not_found");
  });

  it("preserves correction history without deleting claims and rejects correction cycles", async () => {
    const oldClaim = await claim("entries", { type: "integer", value: "99" });
    const newClaim = await createVietnamOutcomeEvidenceClaim({
      outcomeEventKey: EVENT_KEY, source: await source(), field: "entries", state: "present", value: { type: "integer", value: "100" },
      visualOrTextRegion: "result-card:entries-correction", extractionMethod: "manual_visual", extractionStatus: "verified", correctionOfClaimId: oldClaim.claimId,
    });
    const correction = await createVietnamOutcomeCorrection({ correctionKey: "fixture-entries-correction", correctedAt: "2026-08-02T00:00:00Z", supersededClaimId: oldClaim.claimId, supersedingClaimId: newClaim.claimId, reason: "Official result correction." }, [oldClaim, newClaim]);
    expect(correction.status).toBe("superseded_by_corrected_claim");
    expect(oldClaim.value).toEqual({ type: "integer", value: "99" });
    validateOutcomeCorrectionGraph([correction]);
    await expect(createVietnamOutcomeCorrection({ correctionKey: "bad", correctedAt: "2026-08-02T00:00:00Z", supersededClaimId: oldClaim.claimId, supersedingClaimId: oldClaim.claimId, reason: "bad" }, [oldClaim, newClaim]))
      .rejects.toMatchObject({ code: "OUTCOME_CORRECTION_SELF_REFERENCE" });
  });

  it("rejects rejected evidence and refuses to emit a zero-row research release", async () => {
    const rejected = await source({ sourceId: "rejected-source", sourceCategory: "rejected", reviewerStatus: "rejected", evidenceQuality: "rejected" });
    await expect(claim("entries", { type: "integer", value: "1" }, "present", rejected))
      .rejects.toMatchObject({ code: "REJECTED_OUTCOME_EVIDENCE" });
    await expect(createVietnamOutcomeEvidenceBundle({ sourceCutoff: "2026-08-02T00:00:00Z", sources: [], claims: [], outcomeInputs: [], links: [] }))
      .rejects.toMatchObject({ code: "OUTCOME_RELEASE_EMPTY" });
  });

  it("keeps the source cutoff and source provenance fail-closed", async () => {
    const lateSource = await source({ publicationAt: "2026-08-03T00:00:00Z", capturedAt: "2026-08-03T00:01:00Z" });
    const lateEntries = await claim("entries", { type: "integer", value: "100" }, "present", lateSource);
    const lateOutcomeInput = {
      outcomeEventKey: EVENT_KEY,
      organizer: "Fixture Poker Club",
      seriesName: "Fixture Championship",
      eventName: "Main Event",
      eventDate: "2026-08-01",
      flightIdentity: null,
      currency: "VND",
      claimIds: [lateEntries.claimId],
    } as const;
    const lateOutcome = await createVietnamEventOutcome(lateOutcomeInput, [lateEntries]);
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: "2026-08-02T00:00:00Z",
      sources: [lateSource],
      claims: [lateEntries],
      outcomeInputs: [lateOutcomeInput],
      links: [await exactLink(lateOutcome)],
    })).rejects.toMatchObject({ code: "OUTCOME_SOURCE_AFTER_CUTOFF" });

    const reviewedSource = await source();
    const forgedClaim: VietnamOutcomeEvidenceClaim = {
      ...lateEntries,
      sourceId: reviewedSource.sourceId,
    };
    await expect(createVietnamOutcomeEvidenceBundle({
      sourceCutoff: "2026-08-02T00:00:00Z",
      sources: [reviewedSource],
      claims: [forgedClaim],
      outcomeInputs: [lateOutcomeInput],
      links: [await exactLink(lateOutcome)],
    })).rejects.toMatchObject({ code: "OUTCOME_CLAIM_SOURCE_PROVENANCE_MISMATCH" });
  });

  it("does not promote a conflicting final result to outcome_ready", async () => {
    const finalEntries = await claim("entries", { type: "integer", value: "100" });
    const conflictingEntries = await claim("entries", { type: "integer", value: "101" }, "conflicting");
    const basis = await claim("entries_basis", { type: "text", value: "event_total" });
    const finalStatus = await claim("completion_status", { type: "text", value: "result_final" });
    const claims = [finalEntries, conflictingEntries, basis, finalStatus];
    const outcome = await createVietnamEventOutcome({
      outcomeEventKey: EVENT_KEY,
      organizer: "Fixture Poker Club",
      seriesName: "Fixture Championship",
      eventName: "Main Event",
      eventDate: "2026-08-01",
      flightIdentity: null,
      currency: "VND",
      claimIds: claims.map((item) => item.claimId),
    }, claims);
    const readiness = await createOutcomeReadinessReport(outcome, await exactLink(outcome));
    expect(readiness.states).toContain("conflicting_outcome");
    expect(readiness.states).not.toContain("outcome_ready");
  });

  it("keeps the intake template fixture-only and records public provenance without a private player list", async () => {
    const intake = await createOutcomeIntakeRecord({
      intakeKey: "fictional-outcome-intake",
      source: {
        sourceId: "fictional-public-result", sourceCategory: "public_outcome_post",
        sourceIdentity: { kind: "public_url", url: "https://example.test/final-result", sha256: null },
        organizer: "Fictional Organizer", seriesName: "Fictional Series", eventName: "Fictional Event",
        publicationAt: "2026-08-02T00:00:00Z", capturedAt: "2026-08-02T00:01:00Z", expectedCompetitionKey: null,
        reviewerStatus: "intake", evidenceQuality: "secondary_public_announcement_unverified", limitationNotes: ["Fictional template."],
      },
      claimedFields: ["entries", "actual_prize_pool"], expectedCompetitionKey: null, reviewerStatus: "intake", limitationNotes: ["Fictional template."],
    });
    expect(intake.fixtureOnly).toBe(true);
    expect(intake.source.evidenceQuality).toBe("secondary_public_announcement_unverified");
  });

  it("creates a receipt only for a non-empty, reviewable artifact", async () => {
    const { claims, link } = await finalOutcome();
    const bundle = await createVietnamOutcomeEvidenceBundle({
      sourceCutoff: "2026-08-02T00:00:00Z", sources: [await source()], claims,
      outcomeInputs: [{ outcomeEventKey: EVENT_KEY, organizer: "Fixture Poker Club", seriesName: "Fixture Championship", eventName: "Main Event", eventDate: "2026-08-01", flightIdentity: null, currency: "VND", claimIds: claims.map((item) => item.claimId) }], links: [link],
    });
    const receipt = await createVietnamOutcomeReceipt({ bundle, artifactPath: "src/lib/series-market/datasets/vietnam/outcomes/v1/research/outcomes-v1.json", artifactFileSha256: SHA_A });
    expect(receipt.releaseId).toBe(bundle.release.releaseId);
    expect(receipt.artifactFileSha256).toBe(SHA_A);
  });

  it("uses the public validation error type for failure paths", async () => {
    await expect(createVietnamOutcomeEvidenceSource({
      sourceId: "bad", sourceCategory: "official_result_poster", sourceIdentity: { kind: "public_url", url: "http://example.test/not-https", sha256: null },
      organizer: "Fixture", seriesName: "Fixture", eventName: null, publicationAt: "2026-08-01T00:00:00Z", capturedAt: "2026-08-01T00:01:00Z", expectedCompetitionKey: null,
      reviewerStatus: "reviewed", evidenceQuality: "official_result_unverified", limitationNotes: [],
    })).rejects.toBeInstanceOf(SeriesMarketValidationError);
  });
});
