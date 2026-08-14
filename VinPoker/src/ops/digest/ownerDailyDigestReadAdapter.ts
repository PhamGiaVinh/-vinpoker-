export type OwnerDigestMoneyState = "NONE" | "PROVISIONAL" | "CLOSED";
export type OwnerDigestFreshnessState = "FRESH" | "PARTIAL" | "STALE";

export type OwnerDailyDigestReport = {
  digestId: string;
  clubId: string;
  reportDate: string;
  generatedAt: string;
  moneyState: OwnerDigestMoneyState;
  freshnessState: OwnerDigestFreshnessState;
  registrations: number;
  attendance: number;
  entries: number;
  staffCount: number;
  rakeAmount: number;
  fnbAmount: number;
  outstandingPayoutAmount: number;
  provisionalPayrollAmount: number;
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
  if (artifact.artifact_type !== "OWNER_DAILY_DIGEST" || artifact.schema_version !== 1) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCHEMA_UNSUPPORTED");
  }
  const payload = asRecord(artifact.content_payload, "OWNER_DIGEST_PAYLOAD_MALFORMED");
  const metrics = asRecord(payload.metrics, "OWNER_DIGEST_METRICS_MALFORMED");
  const moneyState = enumValue(payload.money_state, ["NONE", "PROVISIONAL", "CLOSED"] as const);
  const freshnessState = enumValue(payload.freshness_state, ["FRESH", "PARTIAL", "STALE"] as const);

  return {
    digestId: uuid(artifact.artifact_id, "OWNER_DIGEST_ID_MALFORMED"),
    clubId: uuid(artifact.club_id, "OWNER_DIGEST_CLUB_ID_MALFORMED"),
    reportDate: dateOnly(payload.business_date, "OWNER_DIGEST_DATE_MALFORMED"),
    generatedAt: dateTime(artifact.generated_at, "OWNER_DIGEST_GENERATED_AT_MALFORMED"),
    moneyState,
    freshnessState,
    registrations: nonNegativeInteger(metrics.registrations),
    attendance: nonNegativeInteger(metrics.attendance),
    entries: nonNegativeInteger(metrics.entries),
    staffCount: nonNegativeInteger(metrics.staff),
    rakeAmount: nonNegativeInteger(metrics.rake_retained_vnd),
    fnbAmount: nonNegativeInteger(metrics.fnb_net_revenue_vnd),
    outstandingPayoutAmount: nonNegativeInteger(metrics.pending_liabilities_vnd),
    provisionalPayrollAmount: nonNegativeInteger(metrics.payroll_provisional_vnd),
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

function uuid(value: unknown, code: string): string {
  // Preserve the same PostgreSQL uuid contract as club scope loading. Legacy
  // club identifiers can be canonical in Postgres without RFC version bits.
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
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
