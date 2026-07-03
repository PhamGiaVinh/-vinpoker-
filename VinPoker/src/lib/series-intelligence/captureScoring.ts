// Series Intelligence — CAPTURE v0 scoring & derivations. PURE functions only (no Supabase, no I/O).
// These MEASURE captured facts — they never predict. Results carry the honesty label "Observed Pattern"
// (measured from the club's own data); nothing here is a "Model Estimate". Post-event actuals are read for
// scoring only and are never fed back as forecast inputs (leakage rule).
import type { DecisionLog, ForecastSnapshot, RegistrationEvent } from "./captureTypes";

export type InsightLabel = "Known Rule" | "Observed Pattern" | "Hypothesis";

export interface OutcomeScore {
  hasActuals: boolean;
  actualEntries: number | null;
  base: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  inBand: boolean | null; // actual_entries within [forecast_low, forecast_high]?
  entriesDelta: number | null; // actual_entries − forecast_base
  candidateGtd: number | null;
  actualPrizePool: number | null;
  gtdCovered: boolean | null; // actual_prize_pool ≥ candidate_gtd?
  overlayAmount: number | null;
  hadOverlay: boolean | null; // actual_overlay_amount > 0?
  label: InsightLabel;
}

type ActualsSlice = Pick<DecisionLog, "actual_entries" | "actual_prize_pool" | "actual_overlay_amount">;

/** Compare a chosen forecast snapshot against a decision's post-event actuals. All measured facts. */
export function scoreOutcome(snapshot: ForecastSnapshot | null, actuals: ActualsSlice | null): OutcomeScore {
  const actualEntries = actuals?.actual_entries ?? null;
  const actualPrizePool = actuals?.actual_prize_pool ?? null;
  const overlayAmount = actuals?.actual_overlay_amount ?? null;
  const hasActuals = actualEntries != null || actualPrizePool != null || overlayAmount != null;

  const base = snapshot?.forecast_base ?? null;
  const bandLow = snapshot?.forecast_low ?? null;
  const bandHigh = snapshot?.forecast_high ?? null;
  const candidateGtd = snapshot?.candidate_gtd ?? null;

  const inBand =
    actualEntries != null && bandLow != null && bandHigh != null
      ? actualEntries >= bandLow && actualEntries <= bandHigh
      : null;
  const entriesDelta = actualEntries != null && base != null ? actualEntries - base : null;
  const gtdCovered = actualPrizePool != null && candidateGtd != null ? actualPrizePool >= candidateGtd : null;
  const hadOverlay = overlayAmount != null ? overlayAmount > 0 : null;

  return {
    hasActuals,
    actualEntries,
    base,
    bandLow,
    bandHigh,
    inBand,
    entriesDelta,
    candidateGtd,
    actualPrizePool,
    gtdCovered,
    overlayAmount,
    hadOverlay,
    label: "Observed Pattern",
  };
}

const hasActualsOn = (d: DecisionLog): boolean =>
  d.actual_entries != null || d.actual_prize_pool != null || d.actual_overlay_amount != null;

/**
 * Which snapshot to SCORE against — an event can have several. Prefer the one the post-event decision linked;
 * otherwise the latest PRE-event snapshot (smallest days_before, then newest created_at). The caller must show
 * WHICH snapshot was used so the score is never ambiguous.
 */
export function pickScoringSnapshot(
  snapshots: ForecastSnapshot[],
  postDecision: DecisionLog | null,
): ForecastSnapshot | null {
  if (postDecision?.forecast_snapshot_id) {
    const linked = snapshots.find((s) => s.id === postDecision.forecast_snapshot_id);
    if (linked) return linked;
  }
  if (snapshots.length === 0) return null;
  const sorted = [...snapshots].sort((a, b) => {
    const da = a.days_before ?? Number.POSITIVE_INFINITY;
    const db = b.days_before ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db; // closest to the event first
    return a.created_at < b.created_at ? 1 : -1; // then newest
  });
  return sorted[0] ?? null;
}

/** Find the decision that carries post-event actuals for an event (prefer horizon='post'). */
export function findScoredDecision(eventDecisions: DecisionLog[]): DecisionLog | null {
  return (
    eventDecisions.find((d) => d.decision_horizon === "post" && hasActualsOn(d)) ??
    eventDecisions.find(hasActualsOn) ??
    null
  );
}

export interface CaptureSummary {
  events: number; // distinct events with any decision logged
  decisions: number;
  scoredEvents: number; // events with post-event actuals filled
  gtdCoveredEvents: number; // of scored events, how many covered their candidate GTD
}

/** Overview across the club's decisions + snapshots. Descriptive counts only. */
export function summarizeCapture(decisions: DecisionLog[], snapshots: ForecastSnapshot[]): CaptureSummary {
  const eventIds = new Set(decisions.map((d) => d.event_id));
  let scoredEvents = 0;
  let gtdCoveredEvents = 0;
  for (const ev of eventIds) {
    const evDecisions = decisions.filter((d) => d.event_id === ev);
    const scored = findScoredDecision(evDecisions);
    if (!scored) continue;
    scoredEvents++;
    const snap = pickScoringSnapshot(
      snapshots.filter((s) => s.event_id === ev),
      scored,
    );
    if (scoreOutcome(snap, scored).gtdCovered === true) gtdCoveredEvents++;
  }
  return { events: eventIds.size, decisions: decisions.length, scoredEvents, gtdCoveredEvents };
}

/**
 * One OutcomeScore per event that has a scored (actuals-bearing) decision — the calibration input for
 * G7. Reuses the exact same pick/score chain as summarizeCapture so the calibration view and the
 * overview can never disagree about which snapshot/actuals a giải was scored on. Leakage-safe (actuals
 * are the scored target only). Events with no actuals yet are skipped, not guessed.
 */
export function collectOutcomeScores(decisions: DecisionLog[], snapshots: ForecastSnapshot[]): OutcomeScore[] {
  const eventIds = new Set(decisions.map((d) => d.event_id));
  const out: OutcomeScore[] = [];
  for (const ev of eventIds) {
    const scored = findScoredDecision(decisions.filter((d) => d.event_id === ev));
    if (!scored) continue;
    out.push(scoreOutcome(pickScoringSnapshot(snapshots.filter((s) => s.event_id === ev), scored), scored));
  }
  return out;
}

export interface RegFunnel {
  total: number;
  unique: number; // distinct non-null player_ref_hash
  reentries: number; // is_reentry = true
  byStage: Record<string, number>; // commitment_stage → count ('unknown' when null)
}

/** Registration funnel for one event's registration rows. Measured counts. */
export function registrationFunnel(regs: RegistrationEvent[]): RegFunnel {
  const byStage: Record<string, number> = {};
  const hashes = new Set<string>();
  let reentries = 0;
  for (const r of regs) {
    const stage = r.commitment_stage ?? "unknown";
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    if (r.player_ref_hash) hashes.add(r.player_ref_hash);
    if (r.is_reentry) reentries++;
  }
  return { total: regs.length, unique: hashes.size, reentries, byStage };
}
