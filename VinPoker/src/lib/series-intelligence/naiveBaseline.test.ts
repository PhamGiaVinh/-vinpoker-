import { describe, it, expect } from "vitest";
import { naiveBaseline, baselineDeltaPct } from "./naiveBaseline";
import { mapTournamentToEvent, type SeriesEvent } from "./nativeData";

const ev = (name: string, iso: string, entries: number | null): SeriesEvent =>
  mapTournamentToEvent(
    { id: name + iso, name, start_time: iso, buy_in: 1_000_000, rake_amount: 100_000, service_fee_amount: 0, prize_pool: null, club_id: "c" },
    { totalEntries: entries, uniqueEntries: null, reentries: null },
    null,
  );

const FCAST_DATE = "2026-07-01T19:00:00Z";

describe("naiveBaseline", () => {
  it("mean of the last 3 SAME-TYPE events before the forecast date", () => {
    const b = naiveBaseline(
      [
        ev("Main Event", "2026-03-01T19:00:00Z", 100),
        ev("Main Event", "2026-04-01T19:00:00Z", 150),
        ev("Main Event", "2026-05-01T19:00:00Z", 200),
        ev("Main Event", "2026-06-01T19:00:00Z", 160),
        ev("Turbo", "2026-06-15T19:00:00Z", 900), // different type — excluded
      ],
      "Main",
      FCAST_DATE,
    );
    expect(b.sameType).toBe(true);
    expect(b.count).toBe(3);
    // last 3 Main by date = May(200), Apr(150)… wait newest 3 = Jun160, May200, Apr150 → mean 170
    expect(b.value).toBe(170);
    expect(b.typeLabel).toBeTruthy();
  });

  it("LEAKAGE-safe: never counts events on/after the forecast date", () => {
    const b = naiveBaseline(
      [
        ev("Main Event", "2026-06-01T19:00:00Z", 100),
        ev("Main Event", FCAST_DATE, 999), // the event being forecast — must be excluded
        ev("Main Event", "2026-08-01T19:00:00Z", 999), // future — excluded
      ],
      "Main",
      FCAST_DATE,
    );
    expect(b.count).toBe(1);
    expect(b.value).toBe(100);
  });

  it("falls back to ALL types when no same-type history exists", () => {
    const b = naiveBaseline(
      [ev("Turbo", "2026-05-01T19:00:00Z", 80), ev("Bounty", "2026-06-01T19:00:00Z", 120)],
      "Main",
      FCAST_DATE,
    );
    expect(b.sameType).toBe(false);
    expect(b.typeLabel).toBeNull();
    expect(b.value).toBe(100); // mean(80,120)
  });

  it("no type keyword → all-events baseline", () => {
    const b = naiveBaseline([ev("X", "2026-05-01T19:00:00Z", 50), ev("Y", "2026-06-01T19:00:00Z", 70)], null, FCAST_DATE);
    expect(b.sameType).toBe(false);
    expect(b.value).toBe(60);
  });

  it("ignores events with no entry count", () => {
    const b = naiveBaseline([ev("Main", "2026-05-01T19:00:00Z", null), ev("Main", "2026-06-01T19:00:00Z", 140)], "Main", FCAST_DATE);
    expect(b.count).toBe(1);
    expect(b.value).toBe(140);
  });

  it("no qualifying history → null value, count 0", () => {
    const b = naiveBaseline([ev("Main", "2026-08-01T19:00:00Z", 200)], "Main", FCAST_DATE);
    expect(b.value).toBeNull();
    expect(b.count).toBe(0);
  });

  it("null beforeDate → no cutoff (uses all dated history)", () => {
    const b = naiveBaseline([ev("Main", "2026-08-01T19:00:00Z", 200)], "Main", null);
    expect(b.value).toBe(200);
  });
});

describe("baselineDeltaPct", () => {
  it("positive = model forecasts higher than the naive guess", () => {
    expect(baselineDeltaPct(170, 152)).toBe(12);
  });
  it("negative when the model is lower", () => {
    expect(baselineDeltaPct(90, 100)).toBe(-10);
  });
  it("null on missing / zero baseline", () => {
    expect(baselineDeltaPct(null, 100)).toBeNull();
    expect(baselineDeltaPct(100, null)).toBeNull();
    expect(baselineDeltaPct(100, 0)).toBeNull();
  });
});
