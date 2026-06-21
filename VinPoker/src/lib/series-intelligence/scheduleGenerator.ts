// Series Intelligence — Forward layer: festival schedule generator (PATCH B, PURE, client-only).
//
// Generates a DRAFT skeleton festival schedule from a small form input + the source-labeled, editable
// TD-rule defaults (tdRules.ts). FULLY DETERMINISTIC (no Math.random / Date). It is a planning aid — a
// draft the owner's TD reviews/edits — NOT a committed schedule, NOT financial, NOT DB. Each event carries
// {name, eventClass, buy_in_prize, fee_rake, GTD} so a LATER adapter (B.2) can feed the Monte Carlo engine;
// no such feed here. All money is computed by formula from the (labeled, editable) rules.

import {
  DEFAULT_RULES,
  mergeRules,
  type EventClass,
  type RulesOverride,
  type TdRules,
} from "./tdRules";

export interface ScheduleInput {
  festivalDays: number;
  eventsPerDay: number;
  mainBuyIn: number;
  mainGtdEntries?: number | null; // override Main's entries floor (still capped by venueCapacity)
  buyInTiers: number[];
  venueCapacity: number; // MAX committed-entries ceiling for ONE event (a GTD-risk ceiling) — NOT seats
  seasonalityOn: boolean;
  dayFirstStart?: string; // "HH:MM" first start each day (DRAFT, editable; default "10:00"). Clock resets per day.
  slotIntervalMinutes?: number; // minutes between consecutive slot starts (DRAFT; default 90; 0 ⇒ all same time)
  customEvents?: CustomScheduleEvent[]; // owner-added tournaments appended after each day's generated slots
}

// An owner-authored tournament added on top of the generated skeleton. Price is buy_in_prize + fee_rake
// (display-only); GTD = gtdEntries × buy_in_prize. Timing fields fall back to a neutral DRAFT default.
export interface CustomScheduleEvent {
  day: number; // 1-based; out-of-range days are dropped deterministically
  name: string;
  buy_in_prize: number;
  fee_rake: number;
  gtdEntries: number; // GTD = gtdEntries × buy_in_prize (0 ⇒ no GTD ⇒ honestly skipped by the B.2 EV feed)
  startingStack?: number;
  minutesPerLevel?: number;
  lateRegLevel?: number;
  startTime?: string; // "HH:MM"; absent ⇒ the renumbered slot's computed time
}

// Widened so an owner-authored row is honestly tagged "Custom" rather than mislabeled as a TD class.
export type ScheduleEventClass = EventClass | "Custom";

export interface ScheduleEvent {
  day: number; // 1-based
  slot: number; // 0-based within the day
  name: string;
  eventClass: ScheduleEventClass;
  buy_in_prize: number;
  fee_rake: number;
  GTD: number;
  sourceLabels: string[];
  startTime: string; // "HH:MM" local clock (resets each day) — DRAFT estimate
  startingStack: number; // chips
  minutesPerLevel: number; // blind-level length
  lateRegLevel: number; // reg closes after this many levels
  regEndTime: string; // "HH:MM" = addMinutes(startTime, lateRegLevel × minutesPerLevel) — may wrap past midnight
  regEndLevel: number; // = lateRegLevel
  regEndNextDay: boolean; // reg-end rolls past midnight relative to the displayed startTime (engine-computed, not string-inferred)
  isCustom?: boolean; // true for owner-added events
}

const MARQUEE_CLASSES: EventClass[] = ["MysteryBounty", "HighRoller", "SuperHighRoller", "PLO"]; // canonical order
const SIDE_POOL: EventClass[] = ["Deepstack", "Turbo", "Satellite", "Hyper"]; // canonical order

const CLASS_DISPLAY: Record<EventClass, string> = {
  Main: "Main Event",
  HighRoller: "High Roller",
  SuperHighRoller: "Super High Roller",
  MysteryBounty: "Mystery Bounty",
  PLO: "PLO",
  Deepstack: "Deepstack",
  Turbo: "Turbo",
  Hyper: "Hyper",
  Satellite: "Satellite",
};

function clampInt(v: number, lo: number, hi: number): number {
  const n = Number.isFinite(v) ? Math.round(v) : lo;
  return n < lo ? lo : n > hi ? hi : n;
}

const DEFAULT_FIRST_START_MIN = 600; // 10:00
const DEFAULT_INTERVAL_MIN = 90;
const CUSTOM_FALLBACK = { startingStack: 30_000, minutesPerLevel: 30, lateRegLevel: 10 } as const;

/** Parse "HH:MM" → minutes since midnight (0..1439), or null if malformed/out of range. Pure. */
export function parseHHMM(s: string): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes (any sign) → "HH:MM", wrapping into a 24h clock (past-midnight safe). Pure. */
export function formatHHMM(totalMin: number): string {
  const n = Number.isFinite(totalMin) ? Math.round(totalMin) : 0;
  const m = ((n % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * "HH:MM" + minutes → "HH:MM" (wrapped). A malformed base falls back to 10:00 and a non-finite delta to 0,
 * so this NEVER throws — the generator must stay total for any form input.
 */
export function addMinutes(hhmm: string, mins: number): string {
  const base = parseHHMM(hhmm) ?? DEFAULT_FIRST_START_MIN;
  return formatHHMM(base + (Number.isFinite(mins) ? mins : 0));
}

/**
 * Reg-end fields derived from the DISPLAYED start (the poster shows startTime, so reg-end is measured from it):
 * regEndTime = addMinutes(startTime, lateRegLevel × minutesPerLevel); regEndNextDay = that sum ≥ 1440 (crossed
 * midnight). regEndNextDay is engine-computed from minutes — never inferred from the wrapped "01:00" string.
 */
function regFields(startTime: string, lateRegLevel: number, minutesPerLevel: number): {
  regEndTime: string;
  regEndLevel: number;
  regEndNextDay: boolean;
} {
  const ds = parseHHMM(startTime) ?? DEFAULT_FIRST_START_MIN; // startTime is always a valid formatHHMM output
  const abs = ds + Math.max(0, lateRegLevel) * Math.max(0, minutesPerLevel);
  return { regEndTime: formatHHMM(abs), regEndLevel: lateRegLevel, regEndNextDay: abs >= 1440 };
}

/**
 * Deterministically generate a draft schedule. Main lands on MAIN_PLACEMENT.flightDay (or the last day
 * when the festival is too short); marquees take distinct days nearest the festival midpoint; side events
 * cycle-fill the rest. GTD = min(round(floor × seasonality), venueCapacity) × buy_in_prize.
 */
export function generateSchedule(input: ScheduleInput, rulesOverride?: RulesOverride): ScheduleEvent[] {
  const rules: TdRules = mergeRules(DEFAULT_RULES, rulesOverride);
  const festivalDays = Math.max(1, Math.floor(Number.isFinite(input.festivalDays) ? input.festivalDays : 1));
  const eventsPerDay = clampInt(input.eventsPerDay, rules.density.min, rules.density.max);
  const venueCapacity = Math.max(1, Math.floor(Number.isFinite(input.venueCapacity) ? input.venueCapacity : 1));
  const seasonalityMult = input.seasonalityOn ? rules.seasonality.multiplier : 1;

  // --- timing: a coarse, editable DRAFT clock that resets each day (startTime = firstStart + slot×interval) ---
  const firstStartMin = parseHHMM(input.dayFirstStart ?? "") ?? DEFAULT_FIRST_START_MIN;
  const interval =
    typeof input.slotIntervalMinutes === "number" && Number.isFinite(input.slotIntervalMinutes) && input.slotIntervalMinutes >= 0
      ? Math.floor(input.slotIntervalMinutes)
      : DEFAULT_INTERVAL_MIN; // 0 honored (all slots same time); negative/NaN ⇒ default 90
  const startTimeForSlot = (slot: number): string => formatHHMM(firstStartMin + slot * interval);

  // --- owner-added custom events, grouped by day; out-of-range days dropped deterministically (input order kept) ---
  const customsByDay = new Map<number, CustomScheduleEvent[]>();
  for (const ce of input.customEvents ?? []) {
    const d = Math.floor(Number(ce?.day));
    if (!Number.isFinite(d) || d < 1 || d > festivalDays) continue;
    const arr = customsByDay.get(d);
    if (arr) arr.push(ce);
    else customsByDay.set(d, [ce]);
  }

  // --- placement: Main day + marquee→day map (deterministic by centrality) ---
  const mainDay = festivalDays >= rules.mainPlacement.flightDay ? rules.mainPlacement.flightDay : festivalDays;
  const mid = Math.floor((festivalDays + 1) / 2);
  const candidateDays = [];
  for (let d = 1; d <= festivalDays; d++) if (d !== mainDay) candidateDays.push(d);
  candidateDays.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  const dayFeatureClass = new Map<number, EventClass>();
  dayFeatureClass.set(mainDay, "Main");
  MARQUEE_CLASSES.forEach((cls, i) => {
    if (i < candidateDays.length) dayFeatureClass.set(candidateDays[i], cls);
  });

  // --- buy-in banding from sorted tiers (TD-review note #4: real APT order is SHR > HR > Main > PLO;
  //     PLO actually sits BELOW Main and SHR is its own top tier — banding is intentionally COARSE for a
  //     draft, refine in TD review) ---
  const tiers = input.buyInTiers.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const top = tiers.length ? tiers[tiers.length - 1] : null;
  const midTier = tiers.length ? tiers[Math.floor(tiers.length / 2)] : null;
  const low = tiers.length ? tiers[0] : null;
  const mainBuyIn = Number.isFinite(input.mainBuyIn) && input.mainBuyIn > 0 ? input.mainBuyIn : null;
  const fallback = rules.fallbackBuyIn;
  const buyInForClass = (cls: EventClass): number => {
    switch (cls) {
      case "Main":
        return mainBuyIn ?? top ?? fallback;
      case "HighRoller":
      case "PLO":
      case "SuperHighRoller":
        return top ?? mainBuyIn ?? fallback;
      case "MysteryBounty":
        return midTier ?? mainBuyIn ?? fallback;
      default:
        return low ?? mainBuyIn ?? fallback;
    }
  };

  const classFor = (day: number, slot: number): EventClass => {
    const feature = dayFeatureClass.get(day);
    if (slot === 0 && feature) return feature;
    const flatIndex = (day - 1) * eventsPerDay + slot;
    return SIDE_POOL[flatIndex % SIDE_POOL.length];
  };

  const pos = (v: number | undefined, fb: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fb);

  const sideCount: Partial<Record<EventClass, number>> = {};
  const events: ScheduleEvent[] = [];
  for (let day = 1; day <= festivalDays; day++) {
    for (let slot = 0; slot < eventsPerDay; slot++) {
      const cls = classFor(day, slot);
      const def = rules.eventClassDefaults[cls];
      const buy_in_prize = buyInForClass(cls);

      const floor = cls === "Main" && input.mainGtdEntries != null && input.mainGtdEntries > 0 ? input.mainGtdEntries : def.gtdEntriesFloor;
      const effEntries = Math.min(Math.round(floor * seasonalityMult), venueCapacity);
      const GTD = effEntries * buy_in_prize;
      const fee_rake = Math.round(def.feeRatio * buy_in_prize);

      const labels = new Set<string>(def.sourceLabels);
      if (cls === "Main") for (const l of rules.mainPlacement.sourceLabels) labels.add(l);
      if (input.seasonalityOn) labels.add("Hypothesis");

      const isFeature = slot === 0 && dayFeatureClass.get(day) === cls;
      let name: string;
      if (cls === "Main") {
        name = `Day ${day} — ${CLASS_DISPLAY.Main}`;
      } else if (isFeature) {
        name = CLASS_DISPLAY[cls];
      } else {
        const n = (sideCount[cls] = (sideCount[cls] ?? 0) + 1);
        name = `${CLASS_DISPLAY[cls]} #${n}`;
      }

      const startTime = startTimeForSlot(slot);
      const { startingStack, minutesPerLevel, lateRegLevel } = def;
      events.push({
        day,
        slot,
        name,
        eventClass: cls,
        buy_in_prize,
        fee_rake,
        GTD,
        sourceLabels: [...labels],
        startTime,
        startingStack,
        minutesPerLevel,
        lateRegLevel,
        ...regFields(startTime, lateRegLevel, minutesPerLevel),
      });
    }

    // append this day's owner-added events after the generated slots; slots continue contiguously
    const customs = customsByDay.get(day);
    if (customs) {
      let slot = eventsPerDay;
      for (const ce of customs) {
        const buy_in_prize = pos(ce.buy_in_prize, 0);
        const fee_rake = typeof ce.fee_rake === "number" && Number.isFinite(ce.fee_rake) && ce.fee_rake >= 0 ? ce.fee_rake : 0;
        const gtdEntries = pos(ce.gtdEntries, 0);
        const startingStack = pos(ce.startingStack, CUSTOM_FALLBACK.startingStack);
        const minutesPerLevel = pos(ce.minutesPerLevel, CUSTOM_FALLBACK.minutesPerLevel);
        const lateRegLevel = pos(ce.lateRegLevel, CUSTOM_FALLBACK.lateRegLevel);
        const parsedStart = parseHHMM(ce.startTime ?? "");
        const startTime = parsedStart != null ? formatHHMM(parsedStart) : startTimeForSlot(slot);
        const name = typeof ce.name === "string" && ce.name.trim() ? ce.name.trim() : "Giải tự thêm";
        events.push({
          day,
          slot,
          name,
          eventClass: "Custom",
          buy_in_prize,
          fee_rake,
          GTD: gtdEntries * buy_in_prize,
          sourceLabels: ["custom"],
          startTime,
          startingStack,
          minutesPerLevel,
          lateRegLevel,
          ...regFields(startTime, lateRegLevel, minutesPerLevel),
          isCustom: true,
        });
        slot++;
      }
    }
  }
  return events;
}
