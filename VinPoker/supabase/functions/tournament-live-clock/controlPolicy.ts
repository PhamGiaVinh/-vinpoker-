export const POST_START_CLOCK_ACTIONS = [
  "pause",
  "resume",
  "next_level",
  "previous_level",
  "adjust_time",
] as const;

export type PostStartClockAction = typeof POST_START_CLOCK_ACTIONS[number];
type JsonRecord = Record<string, unknown>;
const CONTROL_REVISION_PATTERN = /^[0-9a-f]{32}$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPostStartClockAction(
  action: string,
): action is PostStartClockAction {
  return (POST_START_CLOCK_ACTIONS as readonly string[]).includes(action);
}

export function isTerminalTournamentStatus(status: unknown): boolean {
  return status === "completed" || status === "cancelled" ||
    status === "finished";
}

export function clockControlErrorStatus(code: string): number {
  if (code === "unauthorized" || code === "actor_not_allowed") return 403;
  if (
    code === "invalid_action" ||
    code === "expected_control_revision_required" ||
    code === "legacy_client_revision_required" ||
    code === "delta_must_be_integer" ||
    code === "delta_too_large" ||
    code === "already_first_level"
  ) return 400;
  return 409;
}

export type ClockDeltaResult =
  | { ok: true; value: number }
  | { ok: false; error: "delta_must_be_integer" | "delta_too_large" };

export function parseClockDelta(body: JsonRecord): ClockDeltaResult {
  const delta = typeof body.delta_seconds === "number"
    ? body.delta_seconds
    : typeof body.delta_minutes === "number"
    ? body.delta_minutes * 60
    : Number.NaN;
  if (!Number.isSafeInteger(delta)) {
    return { ok: false, error: "delta_must_be_integer" };
  }
  if (delta < -24 * 60 * 60 || delta > 24 * 60 * 60) {
    return { ok: false, error: "delta_too_large" };
  }
  return { ok: true, value: delta };
}

export function readExpectedControlRevision(body: JsonRecord): string | null {
  const revision = body.expected_control_revision;
  return typeof revision === "string" && CONTROL_REVISION_PATTERN.test(revision)
    ? revision
    : null;
}

/**
 * Compatibility seam for a reviewed historical frontend rollback. Legacy UI
 * does not echo the opaque revision. Pause/resume are idempotent; level changes
 * are accepted only when the legacy desired target still matches the server
 * snapshot. Adjust-time remains revision-only because an old request carries no
 * snapshot that can distinguish a double click.
 */
export function readLegacyControlRevision(
  action: PostStartClockAction,
  body: JsonRecord,
  clock: unknown,
): string | null {
  if (!isRecord(clock)) return null;
  const revision = clock.control_revision;
  if (
    typeof revision !== "string" || !CONTROL_REVISION_PATTERN.test(revision)
  ) {
    return null;
  }
  if (action === "pause" || action === "resume") return revision;
  if (action !== "next_level" && action !== "previous_level") return null;

  const level = isRecord(clock.current_level)
    ? clock.current_level.level_number
    : null;
  const desiredLevel = body.current_level;
  const direction = action === "next_level" ? 1 : -1;
  return Number.isSafeInteger(level) &&
      Number.isSafeInteger(desiredLevel) &&
      desiredLevel === Number(level) + direction
    ? revision
    : null;
}
