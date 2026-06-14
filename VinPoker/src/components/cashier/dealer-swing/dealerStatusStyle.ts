/**
 * dealerStatusStyle — the 7-status color system for the Dealer Control battle
 * map (UI polish). PRESENTATION ONLY: maps a derived per-table status to Stitch
 * Dark token classes (dot / border / bg / text / progress / top-strip). The
 * status itself is derived in `deriveDealerTableStatus` (swingTableView.ts) from
 * existing data — this file never touches timing/business logic.
 *
 * Standard Tailwind opacities only (theme-safe). neon-green primary = stable.
 */

export type DealerTableStatus =
  | "stable"
  | "soon"
  | "missing"
  | "overdue"
  | "break"
  | "planned"
  | "tour";

export interface DealerStatusStyle {
  label: string;
  dot: string;
  border: string;
  bg: string;
  text: string;
  /** Progress-bar / top-strip fill. */
  progress: string;
}

export const dealerStatusStyle: Record<DealerTableStatus, DealerStatusStyle> = {
  stable: {
    label: "Ổn định",
    dot: "bg-success",
    border: "border-success/30",
    bg: "bg-success/10",
    text: "text-success",
    progress: "bg-success",
  },
  soon: {
    label: "Sắp đến giờ",
    dot: "bg-warning",
    border: "border-warning/35",
    bg: "bg-warning/10",
    text: "text-warning",
    progress: "bg-warning",
  },
  missing: {
    label: "Thiếu dealer",
    dot: "bg-warning",
    border: "border-warning/40",
    bg: "bg-warning/10",
    text: "text-warning",
    progress: "bg-warning",
  },
  overdue: {
    label: "Quá hạn",
    dot: "bg-destructive",
    border: "border-destructive/45",
    bg: "bg-destructive/10",
    text: "text-destructive",
    progress: "bg-destructive",
  },
  break: {
    label: "Đang nghỉ",
    dot: "bg-[hsl(var(--ds-active))]",
    border: "border-[hsl(var(--ds-active)_/_0.35)]",
    bg: "bg-[hsl(var(--ds-active)_/_0.1)]",
    text: "text-[hsl(var(--ds-active))]",
    progress: "bg-[hsl(var(--ds-active))]",
  },
  planned: {
    label: "Dự kiến",
    dot: "bg-[hsl(var(--ds-preassign))]",
    border: "border-[hsl(var(--ds-preassign)_/_0.35)]",
    bg: "bg-[hsl(var(--ds-preassign)_/_0.1)]",
    text: "text-[hsl(var(--ds-preassign))]",
    progress: "bg-[hsl(var(--ds-preassign))]",
  },
  tour: {
    label: "Tour",
    dot: "bg-muted-foreground",
    border: "border-border/30",
    bg: "bg-muted-foreground/10",
    text: "text-foreground",
    progress: "bg-muted-foreground",
  },
};

/** Ordered for the status-filter chip row + legend (Tất cả prepended separately). */
export const DEALER_STATUS_ORDER: DealerTableStatus[] = [
  "stable", "soon", "missing", "overdue", "break", "planned", "tour",
];
