export type PostgrestFailureStatus = "dependency_unavailable" | "query_failed";

export interface PostgrestFailureClassification {
  status: PostgrestFailureStatus;
  sanitizedCode: string;
}

const DEPENDENCY_ERROR_CODES = new Set([
  "42P01",
  "42703",
  "42883",
  "PGRST200",
  "PGRST202",
  "PGRST204",
]);

const DEPENDENCY_ERROR_MESSAGE =
  /schema cache|does not exist|could not find the (table|column|function|relationship)/i;

function errorFields(error: unknown): { code: string; message: string; httpStatus: number | null } {
  if (!error || typeof error !== "object") {
    return { code: "", message: String(error ?? ""), httpStatus: null };
  }

  const value = error as { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown };
  const rawStatus = value.status ?? value.statusCode;
  const httpStatus = typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : null;
  return {
    code: String(value.code ?? "").toUpperCase(),
    message: String(value.message ?? ""),
    httpStatus,
  };
}

/** Returns only a validated HTTP status; provider messages and headers are never retained. */
export function postgrestHttpStatus(error: unknown): number | null {
  return errorFields(error).httpStatus;
}

export function classifyPostgrestError(error: unknown): PostgrestFailureClassification {
  const { code, message } = errorFields(error);
  const status: PostgrestFailureStatus = DEPENDENCY_ERROR_CODES.has(code)
      || DEPENDENCY_ERROR_MESSAGE.test(message)
    ? "dependency_unavailable"
    : "query_failed";

  return {
    status,
    sanitizedCode: /^[A-Z0-9_]{1,32}$/.test(code)
      ? code
      : status === "dependency_unavailable"
        ? "DEPENDENCY_UNAVAILABLE"
        : "QUERY_FAILED",
  };
}
