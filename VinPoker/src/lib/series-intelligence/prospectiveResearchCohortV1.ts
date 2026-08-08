import { buildForecastProvenance, type ForecastProvenance } from "./forecastProvenance";
import { toForecastProvenanceSnapshotColumns } from "./forecastProvenanceRow";
import { forecastTurnout, type ForecastOptions } from "./turnoutForecast";
import type { SeriesEvent } from "./nativeData";

export const PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1 = "series-research-horizon-policy-v1" as const;
export const PROSPECTIVE_RESEARCH_COHORT_VERSION = "series-prospective-research-cohort-v1" as const;

export type ProspectiveResearchHorizon = "T-21" | "T-7" | "T-1" | "T-0";
export const PROSPECTIVE_HORIZONS: readonly ProspectiveResearchHorizon[] = Object.freeze(["T-21", "T-7", "T-1", "T-0"]);

export type HorizonTimingStatus = "ON_TIME" | "LATE_WITHIN_ALLOWED_WINDOW" | "MISSED" | "NOT_YET_DUE";
export type ProspectiveNextAction =
  | "capture_forecast"
  | "already_captured"
  | "open_decision_room"
  | "promote_native_actual"
  | "evaluation_pending"
  | "not_yet_due"
  | "missed"
  | "forecast_unavailable"
  | "no_action";

/**
 * This policy is intentionally explicit and versioned. A horizon becomes on-time only in the small window
 * immediately before its target cutoff. Missing that cutoff is not rewritten as on-time later.
 */
export interface ProspectiveHorizonPolicy {
  readonly policyId: typeof PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1;
  readonly horizon: ProspectiveResearchHorizon;
  readonly leadTimeMinutes: number;
  readonly earlyCaptureMinutes: number;
  readonly allowedLateMinutes: number;
}

export const PROSPECTIVE_HORIZON_POLICY_V1: readonly ProspectiveHorizonPolicy[] = Object.freeze([
  { policyId: PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1, horizon: "T-21", leadTimeMinutes: 21 * 24 * 60, earlyCaptureMinutes: 15, allowedLateMinutes: 24 * 60 },
  { policyId: PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1, horizon: "T-7", leadTimeMinutes: 7 * 24 * 60, earlyCaptureMinutes: 15, allowedLateMinutes: 24 * 60 },
  { policyId: PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1, horizon: "T-1", leadTimeMinutes: 24 * 60, earlyCaptureMinutes: 15, allowedLateMinutes: 6 * 60 },
  { policyId: PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1, horizon: "T-0", leadTimeMinutes: 0, earlyCaptureMinutes: 15, allowedLateMinutes: 0 },
]);

export interface ProspectivePacketRef {
  readonly eventId: string;
  readonly horizon: ProspectiveResearchHorizon;
  readonly packetId: string;
  readonly state: "draft" | "frozen";
}

export interface ProspectiveActualRef {
  readonly eventId: string;
  readonly state: "unavailable" | "current" | "needs_reconciliation" | "conflict";
}

export interface ProspectiveSnapshotRef {
  readonly id: string;
  readonly eventId: string;
  readonly horizon: string;
  readonly targetEventTs: string | null;
  readonly forecastInstanceId: string | null;
  readonly inputContentHash: string | null;
  readonly forecastIdentityEligible: boolean;
  readonly provenanceCompleteness: string | null;
}

export interface ProspectiveCohortEvent {
  readonly event: SeriesEvent;
  readonly status?: string | null;
}

export interface ProspectiveCohortRow {
  readonly eventId: string;
  readonly eventName: string | null;
  readonly targetEventTs: string;
  readonly horizon: ProspectiveResearchHorizon;
  readonly dueAt: string;
  readonly timingStatus: HorizonTimingStatus;
  readonly leadTimeMinutes: number;
  readonly forecastState: "captured" | "due" | "not_yet_due" | "missed" | "unavailable";
  readonly packetState: "state_not_loaded" | "draft" | "frozen";
  readonly actualState: ProspectiveActualRef["state"] | "state_not_loaded";
  readonly evaluationState: "not_started" | "pending" | "available" | "state_not_loaded";
  readonly nextAction: ProspectiveNextAction;
  readonly snapshotId: string | null;
  readonly packetId: string | null;
}

export interface ProspectiveResearchQueue {
  readonly version: typeof PROSPECTIVE_RESEARCH_COHORT_VERSION;
  readonly policyId: typeof PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1;
  readonly asOfTs: string;
  readonly rows: readonly ProspectiveCohortRow[];
}

export type ProspectiveSnapshotBuildFailureCode =
  | "invalid_event_time"
  | "event_already_started"
  | "invalid_buy_in"
  | "forecast_unavailable"
  | "provenance_failed";

export interface ProspectiveSnapshotBuildFailure {
  readonly ok: false;
  readonly code: ProspectiveSnapshotBuildFailureCode;
  readonly reason: string;
}

export interface ProspectiveEngineSnapshot {
  readonly ok: true;
  readonly forecast: Readonly<ReturnType<typeof forecastTurnout>>;
  readonly provenance: ForecastProvenance;
  readonly insert: ProspectiveForecastSnapshotInsert;
}

export type ProspectiveSnapshotBuildResult = ProspectiveEngineSnapshot | ProspectiveSnapshotBuildFailure;

/** Local write shape only. The UI passes this to the existing CAPTURE hook; no Supabase type enters the kernel. */
export interface ProspectiveForecastSnapshotInsert {
  readonly event_id: string;
  readonly horizon: ProspectiveResearchHorizon;
  readonly days_before: number;
  readonly forecast_low: number;
  readonly forecast_base: number;
  readonly forecast_high: number;
  readonly confidence_tier: "low" | "medium" | "high";
  readonly candidate_gtd: number | null;
  readonly overlay_risk_pct: null;
  readonly source_label: "engine";
  readonly notes: string;
  readonly forecast_issued_at: string;
  readonly as_of_ts: string;
  readonly target_event_ts: string;
  readonly provenance_kind: "engine";
  readonly provenance_completeness: "complete" | "missing_code_sha";
  readonly forecast_identity_eligible: boolean;
  readonly engine_version: string | null;
  readonly feature_schema_version: string | null;
  readonly code_sha: string | null;
  readonly model_config_hash: string | null;
  readonly trial_count: number | null;
  readonly selection_protocol_id: string | null;
  readonly predictor_id: string | null;
  readonly calibration_pool_id: string | null;
  readonly target_input_hash: string | null;
  readonly training_data_hash: string | null;
  readonly input_content_hash: string | null;
  readonly forecast_instance_id: string | null;
  readonly derived_from_input_hash: null;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function instant(value: string, label: string): { iso: string; ms: number } {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Invalid ${label}`);
  return { iso: new Date(ms).toISOString(), ms };
}

function policyFor(horizon: ProspectiveResearchHorizon): ProspectiveHorizonPolicy {
  const policy = PROSPECTIVE_HORIZON_POLICY_V1.find((item) => item.horizon === horizon);
  if (!policy) throw new Error(`Unknown horizon ${horizon}`);
  return policy;
}

export function horizonDueAt(horizon: ProspectiveResearchHorizon, targetEventTs: string): string {
  const target = instant(targetEventTs, "targetEventTs");
  return new Date(target.ms - policyFor(horizon).leadTimeMinutes * MS_PER_MINUTE).toISOString();
}

export function classifyProspectiveHorizon(
  horizon: ProspectiveResearchHorizon,
  targetEventTs: string,
  asOfTs: string,
): HorizonTimingStatus {
  const target = instant(targetEventTs, "targetEventTs");
  const asOf = instant(asOfTs, "asOfTs");
  const policy = policyFor(horizon);
  const dueMs = target.ms - policy.leadTimeMinutes * MS_PER_MINUTE;
  if (asOf.ms >= target.ms) return "MISSED";
  if (asOf.ms < dueMs - policy.earlyCaptureMinutes * MS_PER_MINUTE) return "NOT_YET_DUE";
  if (asOf.ms <= dueMs) return "ON_TIME";
  if (asOf.ms <= dueMs + policy.allowedLateMinutes * MS_PER_MINUTE) return "LATE_WITHIN_ALLOWED_WINDOW";
  return "MISSED";
}

function matchingSnapshot(
  eventId: string,
  horizon: ProspectiveResearchHorizon,
  targetEventTs: string,
  snapshots: readonly ProspectiveSnapshotRef[],
): ProspectiveSnapshotRef | null {
  const target = instant(targetEventTs, "targetEventTs").iso;
  for (const snapshot of snapshots) {
    if (
      snapshot.eventId !== eventId ||
      snapshot.horizon !== horizon ||
      snapshot.targetEventTs === null ||
      snapshot.forecastIdentityEligible !== true ||
      snapshot.provenanceCompleteness !== "complete" ||
      snapshot.forecastInstanceId === null
    ) continue;
    try {
      if (instant(snapshot.targetEventTs, "snapshot.targetEventTs").iso === target) return snapshot;
    } catch {
      // Existing malformed rows are ignored so the queue remains fail-closed.
    }
  }
  return null;
}

/** Statuses explicitly reviewed as eligible pre-event capture states. Unknown values fail closed. */
export const PROSPECTIVE_FORECAST_ALLOWED_STATUSES = Object.freeze([
  "scheduled",
  "upcoming",
  "registering",
  "open",
] as const);

export function isProspectiveForecastStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined &&
    (PROSPECTIVE_FORECAST_ALLOWED_STATUSES as readonly string[]).includes(status);
}

export function buildNativePromotionIdempotencyKey(operationId: string, eventId: string): string {
  const operation = operationId.trim();
  const event = eventId.trim();
  if (!operation || !event) throw new Error("operationId and eventId are required");
  return `d3a:native:${operation}:${event}`;
}

export function createNativePromotionOperationId(): string | null {
  const uuid = globalThis.crypto?.randomUUID;
  return typeof uuid === "function" ? uuid.call(globalThis.crypto) : null;
}

function packetFor(eventId: string, horizon: ProspectiveResearchHorizon, packets: readonly ProspectivePacketRef[]): ProspectivePacketRef | null {
  return packets.find((packet) => packet.eventId === eventId && packet.horizon === horizon) ?? null;
}

function actualFor(eventId: string, actuals: readonly ProspectiveActualRef[]): ProspectiveActualRef | null {
  return actuals.find((actual) => actual.eventId === eventId) ?? null;
}

export function buildProspectiveResearchQueueV1(input: {
  readonly asOfTs: string;
  readonly events: readonly ProspectiveCohortEvent[];
  readonly snapshots?: readonly ProspectiveSnapshotRef[];
  readonly packets?: readonly ProspectivePacketRef[];
  readonly actuals?: readonly ProspectiveActualRef[];
}): ProspectiveResearchQueue {
  const asOf = instant(input.asOfTs, "asOfTs");
  const snapshots = input.snapshots ?? [];
  const packets = input.packets ?? [];
  const actuals = input.actuals ?? [];
  const rows: ProspectiveCohortRow[] = [];

  const sortedEvents = [...input.events].sort((a, b) => {
    const aMs = new Date(a.event.event_date ?? "").getTime();
    const bMs = new Date(b.event.event_date ?? "").getTime();
    return (Number.isFinite(aMs) ? aMs : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bMs) ? bMs : Number.MAX_SAFE_INTEGER) || a.event.event_id.localeCompare(b.event.event_id);
  });

  for (const item of sortedEvents) {
    if (!item.event.event_date || !isProspectiveForecastStatus(item.status)) continue;
    let target: { iso: string; ms: number };
    try { target = instant(item.event.event_date, "event.event_date"); } catch { continue; }
    if (target.ms <= asOf.ms) continue;
    for (const horizon of PROSPECTIVE_HORIZONS) {
      const timingStatus = classifyProspectiveHorizon(horizon, target.iso, asOf.iso);
      const snapshot = matchingSnapshot(item.event.event_id, horizon, target.iso, snapshots);
      const packet = packetFor(item.event.event_id, horizon, packets);
      const actual = actualFor(item.event.event_id, actuals);
      const forecastState = snapshot ? "captured" : timingStatus === "MISSED" ? "missed" : timingStatus === "NOT_YET_DUE" ? "not_yet_due" : item.event.buy_in != null ? "due" : "unavailable";
      const packetState = packet?.state ?? "state_not_loaded";
      const actualState = actual?.state ?? "state_not_loaded";
      const stateNotLoaded = packetState === "state_not_loaded" || actualState === "state_not_loaded";
      const evaluationState = !snapshot
        ? "not_started"
        : stateNotLoaded
          ? "state_not_loaded"
          : actualState === "current"
            ? "available"
            : "pending";
      let nextAction: ProspectiveNextAction = "no_action";
      if (!snapshot && forecastState === "due") nextAction = "capture_forecast";
      else if (!snapshot && forecastState === "not_yet_due") nextAction = "not_yet_due";
      else if (!snapshot && forecastState === "missed") nextAction = "missed";
      else if (!snapshot) nextAction = "forecast_unavailable";
      else if (stateNotLoaded) nextAction = "open_decision_room";
      else if (actualState === "current" && evaluationState === "available") nextAction = "no_action";
      else if (target.ms <= asOf.ms) nextAction = "promote_native_actual";
      else nextAction = "evaluation_pending";
      rows.push(freezeDeep({
        eventId: item.event.event_id,
        eventName: item.event.event_name,
        targetEventTs: target.iso,
        horizon,
        dueAt: horizonDueAt(horizon, target.iso),
        timingStatus,
        leadTimeMinutes: policyFor(horizon).leadTimeMinutes,
        forecastState,
        packetState,
        actualState,
        evaluationState,
        nextAction,
        snapshotId: snapshot?.id ?? null,
        packetId: packet?.packetId ?? null,
      }));
    }
  }
  return freezeDeep({ version: PROSPECTIVE_RESEARCH_COHORT_VERSION, policyId: PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1, asOfTs: asOf.iso, rows });
}

export function buildNativeTruthPromotionQueueV1(input: {
  readonly asOfTs: string;
  readonly events: readonly { readonly id: string; readonly start_time: string | null; readonly status: string | null }[];
}): readonly { readonly eventId: string; readonly startTime: string }[] {
  const asOf = instant(input.asOfTs, "asOfTs");
  return freezeDeep(input.events
    .filter((event) => event.start_time !== null && new Date(event.start_time).getTime() < asOf.ms && event.status === "completed")
    .map((event) => ({ eventId: event.id, startTime: new Date(event.start_time as string).toISOString() }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.eventId.localeCompare(b.eventId)));
}

export async function buildProspectiveEngineSnapshotV1(input: {
  readonly event: SeriesEvent;
  readonly history: readonly SeriesEvent[];
  readonly horizon: ProspectiveResearchHorizon;
  readonly capturedAt: string;
  readonly codeSha?: string;
  readonly options?: ForecastOptions;
}): Promise<ProspectiveSnapshotBuildResult> {
  if (!input.event.event_date) return { ok: false, code: "invalid_event_time", reason: "Event has no start time." };
  if (input.event.buy_in == null || !(input.event.buy_in > 0) || !Number.isFinite(input.event.buy_in)) return { ok: false, code: "invalid_buy_in", reason: "Event buy-in is missing or invalid." };
  let captured: { iso: string; ms: number };
  let target: { iso: string; ms: number };
  try {
    captured = instant(input.capturedAt, "capturedAt");
    target = instant(input.event.event_date, "event.event_date");
  } catch {
    return { ok: false, code: "invalid_event_time", reason: "Event or capture timestamp is invalid." };
  }
  if (captured.ms >= target.ms) return { ok: false, code: "event_already_started", reason: "Prospective capture stops when the event starts." };
  const pointInTimeHistory = input.history.filter((event) => {
    if (!event.event_date) return false;
    const eventMs = new Date(event.event_date).getTime();
    if (!Number.isFinite(eventMs) || eventMs >= captured.ms) return false;
    if (!Number.isFinite(event.total_entries ?? NaN)) return false;
    if (!event.outcome_available_at) return false;
    const outcomeAvailableMs = new Date(event.outcome_available_at).getTime();
    return Number.isFinite(outcomeAvailableMs) && outcomeAvailableMs <= captured.ms;
  });
  const targetInput = {
    event_date: target.iso,
    buy_in: input.event.buy_in,
    gtd: input.event.gtd,
    event_name: input.event.event_name,
    typeKeyword: null,
    capacity: input.event.capacity ?? null,
  };
  const options = input.options ?? {};
  const forecast = forecastTurnout(pointInTimeHistory, targetInput, options);
  if (!forecast.available || forecast.base === null || forecast.low === null || forecast.high === null) {
    return { ok: false, code: "forecast_unavailable", reason: forecast.missingDataNotes.join(" ") || "Forecast is unavailable." };
  }
  let provenance: ForecastProvenance;
  try {
    provenance = await buildForecastProvenance(
      pointInTimeHistory,
      targetInput,
      options,
      { forecastIssuedAt: captured.iso, asOfTs: captured.iso, targetEventTs: target.iso },
      { kind: "engine", ...(input.codeSha === undefined ? {} : { codeSha: input.codeSha }) },
    );
  } catch (error) {
    return { ok: false, code: "provenance_failed", reason: error instanceof Error ? error.message : "Could not build forecast provenance." };
  }
  const provenanceColumns = toForecastProvenanceSnapshotColumns(provenance);
  const insert = freezeDeep({
    event_id: input.event.event_id,
    horizon: input.horizon,
    days_before: Math.max(0, Math.floor((target.ms - captured.ms) / MS_PER_DAY)),
    forecast_low: forecast.low,
    forecast_base: forecast.base,
    forecast_high: forecast.high,
    confidence_tier: forecast.confidence,
    candidate_gtd: input.event.gtd,
    overlay_risk_pct: null,
    source_label: "engine",
    notes: "Prospective capture V1; owner review required; post-event fields excluded.",
    ...provenanceColumns,
  });
  return freezeDeep({ ok: true, forecast: freezeDeep(forecast), provenance, insert });
}
