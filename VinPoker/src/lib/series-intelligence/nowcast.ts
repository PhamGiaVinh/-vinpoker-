// Series Intelligence — TP1 nowcast (P1-8, PURE). The review's "strongest practical lever": blend the
// forecast MODEL with what sign-ups so far already imply, weighting the live signal more as the giải
// nears. We DON'T invent a pace curve — τ (the fraction of a field that has typically registered by k
// days out) is LEARNED from the club's own completed events (leakage-safe). No history → fall back to
// 100% model, honestly "unavailable". Everything here is pure + deterministic; the hook feeds real data.

/** T-21 is the earliest capture horizon in the framework; beyond it the pace signal gets ~0 weight. */
export const PACE_HORIZON_DAYS = 21;
/** Below this fraction registered, R/τ is too noisy to trust much (τ tiny amplifies each sign-up). */
const RELIABLE_PACE_FRACTION = 0.25;

export interface PastEventPace {
  /** ISO start time of a COMPLETED event. */
  startTime: string;
  /** Its final total_entries (> 0 to be usable). */
  finalTotal: number;
  /** ISO timestamps of its registrations (order irrelevant). */
  registrationTimes: string[];
}

const ms = (iso: string): number => new Date(iso).getTime();

/**
 * τ(k) — the typical fraction of the final field registered by `daysToEvent` days before start, as the
 * MEDIAN over the club's past completed events. For each past event: cutoff = start − k days; fraction =
 * (#registrations at/earlier than cutoff) / finalTotal. null when no past event is usable. Pure.
 */
export function estimatePaceFraction(past: PastEventPace[], daysToEvent: number): number | null {
  if (daysToEvent < 0) return null;
  const kMs = daysToEvent * 86_400_000;
  const fracs: number[] = [];
  for (const e of past) {
    const start = ms(e.startTime);
    if (Number.isNaN(start) || e.finalTotal <= 0) continue;
    const cutoff = start - kMs;
    const byNow = e.registrationTimes.filter((t) => {
      const tt = ms(t);
      return !Number.isNaN(tt) && tt <= cutoff;
    }).length;
    fracs.push(Math.min(1, byNow / e.finalTotal));
  }
  if (fracs.length === 0) return null;
  fracs.sort((a, b) => a - b);
  const mid = Math.floor(fracs.length / 2);
  return fracs.length % 2 ? fracs[mid] : (fracs[mid - 1] + fracs[mid]) / 2;
}

export interface NowcastInput {
  /** Sign-ups so far for the upcoming giải (R). */
  registrationsSoFar: number;
  /** Days until the giải (k). */
  daysToEvent: number;
  /** τ(k) from estimatePaceFraction — null when no pace history. */
  paceFraction: number | null;
  /** The model forecast N̂_model — null when the forecast is unavailable. */
  modelForecast: number | null;
}

export interface NowcastResult {
  available: boolean;
  /** Blended estimate N̂(T−k), or null. */
  blended: number | null;
  /** Pace-implied final = R/τ, or null when τ unusable. */
  paceImplied: number | null;
  /** Weight on the pace signal w_k ∈ [0,1] (higher = nearer the event + more already registered). */
  weightPace: number;
  /** Which inputs drove the result — for honest UI copy. */
  basis: "blend" | "model-only" | "pace-only" | "none";
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Blend pace-implied and model estimates in LOG space. w_k = (nearness) × (pace reliability): nearness =
 * 1 − k/HORIZON (linear shrinkage, review-endorsed); reliability = min(1, τ/RELIABLE) so an early, thin
 * pace can't dominate. Falls back cleanly to model-only (no pace) or pace-only (no model). Pure.
 */
export function nowcastBlend(input: NowcastInput): NowcastResult {
  const { registrationsSoFar, daysToEvent, paceFraction, modelForecast } = input;
  const paceImplied =
    paceFraction !== null && paceFraction > 0 ? Math.round(registrationsSoFar / paceFraction) : null;
  const hasModel = modelForecast !== null && modelForecast > 0;

  if (paceImplied === null && !hasModel) {
    return { available: false, blended: null, paceImplied: null, weightPace: 0, basis: "none" };
  }
  if (paceImplied === null) {
    return { available: true, blended: modelForecast, paceImplied: null, weightPace: 0, basis: "model-only" };
  }
  if (!hasModel) {
    return { available: true, blended: paceImplied, paceImplied, weightPace: 1, basis: "pace-only" };
  }

  const nearness = clamp01(1 - daysToEvent / PACE_HORIZON_DAYS);
  const reliability = Math.min(1, (paceFraction as number) / RELIABLE_PACE_FRACTION);
  const w = clamp01(nearness * reliability);
  const blended = Math.round(Math.exp(w * Math.log(paceImplied) + (1 - w) * Math.log(modelForecast as number)));
  return { available: true, blended, paceImplied, weightPace: Math.round(w * 100) / 100, basis: "blend" };
}
