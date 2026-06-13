/**
 * swingTableStatus — pure status classifier for the redesigned Dealer Swing
 * table cards (UI Phase 4 operator-panel recompose).
 *
 * PRESENTATION ONLY: maps the already-derived per-card timer/assignment values
 * to a single status-first badge (kind + Vietnamese label + semantic tone).
 * No React, no Supabase, no Tailwind strings (the tone → color class mapping
 * lives in the component). Never changes swing/timer logic.
 */

export type SwingTableStatusKind = "empty" | "overdue" | "due_soon" | "ok";

/** Semantic tone — the component maps this to Stitch Dark token classes. */
export type SwingTableStatusTone = "muted" | "destructive" | "warning" | "primary";

export interface SwingTableStatusInput {
  /** Whether the table has an active assignment (a dealer recorded). */
  hasAssignment: boolean;
  /** Overtime in progress (a.overtime_started_at && !swing_processed_at). */
  isOt: boolean;
  /** Past the swing-due time but not yet processed. */
  isPastDue: boolean;
  /** Minutes until swing is due (swingDueMs - nowMs)/60000; null when N/A. */
  remainingMinutes: number | null;
  /** Warn window (swing_config warn_at_minutes), minutes. */
  warnAtMinutes: number;
}

export interface SwingTableStatus {
  kind: SwingTableStatusKind;
  label: string;
  tone: SwingTableStatusTone;
}

/**
 * Classify a table's operator status. Order matters: empty → overdue →
 * due-soon → ok, mirroring the existing card timer-color precedence.
 */
export function getSwingTableStatus(input: SwingTableStatusInput): SwingTableStatus {
  const { hasAssignment, isOt, isPastDue, remainingMinutes, warnAtMinutes } = input;

  if (!hasAssignment) {
    return { kind: "empty", label: "Trống", tone: "muted" };
  }
  if (isOt || isPastDue) {
    return { kind: "overdue", label: "Quá hạn", tone: "destructive" };
  }
  const warn = Number.isFinite(warnAtMinutes) ? warnAtMinutes : 5;
  if (remainingMinutes != null && remainingMinutes <= warn) {
    return { kind: "due_soon", label: "Sắp đến giờ", tone: "warning" };
  }
  return { kind: "ok", label: "Ổn định", tone: "primary" };
}
