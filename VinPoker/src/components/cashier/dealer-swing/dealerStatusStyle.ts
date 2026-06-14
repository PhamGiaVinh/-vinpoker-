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
    dot: "bg-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    text: "text-emerald-300",
    progress: "bg-emerald-400",
  },
  soon: {
    label: "Sắp đến giờ",
    dot: "bg-yellow-400",
    border: "border-yellow-500/35",
    bg: "bg-yellow-500/10",
    text: "text-yellow-300",
    progress: "bg-yellow-400",
  },
  missing: {
    label: "Thiếu dealer",
    dot: "bg-orange-400",
    border: "border-orange-500/40",
    bg: "bg-orange-500/10",
    text: "text-orange-300",
    progress: "bg-orange-400",
  },
  overdue: {
    label: "Quá hạn",
    dot: "bg-red-400",
    border: "border-red-500/45",
    bg: "bg-red-500/10",
    text: "text-red-300",
    progress: "bg-red-500",
  },
  break: {
    label: "Đang nghỉ",
    dot: "bg-blue-400",
    border: "border-blue-500/35",
    bg: "bg-blue-500/10",
    text: "text-blue-300",
    progress: "bg-blue-400",
  },
  planned: {
    label: "Dự kiến",
    dot: "bg-purple-400",
    border: "border-purple-500/35",
    bg: "bg-purple-500/10",
    text: "text-purple-300",
    progress: "bg-purple-400",
  },
  tour: {
    label: "Tour",
    dot: "bg-zinc-400",
    border: "border-zinc-500/30",
    bg: "bg-zinc-500/10",
    text: "text-zinc-300",
    progress: "bg-zinc-400",
  },
};

/** Ordered for the status-filter chip row + legend (Tất cả prepended separately). */
export const DEALER_STATUS_ORDER: DealerTableStatus[] = [
  "stable", "soon", "missing", "overdue", "break", "planned", "tour",
];
