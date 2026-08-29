export type OpsQuantAvailabilityQ0 = "exact" | "partial" | "stale" | "unavailable";
export type OpsQuantClassificationQ0 = "OBSERVED" | "DERIVED";

export interface OpsRegistrationTimelineBucketQ0 {
  readonly bucketStart: string;
  readonly observedCount: number;
  readonly cumulativeCount: number;
}

export interface OpsRegistrationEventQ0 {
  readonly eventId: string;
  readonly eventName: string;
  readonly eventState: string;
  readonly startTime: string;
  readonly confirmedEntries: number;
  readonly uniquePlayers: number;
  readonly reentries: number;
  readonly firstRegistrationAt: string | null;
  readonly lastRegistrationAt: string | null;
  readonly last1h: number;
  readonly last6h: number;
  readonly last24h: number;
  readonly timelineAvailability: "exact" | "partial";
  readonly timelineReasonCode: string | null;
  readonly timeline: readonly OpsRegistrationTimelineBucketQ0[];
}

export interface OpsRegistrationPaceQ0 {
  readonly version: "ops-registration-observed-q0";
  readonly clubId: string;
  readonly asOf: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly events: readonly OpsRegistrationEventQ0[];
}

export type OpsSepayStateQ0 = "actionable" | "resolved" | "quarantined";

export interface OpsSepayBucketQ0 {
  readonly state: OpsSepayStateQ0;
  readonly transactionCount: number;
  readonly inboundAmountVnd: number;
  readonly amountAvailability: "exact" | "partial";
  readonly amountReasonCode: string | null;
}

export interface OpsSepayReadStateQ0 {
  readonly version: "ops-sepay-read-state-q0";
  readonly clubId: string;
  readonly asOf: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly latestObservedTransactionAt: string | null;
  readonly buckets: readonly OpsSepayBucketQ0[];
}

export interface OpsDataHealthRowQ0 {
  readonly sourceId: string;
  readonly label: string;
  readonly authority: string;
  readonly grain: string;
  readonly classification: OpsQuantClassificationQ0;
  readonly availability: OpsQuantAvailabilityQ0;
  readonly asOf: string | null;
  readonly observedAt: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly reasonCode: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export function parseOpsRegistrationPaceQ0(value: unknown): OpsRegistrationPaceQ0 {
  const root = record(value, "registration root");
  exactKeys(root, ["version", "clubId", "asOf", "window", "events"]);
  if (root.version !== "ops-registration-observed-q0") fail("registration version");
  const clubId = uuid(root.clubId, "registration clubId");
  const asOf = timestamp(root.asOf, "registration asOf");
  const window = parseWindow(root.window, "registration window");
  const events = array(root.events, "registration events").map((item, index) => parseRegistrationEvent(item, index));
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.eventId)) fail("duplicate registration event");
    ids.add(event.eventId);
  }
  return deepFreeze({ version: "ops-registration-observed-q0", clubId, asOf, window, events });
}

export function parseOpsSepayReadStateQ0(value: unknown): OpsSepayReadStateQ0 {
  const root = record(value, "sepay root");
  exactKeys(root, ["version", "clubId", "asOf", "window", "latestObservedTransactionAt", "buckets"]);
  if (root.version !== "ops-sepay-read-state-q0") fail("sepay version");
  const clubId = uuid(root.clubId, "sepay clubId");
  const asOf = timestamp(root.asOf, "sepay asOf");
  const window = parseWindow(root.window, "sepay window");
  const latestObservedTransactionAt = nullableTimestamp(root.latestObservedTransactionAt, "sepay latestObservedTransactionAt");
  const buckets = array(root.buckets, "sepay buckets").map((item) => {
    const bucket = record(item, "sepay bucket");
    exactKeys(bucket, ["state", "transactionCount", "inboundAmountVnd", "amountAvailability", "amountReasonCode"]);
    if (!isSepayState(bucket.state)) fail("sepay state");
    if (!isCompletenessAvailability(bucket.amountAvailability)) fail("sepay amountAvailability");
    if (bucket.amountAvailability === "exact" && bucket.amountReasonCode !== null) fail("exact sepay amount reason");
    if (bucket.amountAvailability !== "exact" && typeof bucket.amountReasonCode !== "string") fail("partial sepay amount reason");
    return deepFreeze({
      state: bucket.state,
      transactionCount: safeInteger(bucket.transactionCount, "sepay transactionCount"),
      inboundAmountVnd: safeInteger(bucket.inboundAmountVnd, "sepay inboundAmountVnd"),
      amountAvailability: bucket.amountAvailability,
      amountReasonCode: bucket.amountReasonCode as string | null,
    });
  });
  const states = new Set(buckets.map((bucket) => bucket.state));
  if (states.size !== buckets.length) fail("duplicate sepay state");
  if (!["actionable", "resolved", "quarantined"].every((state) => states.has(state as OpsSepayStateQ0))) fail("missing sepay state");
  return deepFreeze({ version: "ops-sepay-read-state-q0", clubId, asOf, window, latestObservedTransactionAt, buckets });
}

export function buildOpsDataHealthQ0(input: {
  readonly registration: { readonly value: OpsRegistrationPaceQ0 | null; readonly observedAt: string; readonly reasonCode: string | null };
  readonly sepay: { readonly value: OpsSepayReadStateQ0 | null; readonly observedAt: string; readonly reasonCode: string | null };
  readonly eventStreamObservedAt: string;
}): readonly OpsDataHealthRowQ0[] {
  return deepFreeze([
    sourceRow("registration-pace", "Nhịp đăng ký", "get_ops_registration_pace_q0", "club_event_confirmed_registration_hour", "OBSERVED", input.registration.value?.asOf ?? null, input.registration.observedAt, registrationAvailability(input.registration), input.registration.reasonCode ?? registrationPartialReason(input.registration.value)),
    sourceRow("sepay", "SePay", "get_ops_sepay_read_state_q0", "club_bank_transaction_state_24h", "DERIVED", input.sepay.value?.asOf ?? null, input.sepay.observedAt, sepayAvailability(input.sepay), input.sepay.reasonCode ?? sepayPartialReason(input.sepay.value)),
    sourceRow("event-stream", "Event stream", "none", "none", "OBSERVED", null, input.eventStreamObservedAt, "unavailable", "EVENT_SOURCE_NOT_APPROVED"),
  ]);
}

function parseRegistrationEvent(value: unknown, index: number): OpsRegistrationEventQ0 {
  const event = record(value, `registration event ${index}`);
  exactKeys(event, ["eventId", "eventName", "eventState", "startTime", "confirmedEntries", "uniquePlayers", "reentries", "firstRegistrationAt", "lastRegistrationAt", "last1h", "last6h", "last24h", "timelineAvailability", "timelineReasonCode", "timeline"]);
  const availability = event.timelineAvailability;
  if (!isCompletenessAvailability(availability)) fail("registration timelineAvailability");
  const timeline = array(event.timeline, "registration timeline").map((item) => {
    const bucket = record(item, "registration timeline bucket");
    exactKeys(bucket, ["bucketStart", "observedCount", "cumulativeCount"]);
    return deepFreeze({ bucketStart: timestamp(bucket.bucketStart, "registration bucketStart"), observedCount: safeInteger(bucket.observedCount, "registration bucket observed count"), cumulativeCount: safeInteger(bucket.cumulativeCount, "registration bucket cumulative count") });
  });
  for (let i = 1; i < timeline.length; i += 1) {
    if (timeline[i - 1].bucketStart >= timeline[i].bucketStart) fail("registration timeline ordering");
    if (timeline[i - 1].cumulativeCount > timeline[i].cumulativeCount) fail("registration timeline cumulative ordering");
  }
  const confirmedEntries = safeInteger(event.confirmedEntries, "registration confirmedEntries");
  const uniquePlayers = safeInteger(event.uniquePlayers, "registration uniquePlayers");
  const reentries = safeInteger(event.reentries, "registration reentries");
  const last1h = safeInteger(event.last1h, "registration last1h");
  const last6h = safeInteger(event.last6h, "registration last6h");
  const last24h = safeInteger(event.last24h, "registration last24h");
  const firstRegistrationAt = nullableTimestamp(event.firstRegistrationAt, "registration firstRegistrationAt");
  const lastRegistrationAt = nullableTimestamp(event.lastRegistrationAt, "registration lastRegistrationAt");
  if (uniquePlayers > confirmedEntries || reentries > confirmedEntries) fail("registration count invariant");
  if (last1h > last6h || last6h > last24h || last24h > confirmedEntries) fail("registration window invariant");
  if (timeline.some((bucket) => bucket.cumulativeCount > confirmedEntries || bucket.observedCount > bucket.cumulativeCount)) fail("registration timeline invariant");
  if (availability === "exact" && (timeline[timeline.length - 1]?.cumulativeCount ?? 0) !== confirmedEntries) fail("exact registration timeline total");
  if ((firstRegistrationAt === null) !== (lastRegistrationAt === null) || (firstRegistrationAt && lastRegistrationAt && firstRegistrationAt > lastRegistrationAt)) fail("registration receipt range");
  if (availability === "exact" && event.timelineReasonCode !== null) fail("exact timeline reason");
  if (availability !== "exact" && typeof event.timelineReasonCode !== "string") fail("partial timeline reason");
  return deepFreeze({
    eventId: uuid(event.eventId, "registration eventId"),
    eventName: text(event.eventName, "registration eventName"),
    eventState: text(event.eventState, "registration eventState"),
    startTime: timestamp(event.startTime, "registration startTime"),
    confirmedEntries,
    uniquePlayers,
    reentries,
    firstRegistrationAt,
    lastRegistrationAt,
    last1h,
    last6h,
    last24h,
    timelineAvailability: availability,
    timelineReasonCode: event.timelineReasonCode as string | null,
    timeline,
  });
}

function sourceRow(sourceId: string, label: string, authority: string, grain: string, classification: OpsQuantClassificationQ0, asOf: string | null, observedAt: string, availability: OpsQuantAvailabilityQ0, reasonCode: string | null): OpsDataHealthRowQ0 {
  return deepFreeze({ sourceId, label, authority, grain, classification, availability, asOf, observedAt, freshness: "unknown", reasonCode });
}

function registrationAvailability(receipt: { readonly value: OpsRegistrationPaceQ0 | null; readonly reasonCode: string | null }): OpsQuantAvailabilityQ0 {
  if (!receipt.value || receipt.reasonCode) return "unavailable";
  return receipt.value.events.some((event) => event.timelineAvailability === "partial") ? "partial" : "exact";
}

function sepayAvailability(receipt: { readonly value: OpsSepayReadStateQ0 | null; readonly reasonCode: string | null }): OpsQuantAvailabilityQ0 {
  if (!receipt.value || receipt.reasonCode) return "unavailable";
  return receipt.value.buckets.some((bucket) => bucket.amountAvailability === "partial") ? "partial" : "exact";
}

function registrationPartialReason(value: OpsRegistrationPaceQ0 | null): string | null {
  return value?.events.some((event) => event.timelineAvailability === "partial") ? "REGISTRATION_TIMELINE_PARTIAL" : null;
}

function sepayPartialReason(value: OpsSepayReadStateQ0 | null): string | null {
  return value?.buckets.some((bucket) => bucket.amountAvailability === "partial") ? "SEPAY_AMOUNT_PARTIAL" : null;
}

function parseWindow(value: unknown, label: string) {
  const window = record(value, label);
  exactKeys(window, ["from", "to"]);
  const from = timestamp(window.from, `${label} from`);
  const to = timestamp(window.to, `${label} to`);
  if (from >= to) fail(`${label} order`);
  return deepFreeze({ from, to });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) fail(label); return value; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("unexpected fields");
}
function uuid(value: unknown, label: string): string { if (typeof value !== "string" || !UUID_RE.test(value)) fail(label); return value; }
function timestamp(value: unknown, label: string): string { if (typeof value !== "string" || !ISO_RE.test(value) || !Number.isFinite(Date.parse(value))) fail(label); return value; }
function nullableTimestamp(value: unknown, label: string): string | null { return value === null ? null : timestamp(value, label); }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim() || value.length > 160) fail(label); return value; }
function safeInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) fail(label); return value as number; }
function isCompletenessAvailability(value: unknown): value is "exact" | "partial" { return value === "exact" || value === "partial"; }
function isSepayState(value: unknown): value is OpsSepayStateQ0 { return value === "actionable" || value === "resolved" || value === "quarantined"; }
function fail(label: string): never { throw new Error(`OPS_QUANT_Q0_INVALID_${label.split(" ").join("_").toUpperCase()}`); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
