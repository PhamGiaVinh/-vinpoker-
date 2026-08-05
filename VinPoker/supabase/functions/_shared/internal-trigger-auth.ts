const encoder = new TextEncoder();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;

export const INTERNAL_TRIGGER_HEADER = "x-vinpoker-internal-secret";
export const INTERNAL_TRIGGER_SECRET_ENV = "DEALER_TRIGGER_INTERNAL_SECRET";

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: "internal_auth_denied" | "internal_auth_not_configured" };

export interface DealerReadyPayload {
  clubId: string;
  attendanceId: string;
}

export interface PushPayload {
  userId: string;
  heading: string;
  message: string;
  url?: string;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function authorizeInternalTrigger(
  request: Request,
  expectedSecret = Deno.env.get(INTERNAL_TRIGGER_SECRET_ENV),
): InternalAuthResult {
  if (!expectedSecret) {
    return { ok: false, status: 503, code: "internal_auth_not_configured" };
  }

  const suppliedSecret = request.headers.get(INTERNAL_TRIGGER_HEADER);
  if (!suppliedSecret || !constantTimeEqual(suppliedSecret, expectedSecret)) {
    return { ok: false, status: 401, code: "internal_auth_denied" };
  }

  return { ok: true };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function getIdempotencyKey(request: Request): string | null {
  const key = request.headers.get("x-idempotency-key");
  return key && IDEMPOTENCY_KEY_PATTERN.test(key) ? key : null;
}

export function parseDealerReadyPayload(value: unknown): DealerReadyPayload | null {
  if (!value || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  if (!isUuid(payload.club_id) || !isUuid(payload.attendance_id)) return null;

  return {
    clubId: payload.club_id,
    attendanceId: payload.attendance_id,
  };
}

export function isApprovedInternalPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return false;
  }

  try {
    const parsed = new URL(value, "https://vinpoker.internal");
    return parsed.origin === "https://vinpoker.internal";
  } catch {
    return false;
  }
}

export function parsePushPayload(value: unknown): PushPayload | null {
  if (!value || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  if (
    !isUuid(payload.user_id) ||
    typeof payload.heading !== "string" ||
    !payload.heading.trim() ||
    payload.heading.length > 120 ||
    typeof payload.message !== "string" ||
    !payload.message.trim() ||
    payload.message.length > 1000
  ) {
    return null;
  }

  if (
    payload.url !== undefined &&
    (typeof payload.url !== "string" || payload.url.length > 512 || !isApprovedInternalPath(payload.url))
  ) {
    return null;
  }

  return {
    userId: payload.user_id,
    heading: payload.heading,
    message: payload.message,
    ...(typeof payload.url === "string" ? { url: payload.url } : {}),
  };
}
