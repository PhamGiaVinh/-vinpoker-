import { describe, expect, it } from "vitest";
import {
  bigBlindsOf,
  formatBlinds,
  formatChips,
  formatClock,
  formatVndCompact,
} from "./format";

describe("formatClock", () => {
  it("formats minutes and seconds with padding", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59)).toBe("00:59");
    expect(formatClock(60)).toBe("01:00");
    expect(formatClock(23 * 60 + 41)).toBe("23:41");
  });

  it("switches to H:MM:SS from one hour up", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
    expect(formatClock(2 * 3600 + 55 * 60 + 9)).toBe("2:55:09");
  });

  it("clamps negatives to 00:00 and floors fractions", () => {
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(61.9)).toBe("01:01");
  });
});

describe("formatChips", () => {
  it("groups digits with dots", () => {
    expect(formatChips(0)).toBe("0");
    expect(formatChips(200)).toBe("200");
    expect(formatChips(2000)).toBe("2.000");
    expect(formatChips(48500)).toBe("48.500");
    expect(formatChips(1234567)).toBe("1.234.567");
  });

  it("keeps the sign", () => {
    expect(formatChips(-48500)).toBe("-48.500");
  });
});

describe("formatVndCompact", () => {
  it("formats millions with Tr and comma decimal", () => {
    expect(formatVndCompact(97_000_000)).toBe("97Tr");
    expect(formatVndCompact(87_300_000)).toBe("87,3Tr");
    expect(formatVndCompact(1_500_000)).toBe("1,5Tr");
  });

  it("formats billions with Tỷ", () => {
    expect(formatVndCompact(1_500_000_000)).toBe("1,5Tỷ");
    expect(formatVndCompact(2_000_000_000)).toBe("2Tỷ");
  });

  it("formats thousands with K and passes small values through", () => {
    expect(formatVndCompact(500_000)).toBe("500K");
    expect(formatVndCompact(950)).toBe("950");
  });

  it("rounds to one decimal", () => {
    expect(formatVndCompact(87_350_000)).toBe("87,4Tr");
    expect(formatVndCompact(87_040_000)).toBe("87Tr");
  });

  it("keeps the sign", () => {
    expect(formatVndCompact(-87_300_000)).toBe("-87,3Tr");
  });
});

describe("bigBlindsOf", () => {
  it("rounds stack-in-big-blinds", () => {
    expect(bigBlindsOf(48500, 2000)).toBe(24);
    expect(bigBlindsOf(50000, 2000)).toBe(25);
  });

  it("returns null when big blind is unusable", () => {
    expect(bigBlindsOf(48500, 0)).toBeNull();
    expect(bigBlindsOf(48500, null)).toBeNull();
    expect(bigBlindsOf(48500, undefined)).toBeNull();
  });
});

describe("formatBlinds", () => {
  it("formats the pair with grouping", () => {
    expect(formatBlinds(100, 200)).toBe("100/200");
    expect(formatBlinds(1000, 2000)).toBe("1.000/2.000");
  });
});
