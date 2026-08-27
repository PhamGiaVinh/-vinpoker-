const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR = /^(?:PAYROLL_DELIVERY|TELEGRAM)_[A-Z0-9_]{1,80}$/;

export interface PayrollStatementDeliveryRequest {
  operation_id: string;
}

export function parsePayrollStatementDeliveryRequest(value: unknown): PayrollStatementDeliveryRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !isUuid(body.operation_id)) return null;
  return { operation_id: body.operation_id };
}

export function sanitizePayrollStatementDeliveryError(
  error: unknown,
  fallback = "PAYROLL_DELIVERY_FAILED",
): string {
  const candidates = [
    error instanceof Error ? error.message : null,
    typeof error === "object" && error !== null ? (error as Record<string, unknown>).code : null,
  ];
  const code = candidates.find((candidate): candidate is string => typeof candidate === "string" && SAFE_ERROR.test(candidate));
  return code ?? fallback;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function safeTelegramProviderCode(status: number | null, transportUnknown = false): string {
  if (transportUnknown) return "TELEGRAM_TRANSPORT_UNKNOWN";
  if (Number.isInteger(status) && status! >= 400 && status! <= 599) return `TELEGRAM_HTTP_${status}`;
  return "TELEGRAM_DELIVERY_FAILED";
}

export function boundedRetryAfterSeconds(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86_400 ? seconds : null;
}
