import { describe, it, expect } from "vitest";
import {
  generateSchedule,
  parseHHMM,
  formatHHMM,
  addMinutes,
  type ScheduleInput,
  type CustomScheduleEvent,
} from "./scheduleGenerator";
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
    const feats = generateSchedule(mkInput()).filter((e) => e.slot === 0 && MARQUEE.includes(e.eventClass as EventClass));
    const days = feats.map((e) => e.day);
    expect(new Set(days).size).toBe(days.length); // distinct
    expect(days).not.toContain(MAIN_PLACEMENT.flightDay);
  });
  it("every non-feature cell is a side-pool class", () => {
    for (const e of generateSchedule(mkInput())) {
      const isFeature = e.slot === 0 && (e.eventClass === "Main" || MARQUEE.includes(e.eventClass as EventClass));
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
  it("overriding a timing numeric keeps sourceLabels (arrays replace wholesale)", () => {
    const merged = mergeRules(DEFAULT_RULES, { eventClassDefaults: { Turbo: { minutesPerLevel: 25 } } });
    expect(merged.eventClassDefaults.Turbo.minutesPerLevel).toBe(25);
    expect(merged.eventClassDefaults.Turbo.sourceLabels).toEqual(EVENT_CLASS_DEFAULTS.Turbo.sourceLabels);
    expect(merged.eventClassDefaults.Turbo.startingStack).toBe(EVENT_CLASS_DEFAULTS.Turbo.startingStack);
  });
});

// ───────────────────────── PR2a: timing / stack / level / reg-end ─────────────────────────

describe("HH:MM helpers", () => {
  it("parseHHMM accepts valid, rejects malformed/out-of-range", () => {
    expect(parseHHMM("10:00")).toBe(600);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
    expect(parseHHMM("9:05")).toBe(545);
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("10:60")).toBeNull();
    expect(parseHHMM("abc")).toBeNull();
    expect(parseHHMM("10")).toBeNull();
    expect(parseHHMM("")).toBeNull();
  });
  it("formatHHMM wraps past midnight and for negatives", () => {
    expect(formatHHMM(600)).toBe("10:00");
    expect(formatHHMM(1320)).toBe("22:00");
    expect(formatHHMM(1440)).toBe("00:00");
    expect(formatHHMM(1500)).toBe("01:00");
    expect(formatHHMM(-30)).toBe("23:30");
  });
  it("addMinutes wraps; malformed base falls back to 10:00; NaN delta is 0", () => {
    expect(addMinutes("10:00", 90)).toBe("11:30");
    expect(addMinutes("22:00", 180)).toBe("01:00");
    expect(addMinutes("oops", 0)).toBe("10:00");
    expect(addMinutes("10:00", NaN)).toBe("10:00");
  });
});

describe("generateSchedule — timing fields", () => {
  it("every event carries a valid HH:MM startTime and regEndTime", () => {
    for (const e of generateSchedule(mkInput({ eventsPerDay: 9 }))) {
      expect(parseHHMM(e.startTime)).not.toBeNull();
      expect(parseHHMM(e.regEndTime)).not.toBeNull();
    }
  });
  it("startTime = firstStart + slot×interval (clock resets daily; default 10:00 / 90m)", () => {
    for (const e of generateSchedule(mkInput())) {
      expect(e.startTime).toBe(formatHHMM(600 + e.slot * 90));
    }
  });
  it("regEndTime === addMinutes(startTime, lateReg×min/level) and regEndLevel === lateRegLevel", () => {
    for (const e of generateSchedule(mkInput({ eventsPerDay: 9 }))) {
      expect(e.regEndTime).toBe(addMinutes(e.startTime, e.lateRegLevel * e.minutesPerLevel));
      expect(e.regEndLevel).toBe(e.lateRegLevel);
    }
  });
  it("stack/level/late-reg come from the class default", () => {
    const main = generateSchedule(mkInput()).find((e) => e.eventClass === "Main")!;
    expect(main.startingStack).toBe(EVENT_CLASS_DEFAULTS.Main.startingStack);
    expect(main.minutesPerLevel).toBe(EVENT_CLASS_DEFAULTS.Main.minutesPerLevel);
    expect(main.lateRegLevel).toBe(EVENT_CLASS_DEFAULTS.Main.lateRegLevel);
  });
  it("a timing override flows through and re-derives reg-end", () => {
    const evs = generateSchedule(mkInput(), { eventClassDefaults: { Main: { minutesPerLevel: 75, startingStack: 60_000 } } });
    const main = evs.find((e) => e.eventClass === "Main")!;
    expect(main.minutesPerLevel).toBe(75);
    expect(main.startingStack).toBe(60_000);
    expect(main.regEndTime).toBe(addMinutes(main.startTime, main.lateRegLevel * 75));
  });
});

describe("generateSchedule — regEndNextDay (engine-computed, not string-inferred)", () => {
  it("matches the minutes formula for every event", () => {
    for (const e of generateSchedule(mkInput({ eventsPerDay: 9 }))) {
      const expected = parseHHMM(e.startTime)! + e.lateRegLevel * e.minutesPerLevel >= 1440;
      expect(e.regEndNextDay).toBe(expected);
    }
  });
  it("a past-midnight reg-end is flagged true; an early one false", () => {
    const evs = generateSchedule(
      mkInput({
        festivalDays: 5,
        customEvents: [{ day: 2, name: "Đêm khuya", buy_in_prize: 1_000_000, fee_rake: 100_000, gtdEntries: 50, startTime: "23:30", lateRegLevel: 6, minutesPerLevel: 30 }],
      }),
    );
    const night = evs.find((e) => e.isCustom)!;
    expect(night.regEndNextDay).toBe(true); // 23:30 + 180m = 02:30
    expect(night.regEndTime).toBe("02:30");
    const main = evs.find((e) => e.eventClass === "Main")!; // 10:00 + 12×60 = 22:00 same day
    expect(main.regEndNextDay).toBe(false);
  });
});

describe("generateSchedule — custom events", () => {
  it("lands on its day, appended last, badged Custom, GTD/fee correct", () => {
    const custom: CustomScheduleEvent = { day: 4, name: "Ladies Event", buy_in_prize: 2_000_000, fee_rake: 200_000, gtdEntries: 80 };
    const evs = generateSchedule(mkInput({ festivalDays: 6, eventsPerDay: 7, customEvents: [custom] }));
    const day4 = evs.filter((e) => e.day === 4);
    const c = day4.find((e) => e.isCustom)!;
    expect(c).toBeTruthy();
    expect(c.name).toBe("Ladies Event");
    expect(c.eventClass).toBe("Custom");
    expect(c.GTD).toBe(80 * 2_000_000);
    expect(c.fee_rake).toBe(200_000);
    expect(c.sourceLabels).toEqual(["custom"]);
    expect(c.slot).toBe(7); // after 7 generated slots (0..6)
    expect(day4[day4.length - 1]).toBe(c); // appended after the generated slots
  });
  it("omitted timing falls back to 30000/30/10 and slot-computed startTime", () => {
    const evs = generateSchedule(
      mkInput({ festivalDays: 6, eventsPerDay: 7, dayFirstStart: "10:00", slotIntervalMinutes: 90, customEvents: [{ day: 1, name: "X", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 10 }] }),
    );
    const c = evs.find((e) => e.isCustom)!;
    expect(c.startingStack).toBe(30_000);
    expect(c.minutesPerLevel).toBe(30);
    expect(c.lateRegLevel).toBe(10);
    expect(c.slot).toBe(7);
    expect(c.startTime).toBe(formatHHMM(600 + 7 * 90)); // 20:30
  });
  it("out-of-range custom days are dropped", () => {
    const evs = generateSchedule(
      mkInput({
        festivalDays: 3,
        customEvents: [
          { day: 99, name: "Nope", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 1 },
          { day: 0, name: "Nope2", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 1 },
          { day: 2, name: "Yes", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 5 },
        ],
      }),
    );
    const customs = evs.filter((e) => e.isCustom);
    expect(customs).toHaveLength(1);
    expect(customs[0].name).toBe("Yes");
    expect(customs[0].day).toBe(2);
  });
  it("multiple customs on one day keep input order + contiguous slots", () => {
    const evs = generateSchedule(
      mkInput({
        festivalDays: 3,
        eventsPerDay: 7,
        customEvents: [
          { day: 2, name: "A", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 5 },
          { day: 2, name: "B", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 5 },
        ],
      }),
    );
    const customs = evs.filter((e) => e.isCustom);
    expect(customs.map((e) => e.name)).toEqual(["A", "B"]);
    expect(customs.map((e) => e.slot)).toEqual([7, 8]);
  });
  it("a custom with no GTD-entries gets GTD 0 (B.2 feed skips it honestly)", () => {
    const evs = generateSchedule(mkInput({ festivalDays: 3, customEvents: [{ day: 1, name: "Free roll", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 0 }] }));
    expect(evs.find((e) => e.isCustom)!.GTD).toBe(0);
  });
  it("determinism holds with customs", () => {
    const inp = mkInput({ customEvents: [{ day: 2, name: "Z", buy_in_prize: 1_000_000, fee_rake: 0, gtdEntries: 5 }] });
    expect(JSON.stringify(generateSchedule(inp))).toBe(JSON.stringify(generateSchedule(inp)));
  });
});

describe("generateSchedule — HH:MM edges", () => {
  it("interval 0 → every generated slot at firstStart", () => {
    for (const e of generateSchedule(mkInput({ slotIntervalMinutes: 0, dayFirstStart: "12:00" }))) {
      if (!e.isCustom) expect(e.startTime).toBe("12:00");
    }
  });
  it("invalid dayFirstStart → 10:00", () => {
    expect(generateSchedule(mkInput({ dayFirstStart: "99:99" })).find((e) => e.slot === 0)!.startTime).toBe("10:00");
  });
  it("negative interval → default 90 (slot 1 at 11:30)", () => {
    const e1 = generateSchedule(mkInput({ slotIntervalMinutes: -5 })).find((e) => e.day === 1 && e.slot === 1)!;
    expect(e1.startTime).toBe("11:30");
  });
});

describe("generateSchedule — no-custom parity", () => {
  it("customEvents:[] is byte-identical to omitting it", () => {
    expect(JSON.stringify(generateSchedule(mkInput({ customEvents: [] })))).toBe(JSON.stringify(generateSchedule(mkInput())));
  });
  it("generated events carry exactly the expected keys (no isCustom, no 'custom' label)", () => {
    const expectedKeys = [
      "GTD",
      "buy_in_prize",
      "day",
      "eventClass",
      "fee_rake",
      "lateRegLevel",
      "minutesPerLevel",
      "name",
      "regEndLevel",
      "regEndNextDay",
      "regEndTime",
      "slot",
      "sourceLabels",
      "startTime",
      "startingStack",
    ];
    for (const e of generateSchedule(mkInput())) {
      expect(Object.keys(e).sort()).toEqual(expectedKeys);
      expect(e.isCustom).toBeUndefined();
      expect(e.sourceLabels).not.toContain("custom");
    }
  });
});
