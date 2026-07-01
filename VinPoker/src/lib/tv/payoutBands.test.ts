import { describe, it, expect } from "vitest";
import { groupPayoutRows } from "./payoutBands";

const M = 1_000_000;
const row = (position: number, amount: number) => ({ position, amount });

describe("groupPayoutRows", () => {
  it("individual ladder (DAILY/INTL/CUSTOM) — no two ranks share an amount → one row per rank", () => {
    const prizes = [row(1, 10 * M), row(2, 6 * M), row(3, 4 * M)];
    const g = groupPayoutRows(prizes);
    expect(g.rows).toEqual([{ label: "1", amount: 10 * M }, { label: "2", amount: 6 * M }, { label: "3", amount: 4 * M }]);
    expect(g.truncatedCount).toBe(0);
  });

  it("LIVE_STANDARD N=19 — ranks 1-9 individual, 10-12/13-15/16-19 grouped into ONE row each", () => {
    const prizes = [
      ...[49.1, 27.5, 19.4, 14.9, 12.1, 10, 8.5, 7.4, 6.4].map((v, i) => row(i + 1, v * M)),
      ...[10, 11, 12].map((p) => row(p, 5 * M)),
      ...[13, 14, 15].map((p) => row(p, 3.5 * M)),
      ...[16, 17, 18, 19].map((p) => row(p, 2.3 * M)),
    ];
    const g = groupPayoutRows(prizes, 15);
    expect(g.rows.length).toBe(12); // 9 individual + 3 bands
    expect(g.rows.slice(0, 9).map((r) => r.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(g.rows[9]).toEqual({ label: "10–12", amount: 5 * M });
    expect(g.rows[10]).toEqual({ label: "13–15", amount: 3.5 * M });
    expect(g.rows[11]).toEqual({ label: "16–19", amount: 2.3 * M });
    expect(g.truncatedCount).toBe(0);
  });

  it("truncates beyond maxRows and reports the count", () => {
    const prizes = Array.from({ length: 30 }, (_, i) => row(i + 1, (30 - i) * M)); // all distinct amounts
    const g = groupPayoutRows(prizes, 15);
    expect(g.rows.length).toBe(15);
    expect(g.truncatedCount).toBe(15);
  });

  it("a position GAP never merges, even with equal amounts (safety — can't hide a missing rank)", () => {
    const prizes = [row(1, 5 * M), row(3, 5 * M)]; // rank 2 missing
    const g = groupPayoutRows(prizes);
    expect(g.rows).toEqual([{ label: "1", amount: 5 * M }, { label: "3", amount: 5 * M }]);
  });

  it("sorts by position regardless of input order", () => {
    const prizes = [row(3, 1 * M), row(1, 3 * M), row(2, 2 * M)];
    const g = groupPayoutRows(prizes);
    expect(g.rows.map((r) => r.label)).toEqual(["1", "2", "3"]);
  });

  it("empty input → empty rows, no truncation", () => {
    const g = groupPayoutRows([]);
    expect(g.rows).toEqual([]);
    expect(g.truncatedCount).toBe(0);
  });
});
