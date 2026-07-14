import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERIES_MARKET_CONTRACT_VERSION,
  type SourceClaim,
  type SourceDocument,
  type SourceRevision,
} from "./contracts";
import {
  EMPTY_MARKET_FILTERS,
  VERIFIED_JEJU_RELEASE_ID,
  buildVerifiedField,
  createVerifiedJejuReadModel,
  filterVerifiedEvents,
  formatClaimValue,
  formatIntegerString,
  formatMoneyValue,
  normalizeMarketSearch,
} from "./verifiedMarketReadModel";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(join(RELEASE_ROOT, name), "utf8")) as unknown;
}

const artifacts = () => ({
  canonicalImport: artifact("canonical/jeju_import_v1.json"),
  release: artifact("release.json"),
  sourceManifest: artifact("source-manifest.json"),
  dataQuality: artifact("data-quality.json"),
});

describe("Verified Market Jeju read model", () => {
  it("builds the locked release from source claims with exact counts and lineage", async () => {
    const model = await createVerifiedJejuReadModel(artifacts());
    expect(model.releaseId).toBe(VERIFIED_JEJU_RELEASE_ID);
    expect(model.festivals).toHaveLength(5);
    expect(model.events).toHaveLength(87);
    expect(model.claimCount).toBe(972);
    expect(model.quality.missingClaims).toBe(178);
    expect(model.quality.missingCountByField).toMatchObject({ buy_in_prize: 49, organizer_fee: 49, gtd: 80 });
    expect(model.quality.conflicts).toBe(0);
    const detail = model.events[0]?.fields.event_name.evidence[0];
    expect(detail?.sourceRevisionId).toBe(model.sourceRevision.id);
    expect(detail?.sourceDocumentId).toBe(model.sourceDocument.id);
    expect(detail?.rawValue).not.toBeNull();
  }, 30_000);

  it("keeps deterministic date/festival/event-number ordering across source row order", async () => {
    const original = artifacts();
    const reordered = structuredClone(original) as ReturnType<typeof artifacts>;
    const canonical = reordered.canonicalImport as { rows: unknown[] };
    canonical.rows.reverse();
    const first = await createVerifiedJejuReadModel(original);
    const second = await createVerifiedJejuReadModel(reordered);
    expect(second.events.map((event) => event.id)).toEqual(first.events.map((event) => event.id));
    for (let index = 1; index < first.events.length; index += 1) {
      expect(first.events[index - 1]!.eventDate <= first.events[index]!.eventDate).toBe(true);
    }
  }, 30_000);

  it("does not mutate artifacts and freezes the produced model", async () => {
    const input = artifacts();
    const before = structuredClone(input);
    const model = await createVerifiedJejuReadModel(input);
    expect(input).toEqual(before);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.events)).toBe(true);
    expect(Object.isFrozen(model.events[0]?.fields)).toBe(true);
  }, 30_000);

  it("formats exact integer and money strings without collapsing zero into Missing", () => {
    expect(formatIntegerString("999999999999999999999999999999")).toBe("999,999,999,999,999,999,999,999,999,999");
    expect(formatMoneyValue({ type: "money", minorUnits: "123456789012345678901", currency: "USD", scale: 2 }))
      .toBe("USD 1,234,567,890,123,456,789.01");
    expect(formatClaimValue({ type: "integer", value: "0" })).toBe("0");
    expect(formatClaimValue({ type: "money", minorUnits: "0", currency: "KRW", scale: 0 })).toBe("KRW 0");
    expect(formatClaimValue({ type: "missing", reason: "unknown" })).toBe("Missing");
  });

  it("combines filters deterministically and supports case/Unicode search", async () => {
    const model = await createVerifiedJejuReadModel(artifacts());
    const usdTritonMissing = filterVerifiedEvents(model.events, {
      ...EMPTY_MARKET_FILTERS,
      tour: "Triton",
      currency: "USD",
      evidenceState: "missing",
    });
    expect(usdTritonMissing.length).toBeGreaterThan(0);
    expect(usdTritonMissing.every((event) => event.tour === "Triton" && event.currency === "USD" && event.missingFieldCount > 0)).toBe(true);
    const resolvedOnly = filterVerifiedEvents(model.events, {
      ...EMPTY_MARKET_FILTERS,
      evidenceState: "resolved",
    });
    expect(resolvedOnly.length).toBeGreaterThan(0);
    expect(resolvedOnly.every((event) => event.missingFieldCount === 0 && event.conflictFieldCount === 0)).toBe(true);
    const query = model.events[0]!.eventName.toUpperCase();
    expect(filterVerifiedEvents(model.events, { ...EMPTY_MARKET_FILTERS, search: query }).length).toBeGreaterThan(0);
    expect(normalizeMarketSearch("Đà Nẵng")).toBe("da nang");
  }, 30_000);

  it("preserves equal-precedence conflicts without choosing a winner", () => {
    const document: SourceDocument = {
      id: "document-1",
      contractVersion: SERIES_MARKET_CONTRACT_VERSION,
      documentKey: "source-one",
      sourceType: "other_public",
      canonicalUrl: null,
      sourceReference: "fixture",
      publisher: null,
      title: null,
    };
    const revision: SourceRevision = {
      id: "revision-1",
      contractVersion: SERIES_MARKET_CONTRACT_VERSION,
      sourceDocumentId: document.id,
      revisionKey: "v1",
      retrievedAt: "2026-07-14T00:00:00.000Z",
      effectiveAt: null,
      contentHash: null,
      supersedesSourceRevisionId: null,
    };
    const base: SourceClaim = {
      id: "claim-a",
      contractVersion: SERIES_MARKET_CONTRACT_VERSION,
      entityType: "event",
      entityId: "event-1",
      field: "event_name",
      kind: "reported",
      status: "unverified",
      confidence: "unknown",
      value: { type: "text", value: "Alpha" },
      rawValue: "Alpha",
      unit: null,
      sourceRevisionId: revision.id,
      observedAt: "2026-07-14T00:00:00.000Z",
      effectiveAt: null,
      extractionMethod: "structured_import",
      supersedesClaimId: null,
      notes: null,
    };
    const conflict = buildVerifiedField(
      "event_name",
      [base, { ...base, id: "claim-b", value: { type: "text", value: "Beta" }, rawValue: "Beta" }],
      [revision],
      [document],
    );
    expect(conflict.state).toBe("conflict");
    expect(conflict.value).toBeNull();
    expect(conflict.activeClaimIds).toEqual(["claim-a", "claim-b"]);
    expect(conflict.evidence.map((item) => formatClaimValue(item.normalizedValue))).toEqual(["Alpha", "Beta"]);
  });

  it("fails closed when the release identity is altered", async () => {
    const input = artifacts();
    input.release = { ...(input.release as object), id: `${VERIFIED_JEJU_RELEASE_ID}-altered` };
    await expect(createVerifiedJejuReadModel(input)).rejects.toMatchObject({ code: "ARTIFACT_VALUE_MISMATCH" });
  });
});
