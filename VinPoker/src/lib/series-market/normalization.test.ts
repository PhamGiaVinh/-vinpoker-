import { describe, expect, it } from "vitest";
import {
  canonicalStringSet,
  normalizeClaimValue,
  normalizeCurrency,
  normalizeDecimalString,
  normalizeInstant,
  normalizeIntegerString,
  normalizeLocalDate,
  normalizeMoneyValue,
  normalizePartialLocalDateTime,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";

describe("series-market canonical scalar normalization", () => {
  it("canonicalizes integer and decimal strings without floating-point conversion", () => {
    expect(normalizeIntegerString("+000123")).toBe("123");
    expect(normalizeIntegerString("-000123")).toBe("-123");
    expect(normalizeIntegerString("-000")).toBe("0");
    expect(normalizeDecimalString("+0012.3400")).toBe("12.34");
    expect(normalizeDecimalString("-.5000")).toBe("-0.5");
    expect(normalizeDecimalString("-0.000")).toBe("0");
    expect(() => normalizeIntegerString("1.2")).toThrow(SeriesMarketValidationError);
    expect(() => normalizeDecimalString("1e3")).toThrow(SeriesMarketValidationError);
  });

  it("normalizes money as integer minor units plus currency and scale", () => {
    expect(normalizeMoneyValue({ minorUnits: "0012500", currency: " krw ", scale: 0 })).toEqual({
      type: "money",
      minorUnits: "12500",
      currency: "KRW",
      scale: 0,
    });
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(() => normalizeMoneyValue({ minorUnits: "12.5", currency: "USD", scale: 2 })).toThrowError(
      expect.objectContaining({ code: "INVALID_INTEGER" }),
    );
    expect(() => normalizeMoneyValue({ minorUnits: "1250", currency: "US", scale: 2 })).toThrowError(
      expect.objectContaining({ code: "INVALID_CURRENCY" }),
    );
    expect(() => normalizeMoneyValue({ minorUnits: "1250", currency: "USD", scale: 1.5 })).toThrowError(
      expect.objectContaining({ code: "INVALID_MONEY_SCALE" }),
    );
  });

  it("keeps explicit zero distinct from an explicit missing value", () => {
    expect(normalizeClaimValue({ type: "integer", value: "000" })).toEqual({ type: "integer", value: "0" });
    expect(normalizeClaimValue({ type: "missing", reason: "not_disclosed" })).toEqual({
      type: "missing",
      reason: "not_disclosed",
    });
    expect(normalizeClaimValue({ type: "integer", value: "000" })).not.toEqual(
      normalizeClaimValue({ type: "missing", reason: "not_disclosed" }),
    );
  });

  it("validates real local dates and preserves partial local time with IANA zone and precision", () => {
    expect(normalizeLocalDate("2028-02-29")).toEqual({ type: "local_date", value: "2028-02-29" });
    expect(() => normalizeLocalDate("2027-02-29")).toThrowError(expect.objectContaining({ code: "INVALID_LOCAL_DATE" }));
    expect(
      normalizePartialLocalDateTime({ local: "2026-07-13T18:30", timeZone: "Asia/Seoul", precision: "minute" }),
    ).toEqual({
      type: "partial_local_datetime",
      local: "2026-07-13T18:30",
      timeZone: "Asia/Seoul",
      precision: "minute",
    });
    expect(() =>
      normalizePartialLocalDateTime({ local: "2026-07-13T18:30:00", timeZone: "Asia/Seoul", precision: "minute" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PARTIAL_LOCAL_TIME" }));
    expect(() =>
      normalizePartialLocalDateTime({ local: "2026-07-13T18:30", timeZone: "Not/AZone", precision: "minute" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TIME_ZONE" }));
  });

  it("creates UTC only from a complete instant carrying an explicit offset", () => {
    expect(normalizeInstant("2026-07-13T18:30:00+09:00")).toBe("2026-07-13T09:30:00.000Z");
    expect(normalizeInstant("2026-07-13T09:30:00Z")).toBe("2026-07-13T09:30:00.000Z");
    expect(() => normalizeInstant("2026-07-13T18:30:00")).toThrowError(
      expect.objectContaining({ code: "INSTANT_OFFSET_REQUIRED" }),
    );
  });

  it("uses locale-independent stable keys and sorted semantic sets", () => {
    expect(normalizeStableKey("  JeJu.Main-Event_1  ")).toBe("jeju.main-event_1");
    expect(canonicalStringSet(["z", "a", "z", "b"])).toEqual(["a", "b", "z"]);
    expect(() => normalizeStableKey("Jeju Main")).toThrowError(expect.objectContaining({ code: "INVALID_STABLE_KEY" }));
  });

  it("returns a fresh normalized claim value without mutating caller input", () => {
    const input = { type: "money", minorUnits: "+00100", currency: "usd", scale: 2 } as const;
    const before = structuredClone(input);
    const output = normalizeClaimValue(input);
    expect(input).toEqual(before);
    expect(output).toEqual({ type: "money", minorUnits: "100", currency: "USD", scale: 2 });
    expect(output).not.toBe(input);
  });
});
