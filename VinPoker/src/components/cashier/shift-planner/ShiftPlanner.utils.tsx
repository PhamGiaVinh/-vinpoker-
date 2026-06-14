// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — UI helpers (grouping, badges, labels)
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  DealerTier,
  DraftAssignment,
  ShiftStatus,
  ShiftTemplate,
} from "@/types/shiftPlanner";

export interface ShiftGroup {
  template: ShiftTemplate;
  assignments: DraftAssignment[];
}

/** Group draft assignments under their shift template, ordered by start time. */
export function buildShiftGroups(
  templates: ShiftTemplate[],
  assignments: DraftAssignment[]
): ShiftGroup[] {
  return [...templates]
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((template) => ({
      template,
      assignments: assignments.filter((a) => a.templateId === template.id),
    }));
}

/** "08:00 – 16:00 · 8h" from a template. */
export function shiftWindowLabel(template: ShiftTemplate): string {
  const end = template.endAt.slice(11, 16);
  const start = template.startAt.slice(11, 16);
  return `${start} – ${end} · ${template.defaultHours}h`;
}

const SKILL_CLASSES: Record<string, string> = {
  Cash: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Tournament: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PLO: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  FinalTable: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

export function skillBadgeClass(skill: string): string {
  return SKILL_CLASSES[skill] ?? "bg-muted text-muted-foreground border-border";
}

const TIER_LABELS: Record<DealerTier, string> = {
  A: "Senior/Lead",
  B: "Dealer",
  C: "Junior",
};

export function tierLabel(tier: DealerTier): string {
  return TIER_LABELS[tier] ?? tier;
}

export function coverageChipClass(severity: "ok" | "warn" | "bad"): string {
  if (severity === "ok") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (severity === "warn") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-red-500/15 text-red-400 border-red-500/30";
}

const STATUS_META: Record<ShiftStatus, { label: string; className: string }> = {
  draft: { label: "Nháp", className: "bg-muted text-muted-foreground border-border" },
  published: { label: "Đã đăng", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  confirmed: { label: "Đã xác nhận", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  checked_in: { label: "Đã vào ca", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  closed: { label: "Đã đóng ca", className: "bg-muted text-muted-foreground border-border" },
  cancelled: { label: "Đã huỷ", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  no_show: { label: "Vắng", className: "bg-red-500/15 text-red-400 border-red-500/30" },
};

export function statusMeta(status: ShiftStatus): { label: string; className: string } {
  return STATUS_META[status] ?? STATUS_META.draft;
}

/** Local hour-of-day → "08:00" label. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Mon..Sun ISO dates for the week containing `workDate`. */
export function weekDates(workDate: string): string[] {
  const base = new Date(`${workDate}T00:00:00Z`);
  const dow = (base.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function weekdayLabel(index: number): string {
  return WEEKDAY_LABELS[index] ?? "";
}
