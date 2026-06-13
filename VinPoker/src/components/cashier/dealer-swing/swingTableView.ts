/**
 * swingTableView — single source of truth for the Dealer Swing battle-map
 * per-table timing + status derivation (UI Phase 4 operator-panel recompose).
 *
 * PRESENTATION ONLY: pure functions over already-fetched data. Used by BOTH the
 * TableGrid status-filter pre-pass (chip counts) and SwingTableCard (the card
 * itself), so the chip counts and the per-card badge/timer can never diverge.
 * The formulas are lifted verbatim from the original inline card computation —
 * this never changes swing/timer logic.
 */

import type { DealerAssignment, SwingConfig } from "@/hooks/useDealerSwing";
import type { TournamentWithTables } from "@/types/tournament";
import { getSwingTableStatus, type SwingTableStatus } from "./swingTableStatus";

/** Per-table timeline cache (computed in SwingPanel from existing data). */
export type TableTimeline = {
  minutesLeft: number;
  showNextDealerSoon: boolean;
  isOverdue: boolean;
  nominalDueAt: string | null;
  actualDueAt: string | null;
  actualMinutesLeft: number;
  /** Slot-0 read-cache from dealer_assignments — prefer the schedule row when one exists. */
  plannedReliefAt: string | null;
};

/** Localised HH:mm (vi-VN, 24h). Returns "--:--" for null/invalid input. */
export function formatTimeHHmm(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--";
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export interface SwingTableView {
  /** The live tournament whose tables include this one (for swing/warn config). */
  tableTournament: TournamentWithTables | undefined;
  warnAt: number;
  swingDurationMs: number;
  /** Authoritative due time (swing_due_at, else nominal, else assigned + duration). */
  swingDueMs: number;
  /** Due time used for the "can swing now" gate (timeline actualDueAt preferred). */
  actualDueMs: number;
  isOt: boolean;
  isPastDue: boolean;
  canSwing: boolean;
  /** Minutes until swing is due; null when the table has no assignment. */
  remainingMinutes: number | null;
  status: SwingTableStatus;
}

/**
 * Derive the per-table timing + status view. Lifted verbatim from the original
 * inline card computation (swingDueMs / actualDueMs / isOt / isPastDue / canSwing
 * / remainingMinutes / status) so the battle-map filter counts and the per-card
 * badge stay in lockstep.
 */
export function deriveTableSwingView(
  t: any,
  a: DealerAssignment | null | undefined,
  tl: TableTimeline | undefined,
  tournaments: TournamentWithTables[] | undefined,
  swingConfigs: SwingConfig[] | null | undefined,
  nowMs: number,
): SwingTableView {
  const tableTournament = tournaments?.find((tr) =>
    tr.tournament_tables.some((tt) => tt.table_id === t.id)
  );
  const warnAt =
    tableTournament?.warn_at_minutes
    ?? swingConfigs?.find((c) => c.table_type === t.table_type)?.warn_at_minutes
    ?? 5;
  const swingDurationMs = (tableTournament?.swing_duration_minutes
    ?? swingConfigs?.find((c) => c.table_type === t.table_type)?.swing_duration_minutes
    ?? 30) * 60_000;
  const swingDueMs = a?.swing_due_at
    ? new Date(a.swing_due_at).getTime()
    : tl?.nominalDueAt
      ? new Date(tl.nominalDueAt).getTime()
      : a?.assigned_at
        ? new Date(a.assigned_at).getTime() + swingDurationMs
        : 0;
  const actualDueMs = tl?.actualDueAt
    ? new Date(tl.actualDueAt).getTime()
    : a?.swing_due_at
      ? new Date(a.swing_due_at).getTime()
      : swingDueMs;
  const isOt = !!a?.overtime_started_at && !a?.swing_processed_at;
  const isPastDue = !!a && !a.swing_processed_at && swingDueMs <= nowMs;
  const canSwing = !!a && !a.swing_processed_at && (isOt || actualDueMs <= nowMs);
  const remainingMinutes = a ? (swingDueMs - nowMs) / 60_000 : null;
  const status = getSwingTableStatus({
    hasAssignment: !!a, isOt, isPastDue, remainingMinutes, warnAtMinutes: warnAt,
  });
  return {
    tableTournament, warnAt, swingDurationMs, swingDueMs, actualDueMs,
    isOt, isPastDue, canSwing, remainingMinutes, status,
  };
}
