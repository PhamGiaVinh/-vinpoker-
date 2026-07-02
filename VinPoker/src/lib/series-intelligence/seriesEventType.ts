// Series Intelligence — shared tournament TYPE classifier (PURE, no I/O).
//
// One neutral home for "what kind of tournament is this?" so multiple consumers (turnout forecast features,
// contribution-margin-by-type grouping) share ONE vocabulary instead of each inventing its own. Keyword match
// over the event name (plus an optional explicit keyword), first hit wins, "other" when nothing matches.
// NOTE: this is the TYPE axis (main/turbo/bounty/…), deliberately different from referenceDistribution's
// grouping axis (same tournament NAME across series) — the two answer different questions.

/** Ordered keyword list — more specific phrases before their substrings ("super high roller" > "high roller"),
 *  and "satellite" before "main" because satellites name their target ("Satellite to Main Event"). */
export const TYPE_KEYWORDS = [
  "super high roller",
  "high roller",
  "satellite",
  "main",
  "mystery",
  "bounty",
  "plo",
  "deepstack",
  "turbo",
  "hyper",
] as const;

export type SeriesEventType = (typeof TYPE_KEYWORDS)[number] | "other";

/** Vietnamese display labels (plain, for owner-facing cards). */
export const TYPE_LABEL: Record<SeriesEventType, string> = {
  main: "Main Event",
  "high roller": "High Roller",
  "super high roller": "Super High Roller",
  mystery: "Mystery",
  bounty: "Bounty",
  plo: "PLO",
  deepstack: "Deepstack",
  turbo: "Turbo",
  hyper: "Hyper",
  satellite: "Satellite",
  other: "Khác",
};

/** Classify an event by name (+ optional explicit keyword). Case-insensitive; first keyword hit wins. */
export function typeOf(name: string | null | undefined, explicit?: string | null): SeriesEventType {
  const hay = `${explicit ?? ""} ${name ?? ""}`.toLowerCase();
  for (const k of TYPE_KEYWORDS) if (hay.includes(k)) return k;
  return "other";
}
