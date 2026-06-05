export type DealerTier = "A" | "B" | "C";

export interface TableCardDealer {
  full_name: string;
  tier: DealerTier;
  worked_minutes?: number;
}

export interface TableCardAssignment {
  id: string;                              // [FIX-1] Added for onSwing callback
  assigned_at: string;
  swing_due_at: string;
  overtime_started_at: string | null;
  pre_assigned_attendance_id: string | null;
}

export interface TableCardSwingConfig {
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
}

export type NextDealerSource = "confirmed" | "predicted";

export interface TableCardNextDealer extends TableCardDealer {
  source: NextDealerSource;
}

export interface TableCardData {
  table_id: string;                        // [FIX-2] Added for onAssign callback
  table_name: string;
  table_type?: string;
  current_dealer: (TableCardDealer & { attendance_id: string }) | null;
  assignment: TableCardAssignment | null;
  next_dealer: TableCardNextDealer | null;
  swing_config: TableCardSwingConfig;
}

const MODE_TO_CARD_STYLE: Record<TableCardTimerMode, string> = {
  normal:  "border-zinc-700/60 bg-zinc-900/80 shadow-none",
  warn:    "border-amber-500/40 bg-amber-950/20 shadow-[0_0_24px_-8px_rgba(245,158,11,0.25)]",
  urgent:  "border-orange-500/50 bg-orange-950/20 shadow-[0_0_28px_-8px_rgba(249,115,22,0.30)]",
  overdue: "border-red-500/60 bg-red-950/25 shadow-[0_0_32px_-8px_rgba(239,68,68,0.35)]",
  ot:      "border-red-500/80 bg-red-950/40 shadow-[0_0_40px_-8px_rgba(239,68,68,0.45)]",
};

const MODE_TO_TIMER_COLOR: Record<TableCardTimerMode, string> = {
  normal:  "text-emerald-400",
  warn:    "text-amber-400",
  urgent:  "text-orange-400",
  overdue: "text-red-400",
  ot:      "text-red-400",
};

const MODE_TO_PROGRESS_COLOR: Record<TableCardTimerMode, string> = {
  normal:  "bg-emerald-500",
  warn:    "bg-amber-500",
  urgent:  "bg-orange-500",
  overdue: "bg-red-500",
  ot:      "bg-red-500",
};

export interface TableCardProps {
  data: TableCardData;
  onAssign?: (tableId: string) => void;
  onSwing?: (assignmentId: string) => void;
  className?: string;
}

export type TableCardTimerMode = "normal" | "warn" | "urgent" | "overdue" | "ot";

export interface TableCardTimerResult {
  mode: TableCardTimerMode;
  label: string;
  progress: number;
  remainingSec: number;
  isConfirmedOt: boolean;
  /** 0–1 intensity for the progress bar glow effect. Tied to urgency. */
  glowIntensity: number;
}
