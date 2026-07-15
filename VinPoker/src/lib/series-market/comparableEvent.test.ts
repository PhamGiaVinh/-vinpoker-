import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPARABLE_DISTRIBUTION_METHOD_ID,
  COMPARABLE_SELECTION_PROTOCOL_ID,
  COMPARABLE_TAXONOMY_VERSION,
  JEJU_EVENT_FAMILY_TAXONOMY_V0,
  analyzeComparableEvent,
  buildComparableDistribution,
  buildJejuComparableCorpus,
  evaluateComparableV0,
  freezeComparableSelection,
  type ComparableCandidate,
  type ComparableCorpus,
  type ComparableOutcome,
  type ComparableSelectionInput,
} from "./comparableEvent";
import { createVerifiedJejuReadModel } from "./verifiedMarketReadModel";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(join(RELEASE_ROOT, name), "utf8")) as unknown;
}

function artifacts() {
  return {
    canonicalImport: artifact("canonical/jeju_import_v1.json"),
    release: artifact("release.json"),
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  };
}

function input(id: string, overrides: Partial<ComparableSelectionInput> = {}): ComparableSelectionInput {
  return {
    eventId: id,
    festivalId: "festival-a",
    festivalKey: "festival-a",
    tour: "APT",
    eventDate: "2025-09-10",
    eventType: "Main",
    eventFamily: "main",
    game: "NLH",
    currency: "KRW",
    buyIn: { minorUnits: "100000", currency: "KRW", scale: 0 },
    gtd: { minorUnits: "1000000", currency: "KRW", scale: 0 },
    flagship: false,
    inputClaimIds: [`claim-${id}`],
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<ComparableSelectionInput> = {}): ComparableCandidate {
  return { eventId: id, selection: input(id, overrides), selectionIssues: [] };
}

function corpus(candidates: readonly ComparableCandidate[], outcomes: readonly ComparableOutcome[]): ComparableCorpus {
  return {
    releaseId: "series-market:v1:release:test",
    sourceCutoff: "2026-07-15T00:00:00.000Z",
    selectionProtocolId: COMPARABLE_SELECTION_PROTOCOL_ID,
    taxonomyVersion: COMPARABLE_TAXONOMY_VERSION,
    distributionMethodId: COMPARABLE_DISTRIBUTION_METHOD_ID,
    candidates,
    outcomeEventIds: outcomes.map((outcome) => outcome.eventId),
    outcomes,
  };
}

function outcome(eventId: string, entries: string): ComparableOutcome {
  return { eventId, entries, claimIds: [`entries-${eventId}`] };
}

describe("Comparable Event Engine V0", () => {
  it("maps every exact Jeju V1 event type through the versioned taxonomy", async () => {
    const model = await createVerifiedJejuReadModel(artifacts());
    const releaseTypes = [...new Set(model.events.map((event) => event.eventType))].sort();
    expect(Object.keys(JEJU_EVENT_FAMILY_TAXONOMY_V0).sort()).toEqual(releaseTypes);
    expect(new Set(Object.values(JEJU_EVENT_FAMILY_TAXONOMY_V0))).not.toContain("unknown");
    expect(COMPARABLE_TAXONOMY_VERSION).toBe("jeju-event-family-v0");
  }, 30_000);

  it("builds an immutable public corpus from the locked read model without a raw CSV dependency", async () => {
    const model = await createVerifiedJejuReadModel(artifacts());
    const before = structuredClone(model);
    const result = buildJejuComparableCorpus(model);
    expect(model).toEqual(before);
    expect(result.releaseId).toBe(model.releaseId);
    expect(result.candidates).toHaveLength(87);
    expect(result.outcomes).toHaveLength(87);
    expect(result.candidates.map((item) => item.eventId)).toEqual([...result.candidates.map((item) => item.eventId)].sort());
    expect(result.candidates.every((item) => item.selection !== null)).toBe(true);
    expect(result.outcomes.every((item) => /^\d+$/.test(item.entries))).toBe(true);
  }, 30_000);

  it("keeps entries out of the selection shape and joins values only after IDs freeze", async () => {
    const target = candidate("target", { eventDate: "2025-09-10" });
    const candidates = [
      target,
      candidate("a", { eventDate: "2025-09-01" }),
      candidate("b", { eventDate: "2025-09-02", eventType: "MiniMain" }),
      candidate("c", { eventDate: "2025-09-03", eventType: "Turbo", eventFamily: "fast" }),
      candidate("d", { eventDate: "2025-09-04" }),
      candidate("e", { eventDate: "2025-09-05" }),
    ];
    expect("entries" in target.selection!).toBe(false);
    const selected = freezeComparableSelection(target, candidates, new Set(["a", "b", "c", "d", "e"]), {
      chronologyOriginDate: "2025-09-10",
      requestedComparables: 5,
    });
    const low = corpus(candidates, [outcome("a", "0"), outcome("b", "1"), outcome("c", "2"), outcome("d", "3"), outcome("e", "4")]);
    const high = corpus(candidates, [outcome("a", "999999999999999999999"), outcome("b", "8"), outcome("c", "7"), outcome("d", "6"), outcome("e", "5")]);
    const lowAnalysis = await analyzeComparableEvent(low, "target", { requestedComparables: 5, minimumDistributionN: 5 });
    const highAnalysis = await analyzeComparableEvent(high, "target", { requestedComparables: 5, minimumDistributionN: 5 });
    expect(lowAnalysis.selection.selectedComparableIds).toEqual(selected.selectedComparableIds);
    expect(highAnalysis.selection.selectedComparableIds).toEqual(selected.selectedComparableIds);
    expect(lowAnalysis.provenance.selectedComparableIds).toEqual(highAnalysis.provenance.selectedComparableIds);
    expect(lowAnalysis.id).toBe(highAnalysis.id);
    expect(lowAnalysis.distribution.p50).not.toBe(highAnalysis.distribution.p50);
  });

  it("enforces self, currency, game, input, outcome, chronology, and festival exclusions deterministically", () => {
    const target = candidate("target", { eventDate: "2025-09-10" });
    const sparse: ComparableCandidate = { eventId: "sparse", selection: null, selectionIssues: ["MISSING_BUY_IN"] };
    const candidates = [
      target,
      candidate("currency", { eventDate: "2025-09-09", currency: "USD", buyIn: { minorUnits: "100", currency: "USD", scale: 0 }, gtd: { minorUnits: "1000000", currency: "USD", scale: 0 } }),
      candidate("gtd-currency", { eventDate: "2025-09-09", gtd: { minorUnits: "1000000", currency: "USD", scale: 0 } }),
      candidate("game", { eventDate: "2025-09-09", game: "PLO" }),
      candidate("future", { eventDate: "2025-09-10" }),
      candidate("other-festival", { eventDate: "2025-09-09", festivalId: "festival-b", festivalKey: "festival-b" }),
      sparse,
      candidate("eligible", { eventDate: "2025-09-09" }),
      candidate("no-outcome", { eventDate: "2025-09-08" }),
    ];
    const result = freezeComparableSelection(target, candidates, new Set(["currency", "gtd-currency", "game", "future", "other-festival", "eligible"]), {
      chronologyOriginDate: "2025-09-10",
      excludedFestivalIds: ["festival-b"],
    });
    const byId = new Map(result.assessments.map((item) => [item.eventId, item]));
    expect(byId.get("target")?.exclusionReasons).toEqual(["SELF"]);
    expect(byId.get("currency")?.exclusionReasons).toEqual(["CURRENCY_MISMATCH"]);
    expect(byId.get("gtd-currency")?.exclusionReasons).toEqual(["CONFLICTING_INPUT"]);
    expect(byId.get("game")?.exclusionReasons).toEqual(["GAME_MISMATCH"]);
    expect(byId.get("future")?.exclusionReasons).toEqual(["NOT_BEFORE_ORIGIN"]);
    expect(byId.get("other-festival")?.exclusionReasons).toEqual(["EXCLUDED_FESTIVAL"]);
    expect(byId.get("sparse")?.exclusionReasons).toEqual(["MISSING_BUY_IN"]);
    expect(byId.get("no-outcome")?.exclusionReasons).toEqual(["MISSING_ENTRIES_OUTCOME"]);
    expect(result.selectedComparableIds).toEqual(["eligible"]);
    const invalidTarget = candidate("invalid-target", { gtd: { minorUnits: "1000000", currency: "USD", scale: 0 } });
    expect(freezeComparableSelection(invalidTarget, [invalidTarget, candidate("valid")], new Set(["valid"])).targetIssues)
      .toEqual(["CONFLICTING_INPUT"]);
  });

  it("ranks by the locked lexicographic order with lossless large buy-ins and canonical ID tie-breaking", () => {
    const target = candidate("target", {
      eventDate: "2025-09-30",
      buyIn: { minorUnits: "999999999999999999999999999999", currency: "KRW", scale: 0 },
    });
    const candidates = [
      target,
      candidate("z-exact-far", { eventDate: "2025-09-01", buyIn: { minorUnits: "1250000000000000000000000000000", currency: "KRW", scale: 0 } }),
      candidate("a-exact-near", { eventDate: "2025-09-29", buyIn: { minorUnits: "1249999999999999999999999999998", currency: "KRW", scale: 0 } }),
      candidate("family", { eventDate: "2025-09-29", eventType: "MiniMain", buyIn: { minorUnits: "1", currency: "KRW", scale: 0 } }),
      candidate("different", { eventDate: "2025-09-29", eventType: "Turbo", eventFamily: "fast" }),
    ];
    const result = freezeComparableSelection(target, candidates, new Set(candidates.map((item) => item.eventId)), { requestedComparables: 4 });
    expect(result.selectedComparableIds).toEqual(["a-exact-near", "z-exact-far", "family", "different"]);
    expect(result.assessments.find((item) => item.eventId === "z-exact-far")?.rank?.buyInRatioBand).toBe("within_1_5x");
    expect(result.assessments.find((item) => item.eventId === "a-exact-near")?.rank?.buyInRatioBand).toBe("within_1_25x");
  });

  it("preserves zero GTD as a value and treats missing GTD as a separate penalty", () => {
    const target = candidate("target", { gtd: { minorUnits: "0", currency: "KRW", scale: 0 } });
    const zero = candidate("zero", { gtd: { minorUnits: "0", currency: "KRW", scale: 0 } });
    const missing = candidate("missing", { gtd: null });
    const result = freezeComparableSelection(target, [target, missing, zero], new Set(["missing", "zero"]));
    expect(result.selectedComparableIds).toEqual(["zero", "missing"]);
    expect(result.assessments.find((item) => item.eventId === "zero")?.rank?.gtdSimilarity).toBe("within_1_25x");
    expect(result.assessments.find((item) => item.eventId === "missing")?.rank?.gtdSimilarity).toBe("missing_gtd");
  });

  it("uses count-only nearest-rank quantiles and exposes insufficient evidence", () => {
    const available = buildComparableDistribution([outcome("a", "0"), outcome("b", "10"), outcome("c", "10"), outcome("d", "20")], {
      minimumN: 4,
      exactMatches: 4,
    });
    expect(available).toMatchObject({
      label: "Historical Benchmark",
      methodId: "nearest-rank-count-quantiles-v1",
      state: "available",
      minimum: "0",
      p10: "0",
      p25: "0",
      p50: "10",
      p75: "10",
      p90: "20",
      maximum: "20",
      iqr: "10",
    });
    const insufficient = buildComparableDistribution([outcome("a", "0"), outcome("b", "100")], { minimumN: 3 });
    expect(insufficient).toMatchObject({ state: "insufficient", quality: "insufficient", p50: null, p90: null });
  });

  it("changes analysis provenance for a changed selection input but not for output values", async () => {
    const target = candidate("target", { eventDate: "2025-09-10" });
    const candidates = [target, candidate("a", { eventDate: "2025-09-01" }), candidate("b", { eventDate: "2025-09-02" }), candidate("c", { eventDate: "2025-09-03" }), candidate("d", { eventDate: "2025-09-04" }), candidate("e", { eventDate: "2025-09-05" })];
    const first = corpus(candidates, [outcome("a", "1"), outcome("b", "2"), outcome("c", "3"), outcome("d", "4"), outcome("e", "5")]);
    const changedTarget = [candidate("target", { eventDate: "2025-09-10", flagship: true }), ...candidates.slice(1)];
    const second = corpus(changedTarget, first.outcomes);
    const firstAnalysis = await analyzeComparableEvent(first, "target", { minimumDistributionN: 5, analysisTimestamp: "2026-07-15T00:00:00Z" });
    const secondAnalysis = await analyzeComparableEvent(second, "target", { minimumDistributionN: 5, analysisTimestamp: "2026-07-15T00:00:00.000Z" });
    expect(firstAnalysis.provenance.targetInputHash).not.toBe(secondAnalysis.provenance.targetInputHash);
    expect(firstAnalysis.id).not.toBe(secondAnalysis.id);
    expect(firstAnalysis.provenance.analysisTimestamp).toBe("2026-07-15T00:00:00.000Z");
  });

  it("evaluates only chronological evidence, compares the honest baseline, and stress-tests leave-one-festival-out", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return candidate(`event-${index + 1}`, {
        eventDate: `2025-09-${day}`,
        festivalId: index < 4 ? "festival-a" : "festival-b",
        festivalKey: index < 4 ? "festival-a" : "festival-b",
      });
    });
    const values = ["10", "20", "30", "40", "50", "60", "70", "80"];
    const result = evaluateComparableV0(corpus(candidates, candidates.map((item, index) => outcome(item.eventId, values[index]!))), {
      requestedComparables: 3,
      minimumDistributionN: 2,
    });
    for (const summary of [result.chronological, result.leaveOneFestivalOut]) {
      expect(summary.comparableMetricsOnPairedFolds).toBeDefined();
      for (const fold of summary.folds) {
        const target = candidates.find((item) => item.eventId === fold.targetId)!.selection!;
        for (const id of [...fold.selectedComparableIds, ...fold.baselineCandidateIds]) {
          const candidateInput = candidates.find((item) => item.eventId === id)!.selection!;
          expect(candidateInput.eventDate < target.eventDate).toBe(true);
        }
      }
    }
    for (const fold of result.leaveOneFestivalOut.folds) {
      const target = candidates.find((item) => item.eventId === fold.targetId)!.selection!;
      for (const id of [...fold.selectedComparableIds, ...fold.baselineCandidateIds]) {
        expect(candidates.find((item) => item.eventId === id)!.selection!.festivalId).not.toBe(target.festivalId);
      }
    }
    expect(result.limitations.join(" ")).toMatch(/No random split/);
  });
});
