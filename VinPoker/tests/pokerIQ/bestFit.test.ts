// tests/pokerIQ/bestFit.test.ts — Best Fit Events structure matching.
import { describe, it, expect } from "vitest";
import {
  classifyStructure,
  computeDrillResult,
  DEMO_ANSWERS,
  DRILL_HANDS,
  rankBestFit,
  scoreEvent,
  UpcomingEvent,
} from "@/lib/pokerIQ";

// Canonical fixture → tight_solid (fit=deep, avoid=turbo), weakest=vs_aggro.
const result = computeDrillResult(DRILL_HANDS, DEMO_ANSWERS);

const ev = (id: string, partial: Partial<UpcomingEvent> = {}): UpcomingEvent => ({
  id,
  name: id,
  startTime: "2026-07-01T10:00:00.000Z",
  buyIn: 1_000_000,
  startingStack: 20000,
  minutesPerLevel: null,
  gameType: "nlh",
  location: null,
  clubName: "Club",
  ...partial,
});

describe("classifyStructure", () => {
  it("uses minutesPerLevel first", () => {
    expect(classifyStructure(ev("a", { minutesPerLevel: 30 }))).toBe("deep");
    expect(classifyStructure(ev("b", { minutesPerLevel: 8 }))).toBe("turbo");
    expect(classifyStructure(ev("c", { minutesPerLevel: 15 }))).toBe("standard");
  });
  it("falls back to startingStack when level length is missing", () => {
    expect(classifyStructure(ev("d", { minutesPerLevel: null, startingStack: 40000 }))).toBe("deep");
    expect(classifyStructure(ev("e", { minutesPerLevel: null, startingStack: 8000 }))).toBe("turbo");
    expect(classifyStructure(ev("f", { minutesPerLevel: null, startingStack: 20000 }))).toBe("standard");
  });
});

describe("scoreEvent (fit=deep, avoid=turbo, weakest=vs_aggro)", () => {
  it("marks deep events as good", () => {
    const s = scoreEvent(result, ev("deep", { minutesPerLevel: 30 }));
    expect(s.verdict).toBe("good");
    expect(s.reasonKey).toBe("fit");
  });
  it("marks turbo events as avoid with an extra weakness penalty", () => {
    const s = scoreEvent(result, ev("turbo", { minutesPerLevel: 6 }));
    expect(s.verdict).toBe("avoid");
    expect(s.score).toBeLessThan(-2);
  });
  it("marks standard events as neutral", () => {
    const s = scoreEvent(result, ev("std", { minutesPerLevel: 15 }));
    expect(s.verdict).toBe("neutral");
  });
});

describe("rankBestFit", () => {
  const events = [
    ev("turbo", { minutesPerLevel: 6, startTime: "2026-07-01T10:00:00.000Z" }),
    ev("deepA", { minutesPerLevel: 30, startTime: "2026-07-03T10:00:00.000Z" }),
    ev("std", { minutesPerLevel: 15, startTime: "2026-07-02T10:00:00.000Z" }),
    ev("deepB", { minutesPerLevel: 40, startTime: "2026-07-01T10:00:00.000Z" }),
  ];
  const r = rankBestFit(result, events);

  it("ranks deep fits first and lists turbo under avoid", () => {
    expect(r.good[0].structure).toBe("deep");
    expect(r.avoid.map((s) => s.event.id)).toContain("turbo");
  });
  it("keeps both deep events in good, with the neutral standard appended last", () => {
    const ids = r.good.map((s) => s.event.id);
    expect(ids.filter((x) => x.startsWith("deep"))).toHaveLength(2);
    expect(ids[ids.length - 1]).toBe("std");
  });
});
