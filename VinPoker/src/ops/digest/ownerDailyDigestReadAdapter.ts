export type OwnerDigestMoneyState = "NONE" | "PROVISIONAL" | "CLOSED";
export type OwnerDigestFreshnessState = "FRESH" | "PARTIAL" | "STALE";

export type OwnerDailyDigestReport = {
  schemaVersion: 1 | 2;
  digestId: string;
  clubId: string;
  reportDate: string;
  generatedAt: string;
  sourceAsOf: string | null;
  snapshotVersion: number | null;
  calculationVersion: string | null;
  effectiveTimezone: string | null;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  moneyState: OwnerDigestMoneyState;
  freshnessState: OwnerDigestFreshnessState;
  registrations: number;
  attendance: number;
  entries: number;
  staffCount: number;
  rakeAmount: number | null;
  serviceFeeAmount: number | null;
  fnbAmount: number | null;
  outstandingPayoutAmount: number | null;
  provisionalPayrollAmount: number | null;
  warningCodes: string[];
  actionCodes: string[];
};

export type OwnerDailyDigestReadInput = {
  clubId: string;
  reportDate?: string;
};

export interface OwnerDailyDigestReadSource {
  getLatest(input: OwnerDailyDigestReadInput): Promise<unknown | null>;
}

export class OwnerDailyDigestReadError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "OwnerDailyDigestReadError";
  }
}

export async function loadOwnerDailyDigestReport(
  source: OwnerDailyDigestReadSource,
  input: OwnerDailyDigestReadInput,
): Promise<OwnerDailyDigestReport | null> {
  const artifact = await source.getLatest(input);
  if (artifact === null) return null;
  const report = parseOwnerDailyDigestArtifact(artifact);
  if (report.clubId !== input.clubId) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_CROSS_CLUB_RESPONSE");
  }
  if (input.reportDate && report.reportDate !== input.reportDate) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_REPORT_DATE_MISMATCH");
  }
  return report;
}

export function parseOwnerDailyDigestArtifact(value: unknown): OwnerDailyDigestReport {
  const artifact = asRecord(value, "OWNER_DIGEST_ARTIFACT_MALFORMED");
  if (artifact.artifact_type !== "OWNER_DAILY_DIGEST") {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCHEMA_UNSUPPORTED");
  }
  if (artifact.schema_version === 2) return parseV2Artifact(artifact);
  if (artifact.schema_version !== 1) throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCHEMA_UNSUPPORTED");
  const payload = asRecord(artifact.content_payload, "OWNER_DIGEST_PAYLOAD_MALFORMED");
  const metrics = asRecord(payload.metrics, "OWNER_DIGEST_METRICS_MALFORMED");
  const moneyState = enumValue(payload.money_state, ["NONE", "PROVISIONAL", "CLOSED"] as const);
  const freshnessState = enumValue(payload.freshness_state, ["FRESH", "PARTIAL", "STALE"] as const);

  return {
    schemaVersion: 1,
    digestId: uuid(artifact.artifact_id, "OWNER_DIGEST_ID_MALFORMED"),
    clubId: uuid(artifact.club_id, "OWNER_DIGEST_CLUB_ID_MALFORMED"),
    reportDate: dateOnly(payload.business_date, "OWNER_DIGEST_DATE_MALFORMED"),
    generatedAt: dateTime(artifact.generated_at, "OWNER_DIGEST_GENERATED_AT_MALFORMED"),
    sourceAsOf: null,
    snapshotVersion: null,
    calculationVersion: null,
    effectiveTimezone: null,
    windowStartUtc: null,
    windowEndUtc: null,
    moneyState,
    freshnessState,
    registrations: nonNegativeInteger(metrics.registrations),
    attendance: nonNegativeInteger(metrics.attendance),
    entries: nonNegativeInteger(metrics.entries),
    staffCount: nonNegativeInteger(metrics.staff),
    rakeAmount: nonNegativeInteger(metrics.rake_retained_vnd),
    serviceFeeAmount: null,
    fnbAmount: nonNegativeInteger(metrics.fnb_net_revenue_vnd),
    outstandingPayoutAmount: nonNegativeInteger(metrics.pending_liabilities_vnd),
    provisionalPayrollAmount: nonNegativeInteger(metrics.payroll_provisional_vnd),
    warningCodes: codeList(payload.warning_codes),
    actionCodes: codeList(payload.action_codes),
  };
}

function parseV2Artifact(artifact: Record<string, unknown>): OwnerDailyDigestReport {
  const payload = asRecord(artifact.content_payload, "OWNER_DIGEST_PAYLOAD_MALFORMED");
  const metrics = asRecord(payload.metrics, "OWNER_DIGEST_METRICS_MALFORMED");
  const moneyState = enumValue(payload.money_state, ["PROVISIONAL"] as const);
  const freshnessState = enumValue(payload.freshness_state, ["FRESH", "PARTIAL"] as const);
  const registered = countMetric(metrics.registered_players);
  const attendance = countMetric(metrics.attendance_players);
  const entries = countMetric(metrics.entries_count);
  const staff = countMetric(metrics.staff_count);

  return {
    schemaVersion: 2,
    digestId: uuid(artifact.artifact_id, "OWNER_DIGEST_ID_MALFORMED"),
    clubId: uuid(artifact.club_id, "OWNER_DIGEST_CLUB_ID_MALFORMED"),
    reportDate: dateOnly(payload.business_date, "OWNER_DIGEST_DATE_MALFORMED"),
    generatedAt: dateTime(artifact.generated_at, "OWNER_DIGEST_GENERATED_AT_MALFORMED"),
    sourceAsOf: dateTime(artifact.source_as_of, "OWNER_DIGEST_SOURCE_AS_OF_MALFORMED"),
    snapshotVersion: positiveInteger(artifact.snapshot_version),
    calculationVersion: calculationVersion(artifact.calculation_version),
    effectiveTimezone: timezone(payload.effective_timezone),
    windowStartUtc: dateTime(payload.window_start_utc, "OWNER_DIGEST_WINDOW_MALFORMED"),
    windowEndUtc: dateTime(payload.window_end_utc, "OWNER_DIGEST_WINDOW_MALFORMED"),
    moneyState,
    freshnessState,
    registrations: registered,
    attendance,
    entries,
    staffCount: staff,
    rakeAmount: moneyMetric(metrics.rake_paid_vnd),
    serviceFeeAmount: moneyMetric(metrics.service_fee_paid_vnd),
    fnbAmount: signedMoneyMetric(metrics.fnb_net_revenue_vnd),
    outstandingPayoutAmount: moneyMetric(metrics.payout_outstanding_vnd),
    provisionalPayrollAmount: moneyMetric(metrics.dealer_payroll_outstanding_vnd),
    warningCodes: codeList(payload.warning_codes),
    actionCodes: codeList(payload.action_codes),
  };
}

export const unavailableOwnerDailyDigestSource: OwnerDailyDigestReadSource = {
  async getLatest() {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_READ_BOUNDARY_NOT_LIVE");
  },
};

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OwnerDailyDigestReadError(code);
  }
  return value as Record<string, unknown>;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_STATUS_MALFORMED");
  }
  return value as T[number];
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_AMOUNT_MALFORMED");
  }
  return value;
}

function positiveInteger(value: unknown): number {
  const result = nonNegativeInteger(value);
  if (result === 0) throw new OwnerDailyDigestReadError("OWNER_DIGEST_VERSION_MALFORMED");
  return result;
}

function countMetric(value: unknown): number {
  const metric = asRecord(value, "OWNER_DIGEST_METRIC_MALFORMED");
  if (metric.state !== "AVAILABLE") throw new OwnerDailyDigestReadError("OWNER_DIGEST_METRIC_MALFORMED");
  return nonNegativeInteger(metric.value);
}

function moneyMetric(value: unknown): number | null {
  const metric = asRecord(value, "OWNER_DIGEST_METRIC_MALFORMED");
  const state = enumValue(metric.state, ["AVAILABLE", "UNAVAILABLE"] as const);
  if (state === "UNAVAILABLE") {
    if (metric.value !== null) throw new OwnerDailyDigestReadError("OWNER_DIGEST_METRIC_MALFORMED");
    return null;
  }
  return nonNegativeInteger(metric.value);
}

function signedMoneyMetric(value: unknown): number | null {
  const metric = asRecord(value, "OWNER_DIGEST_METRIC_MALFORMED");
  const state = enumValue(metric.state, ["AVAILABLE", "UNAVAILABLE"] as const);
  if (state === "UNAVAILABLE") {
    if (metric.value !== null) throw new OwnerDailyDigestReadError("OWNER_DIGEST_METRIC_MALFORMED");
    return null;
  }
  if (typeof metric.value !== "number" || !Number.isSafeInteger(metric.value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_AMOUNT_MALFORMED");
  }
  return metric.value;
}

function calculationVersion(value: unknown): string {
  if (typeof value !== "string" || !/^owner-daily-digest-v\d+\.\d+\.\d+$/u.test(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_VERSION_MALFORMED");
  }
  return value;
}

function timezone(value: unknown): string {
  if (typeof value !== "string" || value.length < 3 || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/u.test(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_TIMEZONE_MALFORMED");
  }
  return value;
}

function uuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new OwnerDailyDigestReadError(code);
  }
  return value;
}

function dateOnly(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new OwnerDailyDigestReadError(code);
  }
  return value;
}

function dateTime(value: unknown, code: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new OwnerDailyDigestReadError(code);
  }
  return value;
}

function codeList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !/^[A-Z0-9_]+$/u.test(item))) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_CODES_MALFORMED");
  }
  return [...new Set(value)];
}
