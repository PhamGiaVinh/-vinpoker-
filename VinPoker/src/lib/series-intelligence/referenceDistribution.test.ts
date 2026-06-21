import { describe, it, expect } from "vitest";
import type { SeriesEvent } from "./nativeData";
import type { Series } from "./seriesLibrary";
import {
  normalizeEventName,
  groupEvents,
  computeGroupStats,
  confidenceTier,
  obsKeyOf,
} from "./referenceDistribution";

function evt(name: string | null, over: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: "csv-1",
    event_name: name,
    event_date: "2026-06-15",
    buy_in: 1_000_000,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries: 100,
    unique_entries: null,
    reentries: null,
    source: "csv",
    clubId: "csv-test",
    missingFields: [],
    ...over,
  };
}

function series(id: string, name: string, events: SeriesEvent[]): Series {
  return { id, name, seriesDate: null, sourceFilename: `${id}.csv`, events, loadedAt: 1 };
}

describe("normalizeEventName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeEventName("  Sunday   Major  ")).toBe("sunday major");
  });
  it("strips a trailing 4-digit year", () => {
    expect(normalizeEventName("APT Phú Quốc 2024")).toBe("apt phú quốc");
    expect(normalizeEventName("Main Event 1999")).toBe("main event");
  });
  it("strips a trailing #N", () => {
    expect(normalizeEventName("Main Event #5")).toBe("main event");
    expect(normalizeEventName("Highroller # 12")).toBe("highroller");
  });
  it("strips season/series/mùa/vol/lần + number", () => {
    expect(normalizeEventName("WSOP Season 3")).toBe("wsop");
    expect(normalizeEventName("Giải Mùa 2")).toBe("giải");
    expect(normalizeEventName("Festival Vol.4")).toBe("festival");
    expect(normalizeEventName("Cup Lần 5")).toBe("cup");
  });
  it("strips MULTIPLE trailing tokens", () => {
    expect(normalizeEventName("APT Main Event 2024 #5")).toBe("apt main event");
  });
  it("does NOT strip a bare standalone trailing number", () => {
    expect(normalizeEventName("Event 2")).toBe("event 2");
    expect(normalizeEventName("Flight 1")).toBe("flight 1");
    expect(normalizeEventName("Day 3")).toBe("day 3");
  });
  it("does NOT strip a keyword with no number", () => {
    expect(normalizeEventName("WSOP Series")).toBe("wsop series");
  });
  it("handles null/empty", () => {
    expect(normalizeEventName(null)).toBe("");
    expect(normalizeEventName("   ")).toBe("");
  });
});

describe("groupEvents", () => {
  it("groups the same tournament across series (N=2) and keeps singletons (N=1)", () => {
    const lib = [
      series("a", "APT 2023", [evt("Sunday Major 2023"), evt("Mystery Bounty")]),
      series("b", "APT 2024", [evt("Sunday Major 2024")]),
    ];
    const groups = groupEvents(lib);
    const major = groups.find((g) => g.normalizedName === "sunday major");
    const bounty = groups.find((g) => g.normalizedName === "mystery bounty");
    expect(major?.n).toBe(2);
    expect(major?.members.map((m) => m.seriesName).sort()).toEqual(["APT 2023", "APT 2024"]);
    expect(bounty?.n).toBe(1);
  });

  it("is deterministic and ordered by N desc", () => {
    const lib = [
      series("a", "S1", [evt("Main 2023"), evt("Side")]),
      series("b", "S2", [evt("Main 2024")]),
    ];
    const groups = groupEvents(lib);
    expect(groups[0].normalizedName).toBe("main"); // N=2 first
    expect(JSON.stringify(groupEvents(lib))).toBe(JSON.stringify(groups)); // deterministic
  });

  it("unnamed events fall into a single (không tên) group, not fabricated", () => {
    const groups = groupEvents([series("a", "S", [evt(null), evt("   ")])]);
    const unnamed = groups.find((g) => g.normalizedName === "");
    expect(unnamed?.n).toBe(2);
    expect(unnamed?.displayName).toBe("(không tên)");
  });
});

describe("computeGroupStats", () => {
  it("N<5 uses min/median/max and the right tier", () => {
    const lib = [
      series("a", "S1", [evt("Major 2021", { total_entries: 100, buy_in: 1_000_000, fee: 100_000 })]),
      series("b", "S2", [evt("Major 2022", { total_entries: 200, buy_in: 1_200_000, fee: 100_000 })]),
      series("c", "S3", [evt("Major 2023", { total_entries: 300, buy_in: 1_000_000, fee: 120_000 })]),
    ];
    const g = groupEvents(lib).find((x) => x.normalizedName === "major")!;
    const s = computeGroupStats(g);
    expect(s.n).toBe(3);
    expect(s.method).toBe("minmax");
    expect(s.entries).toEqual({ low: 100, base: 200, high: 300 });
    expect(s.medianBuyIn).toBe(1_000_000);
    expect(s.medianFee).toBe(100_000);
    expect(s.tier).toEqual({ level: "trung bình", basis: "Quan sát min-max" });
  });

  it("N≥5 switches to p20/p80", () => {
    const events = [10, 20, 30, 40, 50].map((n, i) => evt(`Major ${2019 + i}`, { total_entries: n * 10 }));
    const lib = events.map((e, i) => series(`s${i}`, `S${i}`, [e]));
    const g = groupEvents(lib).find((x) => x.normalizedName === "major")!;
    const s = computeGroupStats(g);
    expect(s.n).toBe(5);
    expect(s.method).toBe("p20p80");
    expect(s.entries.base).toBe(300); // median of 100..500
    expect(s.entries.low).toBe(180); // p20 of [100,200,300,400,500]
    expect(s.entries.high).toBe(420); // p80
    expect(s.tier.level).toBe("cao");
  });

  it("missing entries → null range (never fabricated)", () => {
    const g = groupEvents([series("a", "S", [evt("X", { total_entries: null })])]).find(
      (x) => x.normalizedName === "x",
    )!;
    const s = computeGroupStats(g);
    expect(s.entries).toEqual({ low: null, base: null, high: null });
  });
});

describe("confidenceTier boundaries", () => {
  it("N=1 → Giả thuyết (thấp); N=2..4 → min-max (trung bình); N≥5 → p20-p80 (cao)", () => {
    expect(confidenceTier(1)).toEqual({ level: "thấp", basis: "Giả thuyết" });
    expect(confidenceTier(2).level).toBe("trung bình");
    expect(confidenceTier(4).level).toBe("trung bình");
    expect(confidenceTier(5)).toEqual({ level: "cao", basis: "Quan sát p20-p80" });
  });
});

describe("groupEvents — manual overrides (PATCH 2.5)", () => {
  it("no overrides reproduces the auto grouping exactly", () => {
    const lib = [series("a", "S1", [evt("Main 2023", { event_id: "csv-1" })]), series("b", "S2", [evt("Side", { event_id: "csv-1" })])];
    expect(JSON.stringify(groupEvents(lib))).toBe(JSON.stringify(groupEvents(lib, {})));
  });

  it("each observation carries a stable obsKey + isOverridden=false by default", () => {
    const g = groupEvents([series("a", "S1", [evt("X", { event_id: "csv-1" })])])[0];
    expect(g.members[0].obsKey).toBe(obsKeyOf("a", "csv-1"));
    expect(g.members[0].isOverridden).toBe(false);
    expect(g.isOverridden).toBe(false);
  });

  it("MERGE: a shared label pulls two differently-named events into one group", () => {
    const lib = [
      series("a", "S1", [evt("Sunday Major", { event_id: "csv-1", total_entries: 100 })]),
      series("b", "S2", [evt("Chủ Nhật Lớn", { event_id: "csv-1", total_entries: 200 })]), // different spelling
    ];
    expect(groupEvents(lib)).toHaveLength(2); // auto: two separate groups
    const labels = { [obsKeyOf("a", "csv-1")]: "manual::x", [obsKeyOf("b", "csv-1")]: "manual::x" };
    const merged = groupEvents(lib, labels);
    expect(merged).toHaveLength(1);
    expect(merged[0].n).toBe(2);
    expect(merged[0].isOverridden).toBe(true);
    expect(merged[0].members.every((m) => m.isOverridden)).toBe(true);
  });

  it("SPLIT: labelling one member of an auto group pulls it into its own group", () => {
    const lib = [
      series("a", "S1", [evt("Main 2023", { event_id: "csv-1" })]),
      series("b", "S2", [evt("Main 2024", { event_id: "csv-1" })]),
    ];
    expect(groupEvents(lib)).toHaveLength(1); // auto: both → "main"
    const split = groupEvents(lib, { [obsKeyOf("b", "csv-1")]: "manual::solo" });
    expect(split).toHaveLength(2); // b pulled out
    const solo = split.find((g) => g.normalizedName === "manual::solo")!;
    expect(solo.n).toBe(1);
    expect(solo.isOverridden).toBe(true);
  });
});
