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

function errorFields(error: unknown): { code: string; message: string } {
  if (!error || typeof error !== "object") {
    return { code: "", message: String(error ?? "") };
  }

  const value = error as { code?: unknown; message?: unknown };
  return {
    code: String(value.code ?? "").toUpperCase(),
    message: String(value.message ?? ""),
  };
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
