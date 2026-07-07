import { describe, it, expect } from "vitest";
import { editionOf, groupByBrand } from "./editionIndex";
import { mapTournamentToEvent, type SeriesEvent } from "./nativeData";

const ev = (name: string, iso: string): SeriesEvent =>
  mapTournamentToEvent(
    { id: name + iso, name, start_time: iso, buy_in: 1_000_000, rake_amount: 100_000, service_fee_amount: 0, prize_pool: null, club_id: "c" },
    { totalEntries: 100, uniqueEntries: null, reentries: null },
    null,
  );

describe("editionOf", () => {
  const events = [
    ev("APT Main Event 2024 #1", "2024-03-01"),
    ev("APT Main Event #2", "2024-06-01"),
    ev("APT Main Event 2025", "2025-03-01"),
    ev("Turbo 500", "2024-04-01"),
  ];

  it("counts only STRICTLY-earlier same-brand editions (leakage-safe), name-normalized", () => {
    // forecasting an APT Main on 2025-06 → 3 prior APT Mains (2024-03, 2024-06, 2025-03) → edition 4
    const r = editionOf(events, "APT Main Event #4", "2025-06-01");
    expect(r.priorCount).toBe(3);
    expect(r.edition).toBe(4);
    expect(r.normalizedName).toBe("apt main event");
  });

  it("edition 1 for a brand's first event (no priors)", () => {
    const r = editionOf(events, "Brand New Series", "2026-01-01");
    expect(r.edition).toBe(1);
    expect(r.priorCount).toBe(0);
  });

  it("does NOT count same-date or future editions of the brand", () => {
    // on 2024-06-01 exactly: only the 2024-03 edition is strictly earlier
    expect(editionOf(events, "APT Main Event", "2024-06-01").priorCount).toBe(1);
  });

  it("different brand is not mixed in", () => {
    expect(editionOf(events, "Turbo 500", "2025-01-01").priorCount).toBe(1);
  });

  it("null/invalid date → no priors counted", () => {
    expect(editionOf(events, "APT Main Event", null).priorCount).toBe(0);
  });
});

describe("groupByBrand", () => {
  it("groups by normalized brand and sorts each oldest-first", () => {
    const m = groupByBrand([ev("APT Main #2", "2024-06-01"), ev("APT Main #1", "2024-03-01"), ev("Turbo", "2024-05-01")]);
    expect([...m.keys()].sort()).toEqual(["apt main", "turbo"]);
    expect(m.get("apt main")!.map((e) => e.event_date)).toEqual(["2024-03-01", "2024-06-01"]);
  });
});
