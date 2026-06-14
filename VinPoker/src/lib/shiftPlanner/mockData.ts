// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — in-memory demo scenario (Phase 1, no DB)
// ═══════════════════════════════════════════════════════════════════════════════
// buildMockScenario(workDate) returns a realistic day of dealers / flexible shift
// templates / availability requests so the planner UI renders and the auto-fill
// produces a draft (with a couple of intentional gaps + warnings) without any
// database. Phase 2 replaces this with reads of dealers / dealer_skills / clubs.

import type {
  AvailabilityRequest,
  SchedulerConfig,
  SchedulerDealer,
  ShiftTemplate,
} from "@/types/shiftPlanner";

const VN_TZ_OFFSET_MINUTES = 420;
const VN_OFFSET = "+07:00";
const MOCK_CLUB_ID = "mock-club";

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function iso(dateStr: string, hhmm: string): string {
  return `${dateStr}T${hhmm}:00${VN_OFFSET}`;
}

interface TemplateOpts {
  requiredSkills?: string[];
  needsLead?: boolean;
  needCount?: number;
}

function template(
  id: string,
  workDate: string,
  start: string,
  end: string,
  opts: TemplateOpts = {}
): ShiftTemplate {
  const startHour = parseInt(start.slice(0, 2), 10);
  const endHour = parseInt(end.slice(0, 2), 10);
  const endDate = endHour <= startHour ? addDays(workDate, 1) : workDate;
  return {
    id,
    clubId: MOCK_CLUB_ID,
    label: start,
    startAt: iso(workDate, start),
    endAt: iso(endDate, end),
    defaultHours: 8,
    requiredSkills: opts.requiredSkills ?? [],
    needsLead: opts.needsLead ?? false,
    needCount: opts.needCount ?? 1,
  };
}

export interface MockScenario {
  clubId: string;
  dealers: SchedulerDealer[];
  templates: ShiftTemplate[];
  availability: AvailabilityRequest[];
  config: SchedulerConfig;
}

export function buildMockScenario(workDate: string): MockScenario {
  const templates: ShiftTemplate[] = [
    template("t-08", workDate, "08:00", "16:00", { needCount: 2 }),
    template("t-11", workDate, "11:00", "19:00", { needCount: 3 }),
    template("t-12", workDate, "12:00", "20:00", { requiredSkills: ["PLO"], needCount: 1 }),
    template("t-13", workDate, "13:00", "21:00", { needCount: 2 }),
    template("t-16", workDate, "16:00", "00:00", { requiredSkills: ["Tournament"], needsLead: true, needCount: 1 }),
    template("t-18", workDate, "18:00", "02:00", { needCount: 1 }),
    template("t-00", workDate, "00:00", "08:00", { needCount: 1 }),
  ];

  const dealers: SchedulerDealer[] = [
    mockDealer("d-01", "Nguyễn Thu Hà", "B", ["Cash"], { week: 24, history: { "08:00": 3 } }),
    mockDealer("d-02", "Trần Minh Quân", "A", ["Tournament", "Cash"], { week: 16, nights: 1, history: { "08:00": 2 }, lead: true }),
    mockDealer("d-03", "Lê Anh Thư", "B", ["Cash"], { week: 30, history: { "11:00": 4 } }),
    mockDealer("d-04", "Phạm Tuấn Huy", "C", ["Cash"], { week: 8 }),
    mockDealer("d-05", "Phạm Hoàng Nam", "B", ["PLO", "Cash"], { week: 20, history: { "12:00": 2 } }),
    mockDealer("d-06", "Võ Thị Ngọc", "C", ["Cash"], { week: 12 }),
    mockDealer("d-07", "Võ Mỹ Linh", "B", ["Cash"], { week: 28, history: { "13:00": 3 } }),
    mockDealer("d-08", "Trần Đức Trí", "C", ["Cash"], { week: 18 }),
    mockDealer("d-09", "Đỗ Quốc Anh", "A", ["Tournament", "Cash"], { week: 24, nights: 2, history: { "16:00": 3 }, lead: true }),
    mockDealer("d-10", "Bùi Thảo Vy", "B", ["Tournament", "Cash"], { week: 10, history: { "16:00": 1 } }),
    mockDealer("d-11", "Nguyễn Văn Khang", "C", ["Cash"], { week: 22, nights: 1, history: { "18:00": 3 } }),
    // Worked 18–02 last night → ends at 02:00 today. Asking for 08–16 → < 10h rest.
    mockDealer("d-12", "Lê Hoàng Long", "C", ["Cash"], { week: 16, lastShiftEndAt: iso(workDate, "02:00") }),
    // On leave today.
    mockDealer("d-13", "Nguyễn Thị Ngọc", "C", ["Cash"], { week: 14 }),
  ];

  const availability: AvailabilityRequest[] = [
    req("d-01", workDate, { preferred: ["t-08"] }),
    req("d-03", workDate, { preferred: ["t-11"] }),
    req("d-05", workDate, { preferred: ["t-12"] }),
    req("d-07", workDate, { preferred: ["t-13"] }),
    req("d-08", workDate, { available: ["t-08", "t-11", "t-12"], unavailable: ["t-16", "t-18", "t-00"] }),
    req("d-09", workDate, { preferred: ["t-16"] }),
    req("d-10", workDate, { preferred: ["t-16"], available: ["t-13", "t-11"] }),
    req("d-11", workDate, { preferred: ["t-18"], available: ["t-16"] }),
    req("d-12", workDate, { preferred: ["t-08"] }),
    req("d-13", workDate, { leave: true, note: "Xin nghỉ phép" }),
  ];

  const config: SchedulerConfig = {
    weeklyTargetHours: 40,
    weeklyMaxHours: 48,
    minRestHours: 10,
    maxNightShiftsPerWeek: 3,
    tzOffsetMinutes: VN_TZ_OFFSET_MINUTES,
    requirementByHour: {
      0: 4, 1: 4, 2: 3, 3: 3, 4: 1, 5: 1, 6: 1, 7: 1,
      8: 4, 9: 4, 10: 4, 11: 5, 12: 6, 13: 7, 14: 7, 15: 7,
      16: 8, 17: 8, 18: 7, 19: 7, 20: 6, 21: 6, 22: 5, 23: 5,
    },
  };

  return { clubId: MOCK_CLUB_ID, dealers, templates, availability, config };
}

interface MockDealerOpts {
  week: number;
  nights?: number;
  history?: Record<string, number>;
  lead?: boolean;
  lastShiftEndAt?: string;
}

function mockDealer(
  id: string,
  fullName: string,
  tier: SchedulerDealer["tier"],
  skills: string[],
  opts: MockDealerOpts
): SchedulerDealer {
  return {
    id,
    clubId: MOCK_CLUB_ID,
    fullName,
    tier,
    isLead: opts.lead ?? tier === "A",
    status: "active",
    skills,
    assignedHoursThisWeek: opts.week,
    maxHoursPerWeek: 48,
    weeklyTargetHours: 40,
    nightShiftsThisWeek: opts.nights ?? 0,
    preferredStartHours: opts.history ?? {},
    lastShiftEndAt: opts.lastShiftEndAt ?? null,
  };
}

interface ReqOpts {
  preferred?: string[];
  available?: string[];
  unavailable?: string[];
  leave?: boolean;
  note?: string;
}

function req(dealerId: string, workDate: string, opts: ReqOpts): AvailabilityRequest {
  return {
    dealerId,
    workDate,
    preferredTemplateIds: opts.preferred ?? [],
    availableTemplateIds: opts.available ?? [],
    unavailableTemplateIds: opts.unavailable ?? [],
    leaveRequested: opts.leave ?? false,
    note: opts.note,
  };
}
