// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — default shift-window seeds (idempotent)
// ═══════════════════════════════════════════════════════════════════════════════
// The TD "Seed default windows" action upserts these into dealer_shift_templates.
// "On-call" is a placeholder window with need_count 0 (auto-fill skips it; TD can
// still assign it manually). Templates store a representative timestamptz whose
// LOCAL time-of-day is the window; liveAdapter re-projects it onto the work date.

export interface TemplateSeed {
  label: string;
  start: string; // "HH:MM" local
  end: string; // "HH:MM" local (next day if ≤ start)
  requiredSkills: string[];
  needsLead: boolean;
  needCount: number;
}

export const DEFAULT_SHIFT_TEMPLATE_SEEDS: TemplateSeed[] = [
  { label: "08–16", start: "08:00", end: "16:00", requiredSkills: [], needsLead: false, needCount: 2 },
  { label: "10–18", start: "10:00", end: "18:00", requiredSkills: [], needsLead: false, needCount: 1 },
  { label: "11–19", start: "11:00", end: "19:00", requiredSkills: [], needsLead: false, needCount: 2 },
  { label: "12–20", start: "12:00", end: "20:00", requiredSkills: [], needsLead: false, needCount: 2 },
  { label: "13–21", start: "13:00", end: "21:00", requiredSkills: [], needsLead: false, needCount: 2 },
  { label: "16–00", start: "16:00", end: "00:00", requiredSkills: [], needsLead: false, needCount: 2 },
  { label: "18–02", start: "18:00", end: "02:00", requiredSkills: [], needsLead: false, needCount: 1 },
  { label: "00–08", start: "00:00", end: "08:00", requiredSkills: [], needsLead: false, needCount: 1 },
  { label: "On-call", start: "12:00", end: "20:00", requiredSkills: [], needsLead: false, needCount: 0 },
];

function offsetStr(tzOffsetMinutes: number): string {
  const sign = tzOffsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A row ready to insert into dealer_shift_templates. */
export interface TemplateSeedRow {
  club_id: string;
  label: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  default_hours: number;
  required_skills: string[];
  needs_lead: boolean;
  need_count: number;
  active: boolean;
}

/** Build insert rows for the defaults, anchored to `refDate` in the club tz. */
export function buildTemplateSeedRows(
  clubId: string,
  refDate: string,
  tzOffsetMinutes: number
): TemplateSeedRow[] {
  const off = offsetStr(tzOffsetMinutes);
  return DEFAULT_SHIFT_TEMPLATE_SEEDS.map((s) => {
    const startH = parseInt(s.start.slice(0, 2), 10);
    const endH = parseInt(s.end.slice(0, 2), 10);
    const endDate = endH <= startH ? addDays(refDate, 1) : refDate;
    return {
      club_id: clubId,
      label: s.label,
      scheduled_start_at: `${refDate}T${s.start}:00${off}`,
      scheduled_end_at: `${endDate}T${s.end}:00${off}`,
      default_hours: 8,
      required_skills: s.requiredSkills,
      needs_lead: s.needsLead,
      need_count: s.needCount,
      active: true,
    };
  });
}
