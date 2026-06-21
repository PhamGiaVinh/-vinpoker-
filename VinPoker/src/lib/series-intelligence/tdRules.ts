// Series Intelligence — Forward layer: TD rules / event-class catalog (PATCH B, PURE, client-only).
//
// SOURCE-LABELED, EDITABLE defaults for the festival schedule generator. NOTHING here is locked truth:
// every number carries a source label ('TD-rule' = floor convention · '2-series' = from 2 observed APT
// series · 'Hypothesis' = unverified assumption · 'market-dependent' / 'APT-corrected'). The generator
// uses these as DEFAULTS; the panel lets the owner edit them and passes a RulesOverride. All values await
// the owner's TD review before any real use. No DB, no Supabase, no localStorage — a pure constants module.

export type EventClass =
  | "Main"
  | "HighRoller"
  | "SuperHighRoller"
  | "MysteryBounty"
  | "PLO"
  | "Deepstack"
  | "Turbo"
  | "Hyper"
  | "Satellite";

export type SourceLabel = "TD-rule" | "2-series" | "Hypothesis" | "market-dependent" | "APT-corrected";

export interface EventClassDefault {
  gtdEntriesFloor: number; // expected entries floor ⇒ GTD = floor × buy_in_prize
  feeRatio: number; // fee_rake / buy_in_prize
  marquee?: boolean; // a feature event that earns a dedicated day
  tags: string[];
  sourceLabels: SourceLabel[];
}

// APT-corrected defaults. Main feeRatio 0.145 = APT-observed (4.572M fee / 31.428M prize); fee is the
// rake driver, so 0.10 biased EV scenarios low. GTD floors: Main 700–1000 (use 850), MysteryBounty is a
// MARQUEE (~400, not filler), SHR 30–40, HR 100–140, PLO ~140, side 80–400, satellites 0.
export const EVENT_CLASS_DEFAULTS: Record<EventClass, EventClassDefault> = {
  Main: { gtdEntriesFloor: 850, feeRatio: 0.145, marquee: false, tags: ["flagship"], sourceLabels: ["2-series", "market-dependent", "APT-corrected"] },
  MysteryBounty: { gtdEntriesFloor: 400, feeRatio: 0.12, marquee: true, tags: ["bounty", "marquee"], sourceLabels: ["2-series"] },
  HighRoller: { gtdEntriesFloor: 120, feeRatio: 0.12, marquee: true, tags: ["high-roller"], sourceLabels: ["2-series"] },
  SuperHighRoller: { gtdEntriesFloor: 35, feeRatio: 0.12, marquee: true, tags: ["super-high-roller"], sourceLabels: ["2-series"] },
  PLO: { gtdEntriesFloor: 140, feeRatio: 0.12, marquee: true, tags: ["plo", "mixed"], sourceLabels: ["2-series"] },
  Deepstack: { gtdEntriesFloor: 400, feeRatio: 0.15, marquee: false, tags: ["side", "deepstack"], sourceLabels: ["TD-rule"] },
  Turbo: { gtdEntriesFloor: 120, feeRatio: 0.15, marquee: false, tags: ["side", "turbo"], sourceLabels: ["TD-rule"] },
  Hyper: { gtdEntriesFloor: 80, feeRatio: 0.15, marquee: false, tags: ["side", "hyper"], sourceLabels: ["TD-rule"] },
  Satellite: { gtdEntriesFloor: 0, feeRatio: 0.15, marquee: false, tags: ["side", "satellite"], sourceLabels: ["TD-rule"] },
};

export const MAIN_PLACEMENT = { flightDay: 3, sourceLabels: ["TD-rule", "APT-corrected"] as SourceLabel[] }; // Main ~Day 3, NOT Day 5
export const DENSITY_RULE = { min: 7, max: 9, sourceLabels: ["2-series"] as SourceLabel[] }; // 7–9 events/day
export const SEASONALITY = { multiplier: 1.3, sourceLabels: ["Hypothesis"] as SourceLabel[] }; // ~1.2–1.4 summer/tourism — UNVERIFIED
export const FALLBACK_BUYIN = 1_000_000; // [TD-rule] last-resort buy-in when no tier/mainBuyIn available

export interface TdRules {
  eventClassDefaults: Record<EventClass, EventClassDefault>;
  mainPlacement: typeof MAIN_PLACEMENT;
  density: typeof DENSITY_RULE;
  seasonality: typeof SEASONALITY;
  fallbackBuyIn: number;
}

export const DEFAULT_RULES: TdRules = {
  eventClassDefaults: EVENT_CLASS_DEFAULTS,
  mainPlacement: MAIN_PLACEMENT,
  density: DENSITY_RULE,
  seasonality: SEASONALITY,
  fallbackBuyIn: FALLBACK_BUYIN,
};

export interface RulesOverride {
  eventClassDefaults?: Partial<Record<EventClass, Partial<EventClassDefault>>>;
  mainPlacement?: Partial<TdRules["mainPlacement"]>;
  density?: Partial<TdRules["density"]>;
  seasonality?: Partial<TdRules["seasonality"]>;
  fallbackBuyIn?: number;
}

const EVENT_CLASSES = Object.keys(EVENT_CLASS_DEFAULTS) as EventClass[];

/**
 * Pure, one-level-aware merge of an editable override over the defaults. Arrays (tags / sourceLabels)
 * REPLACE wholesale when overridden (never concat), so editing one class's gtdEntriesFloor keeps its
 * labels. Never mutates `base` / DEFAULT_RULES.
 */
export function mergeRules(base: TdRules, ov?: RulesOverride): TdRules {
  if (!ov) return base;
  const eventClassDefaults = {} as Record<EventClass, EventClassDefault>;
  for (const cls of EVENT_CLASSES) {
    eventClassDefaults[cls] = { ...base.eventClassDefaults[cls], ...(ov.eventClassDefaults?.[cls] ?? {}) };
  }
  return {
    eventClassDefaults,
    mainPlacement: { ...base.mainPlacement, ...(ov.mainPlacement ?? {}) },
    density: { ...base.density, ...(ov.density ?? {}) },
    seasonality: { ...base.seasonality, ...(ov.seasonality ?? {}) },
    fallbackBuyIn: ov.fallbackBuyIn ?? base.fallbackBuyIn,
  };
}
