// Series Intelligence — capacity / censoring (TP6, P1-5). PURE, tiny, shared by the forecast engine and the
// within-series elasticity so both treat "sold-out" events identically.
//
// A tournament that HIT its venue/seat capacity is a CENSORED (truncated) observation: the recorded entries
// are the seat count, NOT the true demand (which was higher but got turned away). Feeding those into a
// regression teaches the model a false ceiling ("this event maxes at 200"). So when seriesCensoring is on we
// DROP sold-out events from the fit and CAP a forecast band at the upcoming event's capacity.

import type { SeriesEvent } from "./nativeData";

/** True when the event reached its capacity (entries >= capacity). Both fields must be present + positive. */
export function hitCapacity(e: Pick<SeriesEvent, "total_entries" | "capacity">): boolean {
  return (
    e.capacity != null &&
    e.capacity > 0 &&
    e.total_entries != null &&
    e.total_entries >= e.capacity
  );
}
