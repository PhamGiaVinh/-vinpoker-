import { describe, it, expect } from "vitest";
import { generateSchedule, type ScheduleInput } from "./scheduleGenerator";
import {
  DEFAULT_RULES,
  mergeRules,
  EVENT_CLASS_DEFAULTS,
  MAIN_PLACEMENT,
  type EventClass,
} from "./tdRules";

const MARQUEE: EventClass[] = ["MysteryBounty", "HighRoller", "SuperHighRoller", "PLO"];
const SIDE: EventClass[] = ["Deepstack", "Turbo", "Satellite", "Hyper"];

function mkInput(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    festivalDays: 10,
    eventsPerDay: 7,
    mainBuyIn: 20_000_000,
    mainGtdEntries: null,
    buyInTiers: [2_000_000, 5_000_000, 20_000_000, 100_000_000],
    venueCapacity: 2000,
    seasonalityOn: false,
    ...over,
  };
}
const byDay = (evs: ReturnType<typeof generateSchedule>) => {
  const m = new Map<number, number>();
  for (const e of evs) m.set(e.day, (m.get(e.day) ?? 0) + 1);
  return m;
};

describe("generateSchedule — shape & density", () => {
  it("produces ~70 events for 10 days × 7/day", () => {
    expect(generateSchedule(mkInput())).toHaveLength(70);
  });
  it("clamps eventsPerDay to [7,9]", () => {
    expect(generateSchedule(mkInput({ eventsPerDay: 5 }))).toHaveLength(70); // → 7
    expect(generateSchedule(mkInput({ eventsPerDay: 12 }))).toHaveLength(90); // → 9
  });
  it("every day's count is within [7,9]", () => {
    for (const n of byDay(generateSchedule(mkInput({ eventsPerDay: 8 }))).values()) {
      expect(n).toBeGreaterThanOrEqual(7);
      expect(n).toBeLessThanOrEqual(9);
    }
  });
});

describe("generateSchedule — placement", () => {
  it("Main on MAIN_PLACEMENT.flightDay (3), slot 0, exactly once", () => {
    const mains = generateSchedule(mkInput()).filter((e) => e.eventClass === "Main");
    expect(mains).toHaveLength(1);
    expect(mains[0].day).toBe(MAIN_PLACEMENT.flightDay);
    expect(mains[0].slot).toBe(0);
  });
  it("marquees land on distinct days, none on the Main day", () => {
    const feats = generateSchedule(mkInput()).filter((e) => e.slot === 0 && MARQUEE.includes(e.eventClass));
    const days = feats.map((e) => e.day);
    expect(new Set(days).size).toBe(days.length); // distinct
    expect(days).not.toContain(MAIN_PLACEMENT.flightDay);
  });
  it("every non-feature cell is a side-pool class", () => {
    for (const e of generateSchedule(mkInput())) {
      const isFeature = e.slot === 0 && (e.eventClass === "Main" || MARQUEE.includes(e.eventClass));
      if (!isFeature) expect(SIDE).toContain(e.eventClass);
    }
  });
});

describe("generateSchedule — capacity ceiling (HARD)", () => {
  it("every event: GTD / buy_in_prize ≤ venueCapacity", () => {
    const cap = 2000;
    for (const e of generateSchedule(mkInput({ venueCapacity: cap }))) {
      expect(e.GTD / e.buy_in_prize).toBeLessThanOrEqual(cap);
    }
  });
  it("cap bites when capacity < floor (Main floor 850 → capped to 500)", () => {
    const main = generateSchedule(mkInput({ venueCapacity: 500 })).find((e) => e.eventClass === "Main")!;
    expect(main.GTD / main.buy_in_prize).toBe(500);
  });
});

describe("generateSchedule — source labels", () => {
  it("every event has ≥ 1 source label", () => {
    for (const e of generateSchedule(mkInput())) expect(e.sourceLabels.length).toBeGreaterThan(0);
  });
  it("Main carries MAIN_PLACEMENT labels", () => {
    const main = generateSchedule(mkInput()).find((e) => e.eventClass === "Main")!;
    for (const l of MAIN_PLACEMENT.sourceLabels) expect(main.sourceLabels).toContain(l);
  });
});

describe("generateSchedule — seasonality", () => {
  it("off vs on produce different GTDs and on-events carry 'Hypothesis'", () => {
    const off = generateSchedule(mkInput({ seasonalityOn: false }));
    const on = generateSchedule(mkInput({ seasonalityOn: true }));
    expect(on.some((e, i) => e.GTD !== off[i].GTD)).toBe(true);
    for (const e of on) expect(e.sourceLabels).toContain("Hypothesis");
    for (const e of off) expect(e.sourceLabels).not.toContain("Hypothesis");
  });
});

describe("generateSchedule — determinism", () => {
  it("same input ⇒ identical output", () => {
    expect(JSON.stringify(generateSchedule(mkInput()))).toBe(JSON.stringify(generateSchedule(mkInput())));
  });
});

describe("generateSchedule — edge cases", () => {
  it("festivalDays < 3 → Main on the last day", () => {
    expect(generateSchedule(mkInput({ festivalDays: 2 })).find((e) => e.eventClass === "Main")!.day).toBe(2);
  });
  it("festivalDays === 1 → Main on day 1", () => {
    expect(generateSchedule(mkInput({ festivalDays: 1 })).find((e) => e.eventClass === "Main")!.day).toBe(1);
  });
  it("empty buyInTiers → all classes fall back to mainBuyIn", () => {
    const evs = generateSchedule(mkInput({ buyInTiers: [] }));
    for (const e of evs) expect(e.buy_in_prize).toBe(20_000_000);
  });
  it("mainGtdEntries override replaces Main floor (respecting cap)", () => {
    const main = generateSchedule(mkInput({ mainGtdEntries: 600, venueCapacity: 2000 })).find((e) => e.eventClass === "Main")!;
    expect(main.GTD / main.buy_in_prize).toBe(600);
  });
  it("Satellite GTD === 0", () => {
    const sat = generateSchedule(mkInput()).find((e) => e.eventClass === "Satellite");
    expect(sat?.GTD).toBe(0);
  });
  it("fee_rake === round(feeRatio × buy_in_prize)", () => {
    const main = generateSchedule(mkInput()).find((e) => e.eventClass === "Main")!;
    expect(main.fee_rake).toBe(Math.round(EVENT_CLASS_DEFAULTS.Main.feeRatio * main.buy_in_prize));
  });
});

describe("mergeRules", () => {
  it("no override reproduces DEFAULT_RULES", () => {
    expect(JSON.stringify(mergeRules(DEFAULT_RULES))).toBe(JSON.stringify(DEFAULT_RULES));
  });
  it("overriding one class's gtdEntriesFloor keeps its sourceLabels", () => {
    const merged = mergeRules(DEFAULT_RULES, { eventClassDefaults: { Main: { gtdEntriesFloor: 1200 } } });
    expect(merged.eventClassDefaults.Main.gtdEntriesFloor).toBe(1200);
    expect(merged.eventClassDefaults.Main.sourceLabels).toEqual(EVENT_CLASS_DEFAULTS.Main.sourceLabels);
    expect(merged.eventClassDefaults.Main.feeRatio).toBe(EVENT_CLASS_DEFAULTS.Main.feeRatio);
  });
  it("override arrays replace wholesale (not concat)", () => {
    const merged = mergeRules(DEFAULT_RULES, { eventClassDefaults: { Main: { sourceLabels: ["TD-rule"] } } });
    expect(merged.eventClassDefaults.Main.sourceLabels).toEqual(["TD-rule"]);
  });
  it("does not mutate DEFAULT_RULES", () => {
    const snap = JSON.stringify(DEFAULT_RULES);
    mergeRules(DEFAULT_RULES, { eventClassDefaults: { Main: { gtdEntriesFloor: 999 } } });
    expect(JSON.stringify(DEFAULT_RULES)).toBe(snap);
  });
});
