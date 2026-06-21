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
}

export interface ScheduleEvent {
  day: number; // 1-based
  slot: number; // 0-based within the day
  name: string;
  eventClass: EventClass;
  buy_in_prize: number;
  fee_rake: number;
  GTD: number;
  sourceLabels: string[];
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

      events.push({ day, slot, name, eventClass: cls, buy_in_prize, fee_rake, GTD, sourceLabels: [...labels] });
    }
  }
  return events;
}
