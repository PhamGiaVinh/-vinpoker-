import { describe, it, expect } from "vitest";
import { mapTournamentToEvent, type NativeTournamentRow, type SeriesEvent } from "./nativeData";
import { computeGtdOverlay } from "./gtdOverlay";

/** Build a SeriesEvent with an explicit committed GTD (3rd adapter arg) + entry counts. */
function ev(
  row: Partial<NativeTournamentRow>,
  counts?: { totalEntries?: number | null },
  gtd?: number | null,
): SeriesEvent {
  const pick = <K extends keyof NativeTournamentRow>(k: K, dflt: NativeTournamentRow[K]): NativeTournamentRow[K] =>
    k in row ? (row[k] as NativeTournamentRow[K]) : dflt;
  const base: NativeTournamentRow = {
    id: pick("id", "t1"),
    name: pick("name", "Event"),
    start_time: pick("start_time", "2026-05-01T11:00:00Z"),
    buy_in: pick("buy_in", 1_000_000),
    rake_amount: pick("rake_amount", 100_000),
    service_fee_amount: pick("service_fee_amount", 0),
    prize_pool: pick("prize_pool", 0),
    club_id: pick("club_id", "club-A"),
  };
  return mapTournamentToEvent(base, { totalEntries: counts?.totalEntries ?? null, uniqueEntries: null, reentries: null }, gtd ?? null);
}

describe("computeGtdOverlay", () => {
  it("unavailable when no event has a committed GTD", () => {
    const r = computeGtdOverlay([ev({ id: "a" }, { totalEntries: 50 }, null)]);
    expect(r.available).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it("includes only events with a committed GTD", () => {
    const r = computeGtdOverlay([
      ev({ id: "no-gtd" }, { totalEntries: 50 }, null),
      ev({ id: "has-gtd" }, { totalEntries: 50 }, 300_000_000),
    ]);
    expect(r.available).toBe(true);
    expect(r.rows.map((x) => x.event_id)).toEqual(["has-gtd"]);
  });

  it("overlay = max(0, gtd − entries×buy_in) when estimate < GTD (not covered)", () => {
    // 100 entries × 1,000,000 = 100,000,000 estimate vs GTD 300,000,000 → overlay 200,000,000
    const r = computeGtdOverlay([ev({ id: "a", buy_in: 1_000_000 }, { totalEntries: 100 }, 300_000_000)]);
    const row = r.rows[0];
    expect(row.estimatedActual).toBe(100_000_000);
    expect(row.overlay).toBe(200_000_000);
    expect(row.covered).toBe(false);
  });

  it("overlay clamps to 0 and covered=true when estimate ≥ GTD", () => {
    // 400 × 1,000,000 = 400,000,000 ≥ GTD 300,000,000 → overlay 0, covered
    const r = computeGtdOverlay([ev({ id: "a", buy_in: 1_000_000 }, { totalEntries: 400 }, 300_000_000)]);
    const row = r.rows[0];
    expect(row.estimatedActual).toBe(400_000_000);
    expect(row.overlay).toBe(0);
    expect(row.covered).toBe(true);
  });

  it("degrades to null estimate/overlay when entries or buy_in missing (no fabrication)", () => {
    const r1 = computeGtdOverlay([ev({ id: "a" }, { totalEntries: null }, 300_000_000)]);
    expect(r1.rows[0].estimatedActual).toBeNull();
    expect(r1.rows[0].overlay).toBeNull();
    expect(r1.rows[0].covered).toBeNull();
    const r2 = computeGtdOverlay([ev({ id: "b", buy_in: null }, { totalEntries: 100 }, 300_000_000)]);
    expect(r2.rows[0].estimatedActual).toBeNull();
  });

  it("does not use prize_pool, and never claims actual collected", () => {
    // prize_pool is a large stored value but must be ignored; estimate comes from entries×buy_in.
    const r = computeGtdOverlay([ev({ id: "a", buy_in: 1_000_000, prize_pool: 999_000_000 }, { totalEntries: 10 }, 50_000_000)]);
    expect(r.rows[0].estimatedActual).toBe(10_000_000); // 10 × 1,000,000, NOT prize_pool
    expect(r.disclaimer).toMatch(/ước tính/i);
    expect(r.disclaimer).toContain("KHÔNG phải prize pool thực thu");
    const s = JSON.stringify(r);
    expect(s).not.toContain("Model Estimate");
    expect(s).not.toContain("Tested Finding");
  });

  it("deterministic — same input ⇒ identical output", () => {
    const events = [ev({ id: "a" }, { totalEntries: 120 }, 300_000_000)];
    expect(JSON.stringify(computeGtdOverlay(events))).toBe(JSON.stringify(computeGtdOverlay(events)));
  });
});
