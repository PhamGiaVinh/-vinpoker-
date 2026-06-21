import { describe, it, expect } from "vitest";
import type { ScheduleEvent } from "./scheduleGenerator";
import { generateSchedule } from "./scheduleGenerator";
import { simulateFestival } from "./monteCarloEngine";
import {
  scheduleEventToLogNormal,
  scheduleToSimEvents,
  SCHEDULE_HYPOTHESIS_SIGMA,
} from "./scheduleToMonteCarlo";

function schedEvt(over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    day: 1,
    slot: 0,
    name: "Main Event",
    eventClass: "Main",
    buy_in_prize: 20_000_000,
    fee_rake: 2_900_000,
    GTD: 17_000_000_000, // 850 × 20m
    sourceLabels: ["2-series"],
    ...over,
  };
}

describe("scheduleEventToLogNormal", () => {
  it("maps GTD-floor → log-normal: μ=ln(GTD/buy_in), lowEntries=floor, hypothesis tier, wide σ", () => {
    const ln = scheduleEventToLogNormal(schedEvt())!;
    expect(ln.lowEntries).toBe(850); // 17b / 20m
    expect(ln.mu).toBeCloseTo(Math.log(850), 9);
    expect(ln.sigma).toBe(SCHEDULE_HYPOTHESIS_SIGMA);
    expect(ln.tier).toBe("hypothesis");
    expect(ln.fee).toBe(2_900_000);
    expect(ln.buyin).toBe(20_000_000);
  });

  it("identity: engine safeGTD (lowEntries × buyin) reproduces the schedule GTD exactly", () => {
    const ev = schedEvt({ GTD: 9_000_000_000, buy_in_prize: 5_000_000 }); // 1800 entries
    const ln = scheduleEventToLogNormal(ev)!;
    expect(ln.lowEntries * ln.buyin).toBe(ev.GTD);
  });

  it("skips events with no GTD (Satellite) or non-positive buy-in", () => {
    expect(scheduleEventToLogNormal(schedEvt({ GTD: 0, eventClass: "Satellite" }))).toBeNull();
    expect(scheduleEventToLogNormal(schedEvt({ buy_in_prize: 0 }))).toBeNull();
  });
});

describe("scheduleToSimEvents", () => {
  it("maps a generated schedule, skipping the no-GTD events", () => {
    const schedule = generateSchedule({
      festivalDays: 10,
      eventsPerDay: 7,
      mainBuyIn: 20_000_000,
      mainGtdEntries: null,
      buyInTiers: [2_000_000, 5_000_000, 20_000_000, 100_000_000],
      venueCapacity: 2000,
      seasonalityOn: false,
    });
    const { events, skipped } = scheduleToSimEvents(schedule);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length + skipped.length).toBe(schedule.length);
    expect(events.every((e) => e.tier === "hypothesis")).toBe(true);
    // Satellites (GTD 0) are skipped
    const satellites = schedule.filter((e) => e.eventClass === "Satellite").length;
    expect(skipped.length).toBeGreaterThanOrEqual(satellites);
  });

  it("the mapped events feed simulateFestival → a usable hypothesis-tier result", () => {
    const schedule = generateSchedule({
      festivalDays: 5,
      eventsPerDay: 7,
      mainBuyIn: 20_000_000,
      mainGtdEntries: null,
      buyInTiers: [2_000_000, 20_000_000],
      venueCapacity: 1500,
      seasonalityOn: false,
    });
    const { events } = scheduleToSimEvents(schedule);
    const result = simulateFestival(events, { rho: 0.3, alpha: 1, nSims: 5000, seed: 42 });
    expect(result.usable).toBe(true);
    expect(result.aggregateTier).toBe("hypothesis"); // generated ⇒ always hypothesis
    expect(Number.isFinite(result.eGross)).toBe(true);
  });
});
