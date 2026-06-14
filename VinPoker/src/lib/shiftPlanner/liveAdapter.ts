// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — live adapter (pure: raw DB rows → scheduler scenario)
// ═══════════════════════════════════════════════════════════════════════════════
// Keeps the Supabase reads in the hook thin and this mapping pure + unit-testable.
// Reads ONLY: dealers, dealer_skills, dealer_shift_templates,
// dealer_availability_requests, dealer_shift_assignments. NEVER swing/payroll.

import type {
  AvailabilityRequest,
  DealerTier,
  SchedulerConfig,
  SchedulerDealer,
  ShiftTemplate,
} from "@/types/shiftPlanner";
import type { MockScenario } from "./mockData";
import { eachCoveredHour } from "./time";
import { computeWeeklyAggregates, type WeekAssignmentRow } from "./weeklyAggregates";

export interface DealerRow {
  id: string;
  club_id: string;
  full_name: string;
  tier: string | null;
  status: string | null;
  skills: string[] | null;
}
export interface SkillRow {
  dealer_id: string;
  game_type: string;
}
export interface TemplateRow {
  id: string;
  club_id: string;
  label: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  default_hours: number | null;
  required_skills: string[] | null;
  needs_lead: boolean | null;
  need_count: number | null;
}
export interface AvailabilityRow {
  dealer_id: string;
  work_date: string;
  kind: string; // preferred | available | leave | unavailable
  template_id: string | null;
  note: string | null;
}

export interface LiveScenarioInput {
  clubId: string;
  workDate: string;
  tzOffsetMinutes: number;
  dealerRows: DealerRow[];
  skillRows: SkillRow[];
  templateRows: TemplateRow[];
  availabilityRows: AvailabilityRow[];
  weekAssignmentRows: WeekAssignmentRow[];
  policy?: Partial<Pick<SchedulerConfig, "weeklyTargetHours" | "weeklyMaxHours" | "minRestHours" | "maxNightShiftsPerWeek">>;
}

const DEFAULT_POLICY = {
  weeklyTargetHours: 40,
  weeklyMaxHours: 48,
  minRestHours: 10,
  maxNightShiftsPerWeek: 3,
};

function normaliseTier(raw: string | null | undefined): DealerTier {
  const t = (raw ?? "").toUpperCase();
  return t === "A" || t === "B" || t === "C" ? (t as DealerTier) : "C";
}

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

/** Local "HH:MM" of an instant in the club tz. */
function localHHMM(iso: string, tzOffsetMinutes: number): string {
  const d = new Date(Date.parse(iso) + tzOffsetMinutes * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Project a template's stored time-of-day onto `workDate` (templates are
 *  recurring windows, not specific instants). End rolls to next day if ≤ start. */
function projectTemplate(r: TemplateRow, workDate: string, tzOffsetMinutes: number): ShiftTemplate {
  const off = offsetStr(tzOffsetMinutes);
  const startHHMM = localHHMM(r.scheduled_start_at, tzOffsetMinutes);
  const endHHMM = localHHMM(r.scheduled_end_at, tzOffsetMinutes);
  const startMin = parseInt(startHHMM.slice(0, 2), 10) * 60 + parseInt(startHHMM.slice(3, 5), 10);
  const endMin = parseInt(endHHMM.slice(0, 2), 10) * 60 + parseInt(endHHMM.slice(3, 5), 10);
  const endDate = endMin <= startMin ? addDays(workDate, 1) : workDate;
  return {
    id: r.id,
    clubId: r.club_id,
    label: r.label,
    startAt: `${workDate}T${startHHMM}:00${off}`,
    endAt: `${endDate}T${endHHMM}:00${off}`,
    defaultHours: r.default_hours ?? 8,
    requiredSkills: r.required_skills ?? [],
    needsLead: r.needs_lead ?? false,
    needCount: r.need_count ?? 1,
  };
}

/** Staffing target per local hour = sum of need_count over templates covering it. */
export function requirementFromTemplates(
  templates: ShiftTemplate[],
  tzOffsetMinutes: number
): Record<number, number> {
  const req: Record<number, number> = {};
  for (const t of templates) {
    for (const h of eachCoveredHour(t.startAt, t.endAt, tzOffsetMinutes)) {
      req[h] = (req[h] ?? 0) + t.needCount;
    }
  }
  return req;
}

function groupAvailability(rows: AvailabilityRow[], workDate: string): AvailabilityRequest[] {
  const byDealer = new Map<string, AvailabilityRequest>();
  const ensure = (dealerId: string): AvailabilityRequest => {
    let r = byDealer.get(dealerId);
    if (!r) {
      r = {
        dealerId,
        workDate,
        preferredTemplateIds: [],
        availableTemplateIds: [],
        unavailableTemplateIds: [],
        leaveRequested: false,
      };
      byDealer.set(dealerId, r);
    }
    return r;
  };
  for (const row of rows) {
    const r = ensure(row.dealer_id);
    if (row.kind === "leave") r.leaveRequested = true;
    else if (row.template_id) {
      if (row.kind === "preferred") r.preferredTemplateIds.push(row.template_id);
      else if (row.kind === "available") r.availableTemplateIds.push(row.template_id);
      else if (row.kind === "unavailable") r.unavailableTemplateIds.push(row.template_id);
    }
    if (row.note && !r.note) r.note = row.note;
  }
  return [...byDealer.values()];
}

/** Map raw DB rows into a scheduler scenario (pure). */
export function buildLiveScenario(input: LiveScenarioInput): MockScenario {
  const { clubId, workDate, tzOffsetMinutes, dealerRows, skillRows, templateRows, availabilityRows, weekAssignmentRows } = input;
  const policy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };

  const skillsByDealer = new Map<string, string[]>();
  for (const s of skillRows) {
    const list = skillsByDealer.get(s.dealer_id) ?? [];
    list.push(s.game_type);
    skillsByDealer.set(s.dealer_id, list);
  }

  const aggregates = computeWeeklyAggregates(weekAssignmentRows, workDate, tzOffsetMinutes);

  const dealers: SchedulerDealer[] = dealerRows.map((d) => {
    const tier = normaliseTier(d.tier);
    const merged = new Set<string>([...(d.skills ?? []), ...(skillsByDealer.get(d.id) ?? [])]);
    const agg = aggregates[d.id] ?? { assignedHoursThisWeek: 0, nightShiftsThisWeek: 0, lastShiftEndAt: null };
    return {
      id: d.id,
      clubId: d.club_id,
      fullName: d.full_name,
      tier,
      isLead: tier === "A",
      status: d.status ?? "active",
      skills: [...merged],
      assignedHoursThisWeek: agg.assignedHoursThisWeek,
      maxHoursPerWeek: policy.weeklyMaxHours,
      weeklyTargetHours: policy.weeklyTargetHours,
      nightShiftsThisWeek: agg.nightShiftsThisWeek,
      preferredStartHours: {},
      lastShiftEndAt: agg.lastShiftEndAt,
    };
  });

  const templates: ShiftTemplate[] = templateRows.map((r) => projectTemplate(r, workDate, tzOffsetMinutes));
  const availability = groupAvailability(availabilityRows, workDate);

  const config: SchedulerConfig = {
    weeklyTargetHours: policy.weeklyTargetHours,
    weeklyMaxHours: policy.weeklyMaxHours,
    minRestHours: policy.minRestHours,
    maxNightShiftsPerWeek: policy.maxNightShiftsPerWeek,
    tzOffsetMinutes,
    requirementByHour: requirementFromTemplates(templates, tzOffsetMinutes),
  };

  return { clubId, dealers, templates, availability, config };
}
