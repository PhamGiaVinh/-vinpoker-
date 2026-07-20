export type TournamentClockPrimaryAction = "start" | "pause" | "resume" | null;

export type TournamentClockControlState = {
  status?: string | null;
  is_running?: boolean | null;
  current_level?: unknown | null;
  message?: string | null;
};

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "finished"]);
const RUNNING_STATUSES = new Set(["live", "final_table"]);

/**
 * `get_tournament_clock` intentionally exposes computed state instead of raw
 * timestamps. Derive exactly one primary control from that server-owned state.
 * Unknown or internally inconsistent payloads return null so the UI fails closed.
 */
export function getTournamentClockPrimaryAction(
  clock: TournamentClockControlState,
): TournamentClockPrimaryAction {
  const status = clock.status ?? null;

  if (RUNNING_STATUSES.has(status ?? "") && clock.current_level != null) {
    if (clock.is_running === true) return "pause";
    if (clock.is_running === false) return "resume";
    return null;
  }

  if (
    typeof status === "string" &&
    status.length > 0 &&
    !TERMINAL_STATUSES.has(status ?? "") &&
    clock.is_running === false &&
    clock.current_level == null &&
    clock.message === "Clock not started"
  ) {
    return "start";
  }

  return null;
}

/**
 * Secondary controls are valid only after the server has resolved an active
 * level and an unambiguous running/paused state. This keeps level/time buttons
 * disabled for never-started, terminal, or drifted clock payloads.
 */
export function canUseTournamentClockPostStartControls(
  clock: TournamentClockControlState,
): boolean {
  const status = clock.status ?? null;
  return (
    RUNNING_STATUSES.has(status ?? "") &&
    clock.current_level != null &&
    typeof clock.is_running === "boolean"
  );
}
