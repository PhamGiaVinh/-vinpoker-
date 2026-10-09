import { constantTimeEqual } from "../internal-trigger-auth.ts";

export const HISTORY_CANARY_SECRET_ENV = "TRACKER_HISTORY_CANARY_INTERNAL_SECRET";

/** A separate canary credential cannot authorize an unscoped queue drain. */
export function authorizeHistoryWorker(
  request: Request,
  serviceKey: string | undefined,
  canarySecret: string | undefined,
): { ok: true; scopedOnly: boolean } | { ok: false } {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { ok: false };
  if (canarySecret && constantTimeEqual(token, canarySecret)) {
    return { ok: true, scopedOnly: true };
  }
  if (serviceKey && constantTimeEqual(token, serviceKey)) {
    return { ok: true, scopedOnly: false };
  }
  return { ok: false };
}
