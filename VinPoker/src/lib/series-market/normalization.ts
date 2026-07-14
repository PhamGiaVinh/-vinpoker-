import type {
  ClaimValue,
  DecimalClaimValue,
  InstantClaimValue,
  IntegerClaimValue,
  LocalDateClaimValue,
  MoneyClaimValue,
  PartialLocalDateTimeClaimValue,
  TextClaimValue,
} from "./contracts";

export class SeriesMarketValidationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SeriesMarketValidationError";
    this.code = code;
  }
}

export function compareCanonicalStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalStringSet(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.normalize("NFC")))].sort(compareCanonicalStrings);
}

export function normalizeStableKey(raw: string, label = "key"): string {
  const value = raw.normalize("NFC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    throw new SeriesMarketValidationError(`${label} must be a lowercase ASCII stable key`, "INVALID_STABLE_KEY");
  }
  return value;
}

export function normalizeTextValue(raw: string): TextClaimValue {
  return { type: "text", value: raw.normalize("NFC").trim() };
}

export function normalizeIntegerString(raw: string): string {
  const value = raw.trim();
  if (!/^[+-]?\d+$/.test(value)) {
    throw new SeriesMarketValidationError("integer must contain decimal digits only", "INVALID_INTEGER");
  }
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "");
  if (/^0+$/.test(unsigned)) return "0";
  return `${negative ? "-" : ""}${unsigned}`;
}

export function normalizeIntegerValue(raw: string): IntegerClaimValue {
  return { type: "integer", value: normalizeIntegerString(raw) };
}

export function normalizeDecimalString(raw: string): string {
  const value = raw.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw new SeriesMarketValidationError("decimal must use plain base-10 notation", "INVALID_DECIMAL");
  }
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [rawWhole, rawFraction = ""] = unsigned.startsWith(".") ? ["0", unsigned.slice(1)] : unsigned.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  const isZero = whole === "0" && fraction === "";
  return `${negative && !isZero ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function normalizeDecimalValue(raw: string): DecimalClaimValue {
  return { type: "decimal", value: normalizeDecimalString(raw) };
}

export function normalizeCurrency(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new SeriesMarketValidationError("currency must be a three-letter ISO-4217 code", "INVALID_CURRENCY");
  }
  return value;
}

export function normalizeMoneyValue(input: Omit<MoneyClaimValue, "type">): MoneyClaimValue {
  if (!Number.isInteger(input.scale) || input.scale < 0 || input.scale > 18) {
    throw new SeriesMarketValidationError("money scale must be an integer from 0 to 18", "INVALID_MONEY_SCALE");
  }
  return {
    type: "money",
    minorUnits: normalizeIntegerString(input.minorUnits),
    currency: normalizeCurrency(input.currency),
    scale: input.scale,
  };
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new SeriesMarketValidationError("local date must be YYYY-MM-DD", "INVALID_LOCAL_DATE");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new SeriesMarketValidationError("local date is not a real calendar date", "INVALID_LOCAL_DATE");
  }
  return { year, month, day };
}

export function normalizeLocalDate(raw: string): LocalDateClaimValue {
  const value = raw.trim();
  dateParts(value);
  return { type: "local_date", value };
}

function validateTimeZone(raw: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "") throw new SeriesMarketValidationError("time zone must not be blank", "INVALID_TIME_ZONE");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    throw new SeriesMarketValidationError("time zone must be a valid IANA identifier", "INVALID_TIME_ZONE");
  }
  return value;
}

export function normalizePartialLocalDateTime(
  input: Omit<PartialLocalDateTimeClaimValue, "type">,
): PartialLocalDateTimeClaimValue {
  const local = input.local.trim();
  const pattern = input.precision === "minute"
    ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/
    : /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
  const match = local.match(pattern);
  if (!match) {
    throw new SeriesMarketValidationError("local date/time does not match its precision", "INVALID_PARTIAL_LOCAL_TIME");
  }
  dateParts(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] === undefined ? 0 : Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new SeriesMarketValidationError("local date/time contains an invalid clock value", "INVALID_PARTIAL_LOCAL_TIME");
  }
  return {
    type: "partial_local_datetime",
    local,
    timeZone: validateTimeZone(input.timeZone),
    precision: input.precision,
  };
}

export function normalizeInstant(raw: string): string {
  const value = raw.trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new SeriesMarketValidationError("instant requires an explicit UTC offset", "INSTANT_OFFSET_REQUIRED");
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new SeriesMarketValidationError("instant is invalid", "INVALID_INSTANT");
  return new Date(ms).toISOString();
}

export function normalizeInstantValue(raw: string): InstantClaimValue {
  return { type: "instant", value: normalizeInstant(raw) };
}

/** Return a fresh canonical value. It never mutates the caller's object. */
export function normalizeClaimValue(value: ClaimValue): ClaimValue {
  switch (value.type) {
    case "text":
      return normalizeTextValue(value.value);
    case "boolean":
      return { type: "boolean", value: value.value };
    case "integer":
      return normalizeIntegerValue(value.value);
    case "decimal":
      return normalizeDecimalValue(value.value);
    case "money":
      return normalizeMoneyValue(value);
    case "local_date":
      return normalizeLocalDate(value.value);
    case "partial_local_datetime":
      return normalizePartialLocalDateTime(value);
    case "instant":
      return normalizeInstantValue(value.value);
    case "missing":
      return { type: "missing", reason: value.reason };
  }
}
