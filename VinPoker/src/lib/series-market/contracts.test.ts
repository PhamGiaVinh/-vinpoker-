import { describe, expect, it } from "vitest";
import {
  SERIES_MARKET_CONTRACT_VERSION,
  appendSourceClaim,
  dedupeSourceClaims,
  resolveSourceClaims,
  validateClaimSupersession,
  validateDerivedMetric,
  validateSourceClaim,
  type DerivedMetric,
  type SourceClaim,
} from "./contracts";

const baseClaim = (overrides: Partial<SourceClaim> = {}): SourceClaim => ({
  id: "claim-a",
  contractVersion: SERIES_MARKET_CONTRACT_VERSION,
  entityType: "event",
  entityId: "event-a",
  field: "entries",
  kind: "observed",
  status: "official_confirmed",
  confidence: "high",
  value: { type: "integer", value: "120" },
  rawValue: "120",
  unit: "entries",
  sourceRevisionId: "source-revision-a",
  observedAt: "2026-07-13T09:30:00.000Z",
  effectiveAt: null,
  extractionMethod: "manual_curated",
  supersedesClaimId: null,
  notes: null,
  ...overrides,
});

const metric = (overrides: Partial<DerivedMetric> = {}): DerivedMetric => ({
  id: "metric-a",
  contractVersion: SERIES_MARKET_CONTRACT_VERSION,
  entityId: "event-a",
  metricKey: "required-field",
  methodVersion: "required-field-v1",
  inputClaimIds: ["claim-a", "claim-b"],
  parameters: { rounding: "ceil" },
  value: { type: "integer", value: "200" },
  unit: "entries",
  confidence: "medium",
  computedAt: "2026-07-13T09:30:00.000Z",
  notes: null,
  ...overrides,
});

describe("series-market claim invariants", () => {
  it("keeps missing claims explicit and distinct from zero", () => {
    const missing = baseClaim({
      id: "claim-missing",
      kind: "missing",
      value: { type: "missing", reason: "not_disclosed" },
      sourceRevisionId: null,
    });
    const zero = baseClaim({ id: "claim-zero", value: { type: "integer", value: "0" }, rawValue: "0" });
    expect(() => validateSourceClaim(missing)).not.toThrow();
    expect(() => validateSourceClaim(zero)).not.toThrow();
    expect(resolveSourceClaims([missing]).state).toBe("missing");
    expect(resolveSourceClaims([zero]).state).toBe("resolved");
  });

  it("rejects inconsistent missing shapes and non-canonical values", () => {
    expect(() => validateSourceClaim(baseClaim({ kind: "missing" }))).toThrowError(
      expect.objectContaining({ code: "MISSING_CLAIM_HAS_VALUE" }),
    );
    expect(() =>
      validateSourceClaim(baseClaim({ kind: "observed", value: { type: "missing", reason: "unknown" } })),
    ).toThrowError(expect.objectContaining({ code: "NON_MISSING_CLAIM_HAS_MISSING_VALUE" }));
    expect(() => validateSourceClaim(baseClaim({ value: { type: "integer", value: "00120" } }))).toThrowError(
      expect.objectContaining({ code: "NON_CANONICAL_CLAIM_VALUE" }),
    );
  });

  it("requires source revision lineage for observed and reported claims", () => {
    for (const kind of ["observed", "reported"] as const) {
      expect(() => validateSourceClaim(baseClaim({ kind, sourceRevisionId: null }))).toThrowError(
        expect.objectContaining({ code: "SOURCE_LINEAGE_REQUIRED" }),
      );
    }
  });

  it("requires canonical UTC claim timestamps", () => {
    expect(() => validateSourceClaim(baseClaim({ observedAt: "2026-07-13T18:30:00+09:00" }))).toThrowError(
      expect.objectContaining({ code: "NON_CANONICAL_OBSERVED_AT" }),
    );
    expect(() => validateSourceClaim(baseClaim({ effectiveAt: "2026-07-13T09:30:00.000Z" }))).not.toThrow();
  });

  it("appends without mutating prior history and resolves the latest valid revision", () => {
    const original = baseClaim();
    const prior = [original] as const;
    const revised = baseClaim({ id: "claim-b", value: { type: "integer", value: "125" }, supersedesClaimId: "claim-a" });
    const next = appendSourceClaim(prior, revised);
    expect(prior).toEqual([original]);
    expect(next).toHaveLength(2);
    const resolution = resolveSourceClaims(next);
    expect(resolution.state).toBe("resolved");
    if (resolution.state === "resolved") expect(resolution.claim.id).toBe("claim-b");
  });

  it("rejects self-supersession, missing targets, cross-scope supersession, and cycles", () => {
    expect(() => validateSourceClaim(baseClaim({ supersedesClaimId: "claim-a" }))).toThrowError(
      expect.objectContaining({ code: "SELF_SUPERSESSION" }),
    );
    expect(() => validateClaimSupersession([baseClaim({ id: "claim-b", supersedesClaimId: "not-found" })])).toThrowError(
      expect.objectContaining({ code: "SUPERSESSION_TARGET_MISSING" }),
    );
    expect(() =>
      validateClaimSupersession([
        baseClaim(),
        baseClaim({ id: "claim-b", entityId: "event-b", supersedesClaimId: "claim-a" }),
      ]),
    ).toThrowError(expect.objectContaining({ code: "SUPERSESSION_SCOPE_MISMATCH" }));
    expect(() =>
      validateClaimSupersession([
        baseClaim({ id: "claim-a", supersedesClaimId: "claim-b" }),
        baseClaim({ id: "claim-b", supersedesClaimId: "claim-a" }),
      ]),
    ).toThrowError(expect.objectContaining({ code: "SUPERSESSION_CYCLE" }));
  });

  it("keeps equal-precedence different values as an inspectable conflict", () => {
    const resolution = resolveSourceClaims([
      baseClaim({ id: "claim-a", value: { type: "integer", value: "120" } }),
      baseClaim({ id: "claim-b", value: { type: "integer", value: "125" } }),
    ]);
    expect(resolution.state).toBe("conflict");
    if (resolution.state === "conflict") expect(resolution.claims.map((claim) => claim.id)).toEqual(["claim-a", "claim-b"]);
  });

  it("collapses equal semantic evidence deterministically and never resolves rejected evidence", () => {
    const equal = resolveSourceClaims([baseClaim({ id: "claim-b" }), baseClaim({ id: "claim-a" })]);
    expect(equal.state).toBe("resolved");
    if (equal.state === "resolved") expect(equal.claim.id).toBe("claim-a");

    const original = baseClaim({ id: "claim-a" });
    const rejectedCorrection = baseClaim({
      id: "claim-b",
      status: "rejected",
      value: { type: "integer", value: "999" },
      supersedesClaimId: "claim-a",
    });
    const resolution = resolveSourceClaims([original, rejectedCorrection]);
    expect(resolution.state).toBe("resolved");
    if (resolution.state === "resolved") expect(resolution.claim.id).toBe("claim-a");
  });

  it("returns explicit conflict status as conflict even with one current claim", () => {
    const resolution = resolveSourceClaims([baseClaim({ status: "conflicting" })]);
    expect(resolution.state).toBe("conflict");
  });

  it("deduplicates exact retry identities and fails closed on an ID collision", () => {
    const claim = baseClaim();
    expect(dedupeSourceClaims([claim, structuredClone(claim)])).toEqual([claim]);
    expect(() => dedupeSourceClaims([claim, baseClaim({ value: { type: "integer", value: "121" } })])).toThrowError(
      expect.objectContaining({ code: "IDENTITY_COLLISION" }),
    );
  });
});

describe("series-market derived metric invariants", () => {
  it("requires non-empty unique input claim lineage", () => {
    expect(() => validateDerivedMetric(metric())).not.toThrow();
    expect(() => validateDerivedMetric(metric({ inputClaimIds: [] }))).toThrowError(
      expect.objectContaining({ code: "DERIVED_INPUTS_REQUIRED" }),
    );
    expect(() => validateDerivedMetric(metric({ inputClaimIds: ["claim-a", "claim-a"] }))).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_DERIVED_INPUT" }),
    );
  });
});
