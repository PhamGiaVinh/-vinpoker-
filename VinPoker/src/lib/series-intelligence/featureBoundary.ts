// Series Intelligence — Point-in-time feature availability boundary (A1).
//
// Leakage discipline as a RUNTIME-ENFORCED contract, not a comment. Every quantity a forecast may consume is
// classified into exactly one availability class relative to the forecast ORIGIN — the instant the forecast is
// made (for a walk-forward fold, the target event's timestamp):
//
//   • StaticKnown       — fixed by the schedule / known before the origin: buy-in, GTD, weekday, venue, brand,
//                          edition index, planned capacity, and the derived model features. Always admissible.
//   • ObservedByOrigin  — observed WHILE registration / the series runs: registrations-so-far, entries-so-far,
//                          satellite seats issued, marketing executed, queue/observed-capacity. Admissible ONLY
//                          with an observedAt timestamp satisfying  observedAt <= origin.
//   • OutcomeOnly       — unknown until the event finalises: final entries (the TARGET), final rake, final F&B,
//                          final overlay, outcome labels. NEVER a feature — it lives in a separate outcomes
//                          namespace (`Outcomes`) that buildFeatures cannot accept.
//
// buildFeatures() is the single admission gate. It accepts ONLY StaticKnown + validated ObservedByOrigin and
// FAILS CLOSED (throws) on: an unknown/unclassified key, an outcome-only key, a missing/invalid observedAt, or
// a future observation (observedAt > origin). Timezones are normalised to epoch ms before comparison, so the
// same instant written with different offsets compares equal. TypeScript typing alone is NOT trusted — data
// arriving from JSON / imports is re-validated at runtime (parseOrigin / parseObservedFeature). No `any` or
// bypassing `unknown` cast is used anywhere in this module; `unknown` appears ONLY as the honest input type of
// the runtime parsers, which then narrow it with explicit checks.

/** The three — and only three — availability classes. An unclassified key is a leakage risk and fails closed. */
export type AvailabilityClass = "static_known" | "observed_by_origin" | "outcome_only";

/** A value carried through the boundary. Static categoricals (weekday "wd6", type "main") are strings; counts
 *  and log-numerics are numbers. The boundary reasons about a key's CLASS + timing, not its value type. */
export type FeatureValue = number | string;

/** Thrown by every fail-closed path so callers/tests can assert the boundary refused rather than mis-admitted. */
export class FeatureBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeatureBoundaryError";
  }
}

// ---------- the registry: the single source of truth for what each feature key is allowed to be ----------
// Keys are canonical, class-scoped names. The distinction that actually prevents leakage lives HERE: an
// end-of-event count is `finalEntries` (outcome_only, = the target), while a mid-registration snapshot is
// `entriesSoFar` (observed_by_origin). Same underlying quantity, different availability — different key.
const FEATURE_REGISTRY: Readonly<Record<string, AvailabilityClass>> = {
  // — StaticKnown: known before the origin —
  buyIn: "static_known",
  logBuyin: "static_known",
  gtd: "static_known",
  logGtd: "static_known",
  gtdMissing: "static_known",
  schedule: "static_known",
  eventDate: "static_known",
  weekday: "static_known",
  quarter: "static_known",
  hourSlot: "static_known",
  venue: "static_known",
  brand: "static_known",
  eventName: "static_known",
  type: "static_known",
  isHoliday: "static_known",
  isPayday: "static_known",
  editionIndex: "static_known",
  editionTrend: "static_known",
  capacityPlanned: "static_known", // venue seats known in advance — NOT the same as capacityObserved

  // — ObservedByOrigin: observed during registration / the running series (needs observedAt ≤ origin) —
  registrationsSoFar: "observed_by_origin",
  entriesSoFar: "observed_by_origin",
  reentriesSoFar: "observed_by_origin",
  satelliteSeatsIssued: "observed_by_origin",
  marketingExecuted: "observed_by_origin",
  queueLength: "observed_by_origin",
  capacityObserved: "observed_by_origin", // seats filled so far — a running observation, not the plan
  tablesOpenSoFar: "observed_by_origin",
  chipsInPlaySoFar: "observed_by_origin",

  // — OutcomeOnly: unavailable until finalisation. NEVER a feature. —
  finalEntries: "outcome_only", // the forecast TARGET (a.k.a. total_entries)
  totalEntries: "outcome_only",
  finalUniqueEntries: "outcome_only",
  uniqueEntries: "outcome_only",
  finalReentries: "outcome_only",
  finalRake: "outcome_only",
  finalPrizePool: "outcome_only",
  prizePoolActual: "outcome_only",
  finalServiceFee: "outcome_only",
  finalFnb: "outcome_only",
  finalOverlay: "outcome_only",
  finalItmCount: "outcome_only",
  outcomeLabel: "outcome_only",
};

/** The version of the model feature set / registry (B2 provenance). Bump this whenever MODEL_FEATURE_KEYS,
 *  their derivation, or their availability classes change — so a stored forecast's provenance can be told
 *  apart by which feature schema produced it (B1 pools residuals only within one featureSchemaVersion). */
export const FEATURE_SCHEMA_VERSION = "feat-1";

/** The model feature keys the turnout forecast consumes — ALL must be static_known (enforced by
 *  assertModelFeaturesStatic + a test). Any future non-static feature must instead be admitted through
 *  buildFeatures with an observedAt, never appended here. */
export const MODEL_FEATURE_KEYS: readonly string[] = [
  "logBuyin",
  "logGtd",
  "gtdMissing",
  "weekday",
  "quarter",
  "hourSlot",
  "type",
  "isHoliday",
  "isPayday",
  "editionTrend",
];

/** True if the key is registered at all. Unregistered ⇒ unclassified ⇒ must fail closed. */
export function isKnownFeature(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FEATURE_REGISTRY, key);
}

/** The availability class of a key. FAILS CLOSED (throws) on an unknown/unclassified key. */
export function classify(key: string): AvailabilityClass {
  if (!isKnownFeature(key)) {
    throw new FeatureBoundaryError(
      `Unknown feature "${key}" — unclassified features fail closed; register its availability class before use.`,
    );
  }
  return FEATURE_REGISTRY[key];
}

// ---------- null-model-first pattern guard (A6) ----------
// Gambler's-fallacy / "pattern-selling" quantities on a stochastic outcome are NOT predictive skill. They are
// listed here by EXPLICIT, STABLE ID — this is a registry-membership check, NOT a keyword ban: a legitimate
// feature whose name merely contains "trend" / "predict" / "probability" (e.g. `editionTrend`, a real model
// feature) is unaffected. A pattern feature is NEVER admissible as a production feature unless it earns an
// owner-approved ResearchContract (null model + point-in-time class + walk-forward protocol + min sample +
// trial count). For A6 no contract is approved and none is wired into buildFeatures, so every listed pattern
// feature stays rejected / research_only.
export type PatternFeatureStatus = "prohibited" | "research_only";

const PATTERN_FEATURE_REGISTRY: Readonly<Record<string, PatternFeatureStatus>> = {
  hotEvent: "prohibited", // "hot" event/number
  coldEvent: "prohibited", // "cold" event/number
  dueEvent: "prohibited", // "due"
  overdueEvent: "prohibited", // "overdue"
  turnoutStreak: "prohibited", // streak
  winningStreak: "prohibited",
  losingStreak: "prohibited",
  timeSinceLastBigTurnout: "research_only", // "time since last success" — only via a research contract
  lauChuaDong: "prohibited", // "lâu chưa đông" (long since a full house)
  kyNayDenLuotDong: "prohibited", // "kỳ này đến lượt đông" (this edition is 'due' to be full)
  gamblersFallacyTurnout: "prohibited",
};

/** Stable list of the registered pattern-feature ids — for guardrail tests / doctrine tooling. */
export const PATTERN_FEATURE_IDS: readonly string[] = Object.keys(PATTERN_FEATURE_REGISTRY);

/** The pattern status of a feature id, or null when it is not a registered pattern feature (this gate then
 *  does not apply and availability classification takes over). Registry-membership, never substring matching. */
export function patternStatus(featureId: string): PatternFeatureStatus | null {
  return Object.prototype.hasOwnProperty.call(PATTERN_FEATURE_REGISTRY, featureId)
    ? PATTERN_FEATURE_REGISTRY[featureId]
    : null;
}

/** The ONLY path by which a pattern-like feature could ever become admissible: an owner-approved research
 *  contract that pins its null model, expected-under-randomness behaviour, point-in-time availability,
 *  walk-forward protocol, minimum sample, and trial count (multiple-testing record). */
export interface ResearchContract {
  featureId: string;
  nullModel: string;
  expectedUnderRandomness: string;
  availability: AvailabilityClass;
  walkForwardProtocol: string;
  minSampleSize: number;
  trialCount: number;
  ownerApproved: boolean;
}

/** Whether a pattern feature is admissible. `prohibited` never is; a non-pattern id is not governed here.
 *  `research_only` is admissible ONLY with a complete, matching, owner-approved contract — and even then it
 *  must ALSO be registered with an availability class (which A6 does not do), so no pattern feature can enter
 *  a production model in A6. */
export function patternFeatureAdmissible(featureId: string, contract?: ResearchContract): boolean {
  if (patternStatus(featureId) !== "research_only") return false; // prohibited, or not a pattern feature
  return (
    contract !== undefined &&
    contract.featureId === featureId &&
    contract.ownerApproved === true &&
    contract.nullModel.trim() !== "" &&
    contract.expectedUnderRandomness.trim() !== "" &&
    contract.walkForwardProtocol.trim() !== "" &&
    Number.isFinite(contract.minSampleSize) &&
    contract.minSampleSize > 0 &&
    Number.isInteger(contract.trialCount) &&
    contract.trialCount >= 1
  );
}

// ---------- the forecast origin (point-in-time anchor) ----------
export interface ForecastOrigin {
  /** Canonical UTC ISO of the origin. Idempotent for already-canonical inputs. */
  readonly originTs: string;
  /** Parsed epoch ms — ALL point-in-time comparisons use this, never the raw string (timezone-safe). */
  readonly originMs: number;
}

/** Build a forecast origin from an ISO timestamp. FAILS CLOSED (throws) on an unparseable date. */
export function makeOrigin(originTs: string): ForecastOrigin {
  const ms = new Date(originTs).getTime();
  if (!Number.isFinite(ms)) {
    throw new FeatureBoundaryError(`Invalid forecast origin timestamp "${originTs}".`);
  }
  return { originTs: new Date(ms).toISOString(), originMs: ms };
}

/** Runtime-validate an origin arriving from JSON/import. Typing is not trusted — the shape is checked here. */
export function parseOrigin(raw: unknown): ForecastOrigin {
  if (typeof raw === "string") return makeOrigin(raw);
  if (raw !== null && typeof raw === "object" && "originTs" in raw) {
    const ts = (raw as { originTs: unknown }).originTs;
    if (typeof ts === "string") return makeOrigin(ts);
  }
  throw new FeatureBoundaryError("Cannot parse forecast origin: expected an ISO string or { originTs }.");
}

// ---------- feature inputs ----------
export interface StaticFeature {
  readonly key: string;
  readonly value: FeatureValue;
}
export interface ObservedFeature {
  readonly key: string;
  readonly value: number;
  readonly observedAt: string; // ISO; must satisfy observedAt <= origin
}

/** Runtime-validate an observed feature arriving from JSON/import (shape + types), BEFORE any timing check.
 *  Does NOT check observedAt ≤ origin — that is buildFeatures' job (it needs the origin). */
export function parseObservedFeature(raw: unknown): ObservedFeature {
  if (raw === null || typeof raw !== "object") {
    throw new FeatureBoundaryError("Observed feature must be an object { key, value, observedAt }.");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== "string") throw new FeatureBoundaryError("Observed feature: `key` must be a string.");
  if (typeof o.value !== "number" || !Number.isFinite(o.value)) {
    throw new FeatureBoundaryError(`Observed feature "${o.key}": \`value\` must be a finite number.`);
  }
  if (typeof o.observedAt !== "string" || !Number.isFinite(new Date(o.observedAt).getTime())) {
    throw new FeatureBoundaryError(`Observed feature "${o.key}": \`observedAt\` must be a valid ISO timestamp.`);
  }
  return { key: o.key, value: o.value, observedAt: o.observedAt };
}

// ---------- the SEPARATE outcomes namespace (never features) ----------
/** OutcomeOnly quantities. Kept in a distinct type so they physically cannot be passed to buildFeatures; the
 *  scoring / actuals layer consumes these AFTER finalisation. */
export interface Outcomes {
  readonly finalEntries?: number | null;
  readonly finalUniqueEntries?: number | null;
  readonly finalReentries?: number | null;
  readonly finalRake?: number | null;
  readonly finalPrizePool?: number | null;
  readonly finalServiceFee?: number | null;
  readonly finalFnb?: number | null;
  readonly finalOverlay?: number | null;
  readonly finalItmCount?: number | null;
  readonly outcomeLabel?: string | null;
}

// ---------- the admission gate ----------
export interface BuiltFeatures {
  readonly values: Readonly<Record<string, FeatureValue>>;
  readonly availability: Readonly<Record<string, "static_known" | "observed_by_origin">>;
  readonly origin: ForecastOrigin;
}

/**
 * Admit a feature set for a forecast at `origin`. Accepts ONLY StaticKnown + validated ObservedByOrigin.
 * Fails closed (throws FeatureBoundaryError) on:
 *   • an unknown/unclassified key,
 *   • an outcome-only key presented as a feature,
 *   • a static key carrying an observedAt / an observed key missing one (wrong lane),
 *   • an observation with observedAt > origin (or an unparseable observedAt),
 *   • a duplicate key across the merged set.
 * Pure: inputs are not mutated; output is a fresh, deterministic bundle (key order follows input order).
 */
export function buildFeatures(
  origin: ForecastOrigin,
  statics: readonly StaticFeature[] = [],
  observed: readonly ObservedFeature[] = [],
): BuiltFeatures {
  const values: Record<string, FeatureValue> = {};
  const availability: Record<string, "static_known" | "observed_by_origin"> = {};

  const admit = (key: string, cls: "static_known" | "observed_by_origin", value: FeatureValue) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new FeatureBoundaryError(`Duplicate feature "${key}" in one admission — resolve before building.`);
    }
    values[key] = value;
    availability[key] = cls;
  };

  // A6 null-model-first guard: a registered gambler's-fallacy / pattern feature can never be admitted here
  // (no research contract is wired into production). Checked BEFORE classify so the reason is specific; these
  // ids are not in FEATURE_REGISTRY anyway, so classify would already fail closed — behaviour is unchanged.
  const rejectIfPattern = (key: string) => {
    const status = patternStatus(key);
    if (status !== null && !patternFeatureAdmissible(key)) {
      throw new FeatureBoundaryError(
        `Feature "${key}" is a ${status} pattern feature (gambler's-fallacy / null-model-first doctrine) — ` +
          `not admissible as a production feature without an owner-approved research contract.`,
      );
    }
  };

  for (const s of statics) {
    rejectIfPattern(s.key);
    const cls = classify(s.key); // throws on unknown → fail closed
    if (cls !== "static_known") {
      throw new FeatureBoundaryError(
        `Feature "${s.key}" is ${cls}, not static_known — it cannot be admitted as a static feature.`,
      );
    }
    admit(s.key, cls, s.value);
  }

  for (const o of observed) {
    rejectIfPattern(o.key);
    const cls = classify(o.key); // throws on unknown → fail closed
    if (cls !== "observed_by_origin") {
      throw new FeatureBoundaryError(
        `Feature "${o.key}" is ${cls}, not observed_by_origin — ${
          cls === "outcome_only" ? "outcomes are never features" : "static features carry no observedAt"
        }.`,
      );
    }
    const obsMs = new Date(o.observedAt).getTime();
    if (!Number.isFinite(obsMs)) {
      throw new FeatureBoundaryError(`Observed feature "${o.key}": invalid observedAt "${o.observedAt}".`);
    }
    if (obsMs > origin.originMs) {
      throw new FeatureBoundaryError(
        `Observed feature "${o.key}" observedAt ${o.observedAt} is AFTER origin ${origin.originTs} — future leakage, rejected.`,
      );
    }
    admit(o.key, cls, o.value);
  }

  return { values, availability, origin };
}

/** Assert the production model feature set is entirely StaticKnown. Fails closed if a non-static key ever
 *  slips into MODEL_FEATURE_KEYS without being routed through buildFeatures with an observedAt. */
export function assertModelFeaturesStatic(): void {
  for (const key of MODEL_FEATURE_KEYS) {
    const cls = classify(key);
    if (cls !== "static_known") {
      throw new FeatureBoundaryError(
        `Model feature "${key}" is ${cls}, not static_known — route observed features through buildFeatures, do not list them as model features.`,
      );
    }
  }
}
