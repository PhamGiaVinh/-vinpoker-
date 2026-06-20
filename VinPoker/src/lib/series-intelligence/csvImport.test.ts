import { describe, it, expect } from "vitest";
import {
  parseSeriesCsv,
  parseVnNumber,
  parseEventDate,
  SAMPLE_CSV_TEXT,
  CSV_REQUIRED_COLUMNS,
} from "./csvImport";

describe("parseVnNumber", () => {
  it("reads plain + dot/comma-separated VND integers", () => {
    expect(parseVnNumber("1000000")).toBe(1_000_000);
    expect(parseVnNumber("1.000.000")).toBe(1_000_000);
    expect(parseVnNumber("1,000,000")).toBe(1_000_000);
    expect(parseVnNumber(" 500 000 ")).toBe(500_000);
  });
  it("empty / unreadable → null (never guessed)", () => {
    expect(parseVnNumber("")).toBeNull();
    expect(parseVnNumber("   ")).toBeNull();
    expect(parseVnNumber(null)).toBeNull();
    expect(parseVnNumber(undefined)).toBeNull();
    expect(parseVnNumber("abc")).toBeNull();
    expect(parseVnNumber("-")).toBeNull();
  });
  it("keeps zero distinct from missing", () => {
    expect(parseVnNumber("0")).toBe(0);
  });
});

describe("parseEventDate", () => {
  it("accepts ISO and normalizes to yyyy-mm-dd", () => {
    expect(parseEventDate("2026-06-15")).toBe("2026-06-15");
    expect(parseEventDate("2026-06-15T11:00:00Z")).toBe("2026-06-15");
  });
  it("accepts dd/mm/yyyy and dd-mm-yyyy", () => {
    expect(parseEventDate("15/06/2026")).toBe("2026-06-15");
    expect(parseEventDate("5-6-2026")).toBe("2026-06-05");
  });
  it("rejects out-of-range / garbage → null", () => {
    expect(parseEventDate("2026-13-40")).toBeNull();
    expect(parseEventDate("not a date")).toBeNull();
    expect(parseEventDate("")).toBeNull();
    expect(parseEventDate(null)).toBeNull();
  });
});

describe("parseSeriesCsv — happy path", () => {
  it("parses the bundled SAMPLE_CSV_TEXT into 3 csv-source events", () => {
    const r = parseSeriesCsv(SAMPLE_CSV_TEXT);
    expect(r.errors).toEqual([]);
    expect(r.totalRows).toBe(3);
    expect(r.events).toHaveLength(3);
    expect(r.events.every((e) => e.source === "csv")).toBe(true);
    expect(r.events.every((e) => e.clubId === "csv-test")).toBe(true);

    const first = r.events[0];
    expect(first.event_name).toBe("Sunday Major");
    expect(first.event_date).toBe("2026-06-15");
    expect(first.buy_in).toBe(1_000_000);
    expect(first.fee).toBe(100_000);
    expect(first.gtd).toBe(300_000_000);
    expect(first.prize_pool_actual).toBe(250_000_000);
    expect(first.total_entries).toBe(300);
    expect(first.event_id).toBe("csv-1"); // synthesized when no event_id column
  });

  it("the sample header is exactly the documented required columns", () => {
    expect(SAMPLE_CSV_TEXT.split("\n")[0]).toBe(CSV_REQUIRED_COLUMNS.join(","));
  });
});

describe("parseSeriesCsv — honesty: missing cells/columns → null + reported, never faked", () => {
  it("empty gtd/prize cells become null and land in missingFields", () => {
    const r = parseSeriesCsv(SAMPLE_CSV_TEXT);
    const deepstack = r.events[2]; // gtd + prize_pool_actual empty
    expect(deepstack.gtd).toBeNull();
    expect(deepstack.prize_pool_actual).toBeNull();
    expect(deepstack.missingFields).toContain("gtd");
    expect(deepstack.missingFields).toContain("prize_pool_actual");
    expect(deepstack.reentries).toBe(0); // 0 is NOT missing
    expect(deepstack.missingFields).not.toContain("reentries");
  });

  it("a documented column absent from the header → that field null for all rows (no error)", () => {
    const csv = ["event_name,event_date,buy_in", "X,2026-01-01,1000000"].join("\n");
    const r = parseSeriesCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.events[0].gtd).toBeNull();
    expect(r.events[0].total_entries).toBeNull();
    expect(r.events[0].missingFields).toEqual(
      expect.arrayContaining(["gtd", "fee", "prize_pool_actual", "total_entries"]),
    );
  });

  it("present-but-unreadable numeric cell → null + a recorded error", () => {
    const csv = [CSV_REQUIRED_COLUMNS.join(","), "X,2026-01-01,abc,0,0,0,0,0,0"].join("\n");
    const r = parseSeriesCsv(csv);
    expect(r.events[0].buy_in).toBeNull();
    expect(r.errors).toEqual([
      expect.objectContaining({ row: 1, column: "buy_in", message: expect.stringContaining("abc") }),
    ]);
  });

  it("invalid date cell → null + recorded error", () => {
    const csv = [CSV_REQUIRED_COLUMNS.join(","), "X,2026-99-99,1,1,1,1,1,1,1"].join("\n");
    const r = parseSeriesCsv(csv);
    expect(r.events[0].event_date).toBeNull();
    expect(r.errors.some((e) => e.column === "event_date")).toBe(true);
  });
});

describe("parseSeriesCsv — robustness", () => {
  it("handles BOM, CRLF, blank lines, and trailing newline", () => {
    const csv = "﻿" + ["event_name,buy_in", "", "Alpha,1000000", "", ""].join("\r\n");
    const r = parseSeriesCsv(csv);
    expect(r.totalRows).toBe(1);
    expect(r.events[0].event_name).toBe("Alpha");
    expect(r.events[0].buy_in).toBe(1_000_000);
  });

  it("handles quoted fields with embedded commas", () => {
    const csv = ["event_name,buy_in", '"Major, Day 1",2000000'].join("\n");
    const r = parseSeriesCsv(csv);
    expect(r.events[0].event_name).toBe("Major, Day 1");
    expect(r.events[0].buy_in).toBe(2_000_000);
  });

  it("honors an explicit event_id column and maps service_fee", () => {
    const csv = ["event_id,event_name,service_fee", "EV-7,Named,250000"].join("\n");
    const r = parseSeriesCsv(csv);
    expect(r.events[0].event_id).toBe("EV-7");
    expect(r.events[0].serviceFeeAmount).toBe(250_000);
  });

  it("empty file → no events + a file-level error", () => {
    const r = parseSeriesCsv("   \n  \n");
    expect(r.events).toEqual([]);
    expect(r.errors[0].row).toBe(0);
  });

  it("header with no recognized columns → file-level error, no events", () => {
    const r = parseSeriesCsv(["foo,bar,baz", "1,2,3"].join("\n"));
    expect(r.events).toEqual([]);
    expect(r.errors[0].message).toMatch(/không nhận diện/i);
  });

  it("is deterministic — same input ⇒ identical output", () => {
    expect(JSON.stringify(parseSeriesCsv(SAMPLE_CSV_TEXT))).toBe(JSON.stringify(parseSeriesCsv(SAMPLE_CSV_TEXT)));
  });
});
