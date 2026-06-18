// Best Fit Events — pure scorer that ranks real upcoming tournaments against a
// drill profile. No DB, no network here; the component fetches the events and
// passes plain summaries in. Honest: matches on STRUCTURE (deep vs turbo), the
// only signal a drill-only profile can map to — not a winnings promise.
import { DrillResult, SuggestedEventType } from "./types";

export interface UpcomingEvent {
  id: string;
  name: string;
  startTime: string; // ISO
  buyIn: number | null;
  startingStack: number | null;
  minutesPerLevel: number | null;
  gameType: string | null;
  location?: string | null;
  clubName?: string | null;
}

export type EventStructure = "deep" | "standard" | "turbo";
export type FitVerdict = "good" | "neutral" | "avoid";

export interface ScoredEvent {
  event: UpcomingEvent;
  structure: EventStructure;
  verdict: FitVerdict;
  score: number;
  reasonKey: "fit" | "standard" | "avoid";
}

/** Classify a tournament's structure from level length, falling back to stack depth. */
export function classifyStructure(e: UpcomingEvent): EventStructure {
  const m = e.minutesPerLevel;
  if (m != null) {
    if (m >= 20) return "deep";
    if (m <= 12) return "turbo";
    return "standard";
  }
  const s = e.startingStack;
  if (s != null) {
    if (s >= 30000) return "deep";
    if (s <= 12000) return "turbo";
  }
  return "standard";
}

const FIT_STRUCTURE: Record<SuggestedEventType, EventStructure> = {
  deepstack_mid_field: "deep",
  deepstack_small_field: "deep",
  slow_structure: "deep",
  turbo_short_stack: "turbo",
};

export function scoreEvent(result: DrillResult, e: UpcomingEvent): ScoredEvent {
  const structure = classifyStructure(e);
  const fitStruct = FIT_STRUCTURE[result.suggestedEvent.fit];
  const avoidStruct = FIT_STRUCTURE[result.suggestedEvent.avoid];
  const distinct = fitStruct !== avoidStruct;

  let score = 0;
  let verdict: FitVerdict = "neutral";
  let reasonKey: ScoredEvent["reasonKey"] = "standard";

  if (distinct && structure === fitStruct) {
    score = 2;
    verdict = "good";
    reasonKey = "fit";
  } else if (distinct && structure === avoidStruct) {
    score = -2;
    verdict = "avoid";
    reasonKey = "avoid";
  } else {
    score = 0.5; // standard / undetermined — acceptable, not a highlight
    verdict = "neutral";
    reasonKey = "standard";
  }

  // A turbo/short-stack field stresses exactly the areas a vs-aggro / tournament
  // -pressure weakness struggles with — nudge it further down.
  if (structure === "turbo" && (result.weakestCategory === "vs_aggro" || result.weakestCategory === "tournament_pressure")) {
    score -= 1;
    if (verdict !== "avoid") {
      verdict = "avoid";
      reasonKey = "avoid";
    }
  }

  return { event: e, structure, verdict, score, reasonKey };
}

const byTime = (a: ScoredEvent, b: ScoredEvent) =>
  new Date(a.event.startTime).getTime() - new Date(b.event.startTime).getTime();

export interface RankedBestFit {
  good: ScoredEvent[];
  avoid: ScoredEvent[];
  all: ScoredEvent[];
}

/** Rank events: "good" fits first (by score then soonest), "avoid" listed apart. */
export function rankBestFit(result: DrillResult, events: UpcomingEvent[]): RankedBestFit {
  const all = events.map((e) => scoreEvent(result, e));
  const good = all
    .filter((s) => s.verdict === "good")
    .sort((a, b) => b.score - a.score || byTime(a, b));
  const neutral = all.filter((s) => s.verdict === "neutral").sort(byTime);
  const avoid = all.filter((s) => s.verdict === "avoid").sort(byTime);
  return { good: [...good, ...neutral], avoid, all };
}
