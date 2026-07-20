const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProcessSwingDispatchContext {
  runId: string;
  requestId: string;
  clubId: string;
  tickAt: string;
}

export type EmptyFillStatus =
  | "ok"
  | "degraded"
  | "dependency_unavailable"
  | "query_failed";

export function assessEmptyFillOutcome(
  status: EmptyFillStatus,
  errorCode: string | null,
): {
  continueRotation: true;
  shortageAlertsAllowed: boolean;
  dispatchState: "completed" | "partial" | "dependency_unavailable";
  dispatchErrorCode: string | null;
} {
  if (status === "ok") {
    return {
      continueRotation: true,
      shortageAlertsAllowed: true,
      dispatchState: "completed",
      dispatchErrorCode: null,
    };
  }
  return {
    continueRotation: true,
    shortageAlertsAllowed: false,
    dispatchState: status === "dependency_unavailable" ? "dependency_unavailable" : "partial",
    dispatchErrorCode: errorCode ?? `empty_fill_${status}`,
  };
}

export function parseProcessSwingDispatchContext(
  body: Record<string, unknown>,
): ProcessSwingDispatchContext | null {
  const supplied = [body.run_id, body.request_id, body.tick_at]
    .filter((value) => value !== undefined).length;
  if (supplied === 0) return null;
  if (supplied !== 3) {
    throw new TypeError("run_id, request_id and tick_at must be supplied together");
  }
  if (body.club_ids !== undefined || typeof body.club_id !== "string") {
    throw new TypeError("correlated dispatch requires exactly one club_id");
  }
  if (typeof body.run_id !== "string" || !UUID_PATTERN.test(body.run_id)
      || typeof body.request_id !== "string" || !UUID_PATTERN.test(body.request_id)) {
    throw new TypeError("run_id and request_id must be UUID strings");
  }
  if (typeof body.tick_at !== "string") {
    throw new TypeError("tick_at must be an ISO timestamp");
  }
  const tickMs = Date.parse(body.tick_at);
  if (!Number.isFinite(tickMs)) {
    throw new TypeError("tick_at must be an ISO timestamp");
  }
  if (!UUID_PATTERN.test(body.club_id)) {
    throw new TypeError("club_id must be a UUID string");
  }

  return {
    runId: body.run_id.toLowerCase(),
    requestId: body.request_id.toLowerCase(),
    clubId: body.club_id.toLowerCase(),
    tickAt: new Date(tickMs).toISOString(),
  };
}
