// Maps the operator-chosen tv_displays.layout (PR C3 dashboard) onto what the
// TV can actually render. Pure — TournamentDisplay routes on the result.

export type TvScreenKind =
  | "clock"
  | "break"
  | "payouts"
  | "announcement"
  | "multi_placeholder"
  | "standby";

export function selectTvScreen(
  layout: string | null | undefined,
  hasTournamentData: boolean,
): TvScreenKind {
  switch (layout) {
    case "announcement":
      // Renders with or without an assigned tournament.
      return "announcement";
    case "break_screen":
      return hasTournamentData ? "break" : "standby";
    case "payouts":
      return hasTournamentData ? "payouts" : "standby";
    case "multi_board":
      // Needs club-wide tournament data the anon state RPC does not expose yet
      // (requires a gated RPC extension) — honest placeholder until then.
      return "multi_placeholder";
    case "clock":
    default:
      return hasTournamentData ? "clock" : "standby";
  }
}
