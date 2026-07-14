import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../series-intelligence/provenanceHash";
import { parseJejuImportJson, type JejuImportJsonDocument } from "./importer";
import {
  JEJU_FESTIVAL_KEY_BY_NAME,
  JEJU_OMITTED_LEGACY_COLUMNS,
  JEJU_SEED_RAW_COLUMNS,
  buildJejuImportDocument,
  buildJejuDataQualityReport,
  countClaimsByField,
  importJejuSeed,
  normalizeSeedMoneyString,
  type JejuSeedRawRow,
  type JejuSeedSourceManifest,
} from "./jejuSeedAdapter";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");
const RAW_PATH = join(RELEASE_ROOT, "raw/jeju_events_seed_v0.csv");
const MANIFEST_PATH = join(RELEASE_ROOT, "source-manifest.json");
const CANONICAL_PATH = join(RELEASE_ROOT, "canonical/jeju_import_v1.json");
const raw = readFileSync(RAW_PATH, "utf8");
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as JejuSeedSourceManifest;

function stableJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalize(value)), null, 2)}\n`;
}

function reverseRows(input: string): string {
  const parsed = Papa.parse<JejuSeedRawRow>(input, { header: true, dynamicTyping: false, skipEmptyLines: "greedy" });
  return Papa.unparse([...parsed.data].reverse());
}

describe("Jeju seed adapter", () => {
  it("matches the committed raw source manifest exactly", () => {
    const bytes = readFileSync(RAW_PATH);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.rawSha256);
    expect(bytes.length).toBe(manifest.byteSize);
    expect(manifest.rowCount).toBe(87);
    expect(manifest.originalColumns).toEqual(JEJU_SEED_RAW_COLUMNS);
    expect(manifest.sourceDocumentKey).toBe("jeju-events-seed-v0");
    expect(manifest.sourceRevisionKey).toBe("v0");
    expect(manifest.retrievedAt).toBe("2026-07-14T19:36:11.341Z");
    expect(manifest.canonicalUrl).toBeNull();
  });

  it("normalizes money strings losslessly without Number coercion", () => {
    expect(normalizeSeedMoneyString("734910.0")).toBe("734910");
    expect(normalizeSeedMoneyString("200000000.00")).toBe("200000000");
    expect(normalizeSeedMoneyString("0.0")).toBe("0");
    expect(normalizeSeedMoneyString("999999999999999999999999999999.00")).toBe("999999999999999999999999999999");
    for (const invalid of ["100.5", "1e9", "NaN", "Infinity", "1,000"]) {
      expect(() => normalizeSeedMoneyString(invalid)).toThrowError(/integer-valued decimal/);
    }
  });

  it("emits the complete 972-claim snapshot with source lineage for missing values", async () => {
    const { dataset } = await importJejuSeed(raw, manifest);
    const report = buildJejuDataQualityReport(dataset, manifest, "test-release");

    expect(dataset.festivals).toHaveLength(5);
    expect(dataset.events).toHaveLength(87);
    expect(dataset.festivals.length + dataset.events.length).toBe(92);
    expect(dataset.claims).toHaveLength(972);
    expect(report.nonMissingClaims).toBe(794);
    expect(report.missingClaims).toBe(178);
    expect(report.missingCountByField).toEqual({ buy_in_prize: 49, gtd: 80, organizer_fee: 49 });
    expect(dataset.sourceDocuments).toHaveLength(1);
    expect(dataset.sourceRevisions).toHaveLength(1);
    expect(dataset.conflicts).toHaveLength(0);
    expect(report.currencies).toEqual(["KRW", "USD"]);
    expect(report.eventDateMin).toBe("2025-07-04");
    expect(report.eventDateMax).toBe("2026-02-08");
    expect(countClaimsByField(dataset.claims)).toEqual({
      buy_in: 87,
      buy_in_prize: 87,
      entries: 87,
      event_date: 87,
      event_name: 87,
      event_no: 87,
      event_type: 87,
      game: 87,
      gtd: 87,
      is_flagship: 87,
      organizer_fee: 87,
      festival_name: 5,
      tour: 5,
      venue: 5,
    });

    const sourceRevisionIds = new Set(dataset.claims.map((claim) => claim.sourceRevisionId));
    expect(sourceRevisionIds).toEqual(new Set([dataset.sourceRevisions[0]?.id]));
    for (const claim of dataset.claims) {
      expect(claim.observedAt).toBe(manifest.retrievedAt);
      expect(claim.effectiveAt).toBeNull();
      expect(claim.status).toBe("unverified");
      expect(claim.confidence).toBe("unknown");
      expect(claim.sourceRevisionId).toBe(dataset.sourceRevisions[0]?.id);
      if (claim.kind === "missing") {
        expect(claim.value).toEqual({ type: "missing", reason: "unknown" });
        expect(claim.rawValue).toBeNull();
      } else {
        expect(claim.value.type).not.toBe("missing");
        expect(claim.rawValue).not.toBeNull();
      }
    }
  }, 30_000);

  it("preserves local dates, zero versus missing, and exact money strings", async () => {
    const { dataset, document } = await importJejuSeed(raw, manifest);
    const eventDateClaims = dataset.claims.filter((claim) => claim.field === "event_date");
    expect(eventDateClaims.every((claim) => claim.value.type === "local_date")).toBe(true);
    expect(eventDateClaims.every((claim) => claim.value.type === "local_date" && /^\d{4}-\d{2}-\d{2}$/.test(claim.value.value))).toBe(true);

    expect(normalizeSeedMoneyString("0.0")).toBe("0");
    const missingGtd = dataset.claims.find((claim) => claim.field === "gtd" && claim.value.type === "missing");
    expect(missingGtd?.value).toEqual({ type: "missing", reason: "unknown" });
    expect(dataset.claims.some((claim) => claim.field === "entries" && claim.value.type === "missing")).toBe(false);

    const prizeClaim = dataset.claims.find((claim) => claim.field === "buy_in_prize" && claim.rawValue === "734910.0");
    const gtdClaim = dataset.claims.find((claim) => claim.field === "gtd" && claim.rawValue === "200000000.0");
    expect(prizeClaim?.value).toMatchObject({ type: "money", minorUnits: "734910", currency: "KRW", scale: 0 });
    expect(gtdClaim?.value).toMatchObject({ type: "money", minorUnits: "200000000", currency: "KRW", scale: 0 });
    expect(JSON.stringify(document)).not.toContain("buy_in_usd");
    expect(JSON.stringify(document)).not.toContain("fee_pct");
    expect(JSON.stringify(document)).not.toContain("value_ratio");
    expect(JSON.stringify(document)).not.toContain("ln_entries");
  }, 30_000);

  it("uses explicit stable festival keys and release-specific event identity", async () => {
    expect(JEJU_FESTIVAL_KEY_BY_NAME).toEqual({
      "APT Jeju 2025 (Sept)": "apt-jeju-2025-sept",
      "APT Jeju Classic 2026": "apt-jeju-classic-2026",
      "RDPT Jeju II 2025": "rdpt-jeju-ii-2025",
      "Triton One 2025": "triton-one-jeju-2025",
      "Triton SHRS Jeju II 2025": "triton-shrs-jeju-ii-2025",
    });
    const { dataset } = await importJejuSeed(raw, manifest);
    expect(dataset.festivals.map((festival) => festival.festivalKey)).toEqual([
      "apt-jeju-2025-sept",
      "apt-jeju-classic-2026",
      "rdpt-jeju-ii-2025",
      "triton-one-jeju-2025",
      "triton-shrs-jeju-ii-2025",
    ]);
    expect(new Set(dataset.events.map((event) => `${event.festivalKey}:${event.eventKey}`)).size).toBe(87);
    expect(dataset.events.every((event) => /^event-\d+$/.test(event.eventKey))).toBe(true);
  });

  it("is order-independent and does not mutate caller inputs", async () => {
    const manifestBefore = structuredClone(manifest);
    const rawBefore = raw;
    const first = await importJejuSeed(raw, manifest);
    const second = await importJejuSeed(reverseRows(raw), manifest);
    expect(second.document).toEqual(first.document);
    expect(second.dataset.claims.map((claim) => claim.id)).toEqual(first.dataset.claims.map((claim) => claim.id));
    expect(raw).toBe(rawBefore);
    expect(manifest).toEqual(manifestBefore);
  }, 30_000);

  it("fails closed for unmapped festivals, metadata conflicts, and duplicate event numbers", () => {
    expect(() => buildJejuImportDocument(raw.replace("APT Jeju Classic 2026", "New Festival"), manifest)).toThrowError(/explicitly mapped/);
    expect(() => buildJejuImportDocument(raw.replace('APT,"LES A / Landing Casino, Jeju"', 'APT,"Different Venue"'), manifest)).toThrowError(/conflicting tour or venue/);
    expect(() => buildJejuImportDocument(raw.replace(",1,APT National Cup", ",9,APT National Cup"), manifest)).toThrowError(/duplicate event identity/);
  });

  it("matches the committed canonical artifact and excludes PII/private fields", async () => {
    const { document } = await importJejuSeed(raw, manifest);
    const canonicalText = readFileSync(CANONICAL_PATH, "utf8");
    expect(canonicalText.endsWith("\n")).toBe(true);
    expect(canonicalText).toBe(stableJson(document));
    const parsed = await parseJejuImportJson(JSON.parse(canonicalText) as JejuImportJsonDocument);
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(JSON.parse(canonicalText)).toLowerCase()).not.toMatch(
      /phone|email|playeridentifier|accountidentifier|payment|cashier|wallet|bullethistory|privateregistrationpace|clubfinance/,
    );
    expect(JSON.stringify(JEJU_OMITTED_LEGACY_COLUMNS)).toContain("No exchange-rate source");
  }, 30_000);
});
