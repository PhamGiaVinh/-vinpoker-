import { describe, expect, it } from "vitest";
import { generateDailyDraft } from "../shiftPlanner/generateDailyDraft";
import { classifyShiftWindow, preferenceScore } from "../shiftPlanner/preference";
import type {
  DraftAssignment,
  SchedulerConfig,
  SchedulerDealer,
  ShiftTemplate,
} from "@/types/shiftPlanner";

const WD = "2026-06-14";
const TZ = 420;
const OFFSET = "+07:00";
const iso = (date: string, hhmm: string) => `${date}T${hhmm}:00${OFFSET}`;
const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

function mkTemplate(id: string, start: string, end: string, extra: Partial<ShiftTemplate> = {}): ShiftTemplate {
  const sh = parseInt(start.slice(0, 2), 10);
  const eh = parseInt(end.slice(0, 2), 10);
  return {
    id, clubId: "c1", label: start,
    startAt: iso(WD, start),
    endAt: iso(eh <= sh ? nextDay(WD) : WD, end),
    defaultHours: 8, requiredSkills: [], needsLead: false, needCount: 1, ...extra,
  };
}
function mkDealer(id: string, extra: Partial<SchedulerDealer> = {}): SchedulerDealer {
  return {
    id, clubId: "c1", fullName: `Dealer ${id}`, tier: "B", isLead: false, status: "active",
    skills: ["Cash"], assignedHoursThisWeek: 0, maxHoursPerWeek: 48, weeklyTargetHours: 40,
    nightShiftsThisWeek: 0, preferredStartHours: {}, lastShiftEndAt: null, ...extra,
  };
}
const CONFIG: SchedulerConfig = {
  weeklyTargetHours: 40, weeklyMaxHours: 48, minRestHours: 10,
  maxNightShiftsPerWeek: 3, tzOffsetMinutes: TZ, requirementByHour: {},
};
function mkKept(dealerId: string, template: ShiftTemplate): DraftAssignment {
  return {
    templateId: template.id, templateLabel: template.label, dealerId, dealerName: `Dealer ${dealerId}`,
    workDate: WD, scheduledStartAt: template.startAt, scheduledEndAt: template.endAt,
    durationHours: 8, role: "Dealer", status: "draft", score: 0, scoreBreakdown: [], reasons: [], isNightShift: false,
  };
}

// ── preference.ts ────────────────────────────────────────────────────────────
describe("classifyShiftWindow", () => {
  it("classes early / late / overnight / midday windows", () => {
    expect(classifyShiftWindow(iso(WD, "08:00"), TZ)).toBe("som");
    expect(classifyShiftWindow(iso(WD, "05:00"), TZ)).toBe("som");
    expect(classifyShiftWindow(iso(WD, "18:00"), TZ)).toBe("muon");
    expect(classifyShiftWindow(iso(WD, "15:00"), TZ)).toBe("muon");
    expect(classifyShiftWindow(iso(WD, "00:00"), TZ)).toBe("muon"); // overnight, NOT som
    expect(classifyShiftWindow(iso(WD, "12:00"), TZ)).toBe("neutral");
    expect(classifyShiftWindow(iso(WD, "13:00"), TZ)).toBe("neutral");
  });
});

describe("preferenceScore", () => {
  it("rewards a match, penalises the opposite, ignores flexible/neutral", () => {
    expect(preferenceScore("som", "som").points).toBe(25);
    expect(preferenceScore("muon", "muon").points).toBe(25);
    expect(preferenceScore("som", "muon").points).toBe(-15);
    expect(preferenceScore("muon", "som").points).toBe(-15);
    expect(preferenceScore(null, "som").points).toBe(0);
    expect(preferenceScore("linh_hoat", "som").points).toBe(0);
    expect(preferenceScore("som", "neutral").points).toBe(0);
  });
});

// ── solver: shift preference ──────────────────────────────────────────────────
describe("generateDailyDraft — shift preference", () => {
  it("picks the 'som' dealer for a morning window when both are eligible", () => {
    const r = generateDailyDraft({
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("late", { shiftPreference: "muon" }), mkDealer("early", { shiftPreference: "som" })],
      templates: [mkTemplate("t1", "08:00", "16:00")],
      availability: [],
      config: { ...CONFIG, applyShiftPreference: true },
      nowIso: iso(WD, "07:00"),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].dealerId).toBe("early");
  });

  it("does NOT apply preference when the flag is off (V1/legacy path)", () => {
    // Without applyShiftPreference the order falls back to tie-breakers (id asc).
    const r = generateDailyDraft({
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("b", { shiftPreference: "muon" }), mkDealer("a", { shiftPreference: "som" })],
      templates: [mkTemplate("t1", "08:00", "16:00")],
      availability: [],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    });
    expect(r.assignments[0].dealerId).toBe("a"); // id tie-break, not preference
  });
});

// ── solver: chia-final pins ───────────────────────────────────────────────────
describe("generateDailyDraft — chia final pins", () => {
  it("pins an eligible designee with a 📌 marker", () => {
    const r = generateDailyDraft({
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("a"), mkDealer("b")],
      templates: [mkTemplate("t1", "18:00", "02:00", { needCount: 2 })],
      availability: [],
      config: CONFIG,
      finalDesignations: { t1: ["b"] },
      nowIso: iso(WD, "07:00"),
    });
    const pinned = r.assignments.find((a) => a.dealerId === "b");
    expect(pinned?.finalDesignated).toBe(true);
    expect(pinned?.reasons).toContain("📌 Chỉ định chia final");
    expect(r.assignments).toHaveLength(2); // pin + one regular fill
    expect(r.finalShortages).toEqual([]);
  });

  it("records a shortage (and does NOT substitute) when a designee is on leave", () => {
    const r = generateDailyDraft({
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("a"), mkDealer("b")],
      templates: [mkTemplate("t1", "18:00", "02:00", { needCount: 1 })],
      availability: [{ dealerId: "b", workDate: WD, preferredTemplateIds: [], availableTemplateIds: [], unavailableTemplateIds: [], leaveRequested: true }],
      config: CONFIG,
      finalDesignations: { t1: ["b"] },
      nowIso: iso(WD, "07:00"),
    });
    // b not pinned; seat still filled by a regular dealer (a); b flagged short.
    expect(r.assignments.some((x) => x.dealerId === "b")).toBe(false);
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].dealerId).toBe("a");
    expect(r.finalShortages).toEqual([
      expect.objectContaining({ templateId: "t1", dealerId: "b", reason: "on_leave" }),
    ]);
  });

  it("flags a designee already assigned to a DIFFERENT window as a shortage", () => {
    const t2 = mkTemplate("t2", "08:00", "16:00");
    const r = generateDailyDraft({
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("a"), mkDealer("b")],
      templates: [mkTemplate("t1", "18:00", "02:00", { needCount: 1 }), t2],
      availability: [],
      config: CONFIG,
      finalDesignations: { t1: ["a"] },
      keepAssignments: [mkKept("a", t2)], // a already kept on t2
      nowIso: iso(WD, "07:00"),
    });
    expect(r.finalShortages.some((s) => s.dealerId === "a" && s.reason === "already_assigned_same_day")).toBe(true);
  });

  it("flags an unknown/removed designee as inactive", () => {
    const r = generateDailyDraft({
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("a")],
      templates: [mkTemplate("t1", "18:00", "02:00", { needCount: 1 })],
      availability: [],
      config: CONFIG,
      finalDesignations: { t1: ["ghost"] },
      nowIso: iso(WD, "07:00"),
    });
    expect(r.finalShortages.some((s) => s.dealerId === "ghost" && s.reason === "inactive")).toBe(true);
  });
});

// ── solver: gap-fill idempotency ──────────────────────────────────────────────
describe("generateDailyDraft — gap-fill", () => {
  it("keeps prior assignments and only fills the remainder (idempotent)", () => {
    const t1 = mkTemplate("t1", "08:00", "16:00", { needCount: 2 });
    const input = {
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("a"), mkDealer("b"), mkDealer("c")],
      templates: [t1],
      availability: [],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    };
    const first = generateDailyDraft(input);
    expect(first.assignments).toHaveLength(2);

    // Re-run feeding the previous output as keepAssignments → same set, no dupes.
    const second = generateDailyDraft({ ...input, keepAssignments: first.assignments });
    expect(second.assignments).toHaveLength(2);
    expect(new Set(second.assignments.map((x) => x.dealerId))).toEqual(
      new Set(first.assignments.map((x) => x.dealerId))
    );
  });

  it("preserves a manually-kept dealer even if the solver wouldn't have picked them", () => {
    const t1 = mkTemplate("t1", "08:00", "16:00", { needCount: 1 });
    const r = generateDailyDraft({
      workDate: WD, clubId: "c1",
      dealers: [mkDealer("a", { shiftPreference: "som" }), mkDealer("z", { shiftPreference: "muon" })],
      templates: [t1],
      availability: [],
      config: { ...CONFIG, applyShiftPreference: true },
      keepAssignments: [mkKept("z", t1)], // z kept even though 'a' scores higher
      nowIso: iso(WD, "07:00"),
    });
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].dealerId).toBe("z");
  });
});
