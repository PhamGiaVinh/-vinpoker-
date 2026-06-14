import { describe, expect, it } from "vitest";
import {
  generateDailyDraft,
  hardRejectReasons,
  scoreDealerForSlot,
} from "../shiftPlanner/generateDailyDraft";
import { eachCoveredHour, shiftDurationHours } from "../shiftPlanner/time";
import { computeCoverageByHour } from "../shiftPlanner/coverage";
import type {
  AvailabilityRequest,
  SchedulerConfig,
  SchedulerDealer,
  ShiftTemplate,
} from "@/types/shiftPlanner";

const WD = "2026-06-14";
const TZ = 420; // VN +07:00
const OFFSET = "+07:00";

const iso = (date: string, hhmm: string) => `${date}T${hhmm}:00${OFFSET}`;
const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

function mkTemplate(
  id: string,
  start: string,
  end: string,
  extra: Partial<ShiftTemplate> = {}
): ShiftTemplate {
  const startHour = parseInt(start.slice(0, 2), 10);
  const endHour = parseInt(end.slice(0, 2), 10);
  const endDate = endHour <= startHour ? nextDay(WD) : WD;
  return {
    id,
    clubId: "c1",
    label: start,
    startAt: iso(WD, start),
    endAt: iso(endDate, end),
    defaultHours: 8,
    requiredSkills: [],
    needsLead: false,
    needCount: 1,
    ...extra,
  };
}

function mkDealer(id: string, extra: Partial<SchedulerDealer> = {}): SchedulerDealer {
  return {
    id,
    clubId: "c1",
    fullName: `Dealer ${id}`,
    tier: "B",
    isLead: false,
    status: "active",
    skills: ["Cash"],
    assignedHoursThisWeek: 0,
    maxHoursPerWeek: 48,
    weeklyTargetHours: 40,
    nightShiftsThisWeek: 0,
    preferredStartHours: {},
    lastShiftEndAt: null,
    ...extra,
  };
}

function mkReq(dealerId: string, extra: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  return {
    dealerId,
    workDate: WD,
    preferredTemplateIds: [],
    availableTemplateIds: [],
    unavailableTemplateIds: [],
    leaveRequested: false,
    ...extra,
  };
}

const CONFIG: SchedulerConfig = {
  weeklyTargetHours: 40,
  weeklyMaxHours: 48,
  minRestHours: 10,
  maxNightShiftsPerWeek: 3,
  tzOffsetMinutes: TZ,
  requirementByHour: {},
};

const NO_ASSIGN = new Set<string>();

// ── Time helpers ────────────────────────────────────────────────────────────

describe("shiftPlanner/time", () => {
  it("computes 8h for cross-midnight shifts (16–00, 18–02, 00–08)", () => {
    expect(shiftDurationHours(iso(WD, "16:00"), iso(nextDay(WD), "00:00"))).toBe(8);
    expect(shiftDurationHours(iso(WD, "18:00"), iso(nextDay(WD), "02:00"))).toBe(8);
    expect(shiftDurationHours(iso(WD, "00:00"), iso(WD, "08:00"))).toBe(8);
  });

  it("buckets covered hours with midnight wrap (18–02 → 18..1)", () => {
    expect(eachCoveredHour(iso(WD, "18:00"), iso(nextDay(WD), "02:00"), TZ)).toEqual([
      18, 19, 20, 21, 22, 23, 0, 1,
    ]);
  });
});

// ── Hard rejects (acceptance 1–7) ───────────────────────────────────────────

describe("shiftPlanner/hardRejectReasons", () => {
  it("rejects a dealer already assigned that day", () => {
    const reasons = hardRejectReasons(
      mkDealer("a"),
      mkTemplate("t1", "08:00", "16:00"),
      WD,
      undefined,
      CONFIG,
      new Set(["a"])
    );
    expect(reasons).toContain("already_assigned_same_day");
  });

  it("rejects a dealer on leave", () => {
    const reasons = hardRejectReasons(
      mkDealer("a"),
      mkTemplate("t1", "08:00", "16:00"),
      WD,
      mkReq("a", { leaveRequested: true }),
      CONFIG,
      NO_ASSIGN
    );
    expect(reasons).toContain("on_leave");
  });

  it("rejects a dealer who marked the shift unavailable", () => {
    const reasons = hardRejectReasons(
      mkDealer("a"),
      mkTemplate("t1", "08:00", "16:00"),
      WD,
      mkReq("a", { unavailableTemplateIds: ["t1"] }),
      CONFIG,
      NO_ASSIGN
    );
    expect(reasons).toContain("marked_unavailable");
  });

  it("rejects a dealer missing the required skill (PLO)", () => {
    const reasons = hardRejectReasons(
      mkDealer("a", { skills: ["Cash"] }),
      mkTemplate("t1", "12:00", "20:00", { requiredSkills: ["PLO"] }),
      WD,
      undefined,
      CONFIG,
      NO_ASSIGN
    );
    expect(reasons).toContain("missing_required_skill");
  });

  it("rejects a dealer who would exceed weekly max hours", () => {
    const reasons = hardRejectReasons(
      mkDealer("a", { assignedHoursThisWeek: 44, maxHoursPerWeek: 48 }), // +8 = 52 > 48
      mkTemplate("t1", "08:00", "16:00"),
      WD,
      undefined,
      CONFIG,
      NO_ASSIGN
    );
    expect(reasons).toContain("exceeds_weekly_max_hours");
  });

  it("rejects for insufficient rest across midnight (18–02 → 08–16)", () => {
    const reasons = hardRejectReasons(
      mkDealer("a", { lastShiftEndAt: iso(WD, "02:00") }), // ended 02:00, 6h before 08:00
      mkTemplate("t1", "08:00", "16:00"),
      WD,
      undefined,
      CONFIG,
      NO_ASSIGN
    );
    expect(reasons).toContain("insufficient_rest");
  });

  it("allows the same dealer once rest meets the minimum", () => {
    const reasons = hardRejectReasons(
      mkDealer("a", { lastShiftEndAt: iso("2026-06-13", "20:00") }), // 12h before 08:00
      mkTemplate("t1", "08:00", "16:00"),
      WD,
      undefined,
      CONFIG,
      NO_ASSIGN
    );
    expect(reasons).not.toContain("insufficient_rest");
  });

  it("rejects a non-Lead dealer for a Lead-required slot", () => {
    const reasons = hardRejectReasons(
      mkDealer("a", { isLead: false, skills: ["Tournament"] }),
      mkTemplate("t1", "16:00", "00:00", { needsLead: true, requiredSkills: ["Tournament"] }),
      WD,
      undefined,
      CONFIG,
      NO_ASSIGN
    );
    expect(reasons).toContain("needs_lead");
  });
});

// ── Soft score (acceptance 8) ───────────────────────────────────────────────

describe("shiftPlanner/scoreDealerForSlot", () => {
  it("gives +35 to a preferred shift and outranks a merely-available dealer", () => {
    const template = mkTemplate("t1", "11:00", "19:00");
    const preferred = scoreDealerForSlot(
      mkDealer("a"),
      template,
      CONFIG,
      mkReq("a", { preferredTemplateIds: ["t1"] })
    );
    const available = scoreDealerForSlot(
      mkDealer("b"),
      template,
      CONFIG,
      mkReq("b", { availableTemplateIds: ["t1"] })
    );
    expect(preferred.score).toBeGreaterThan(available.score);
    expect(preferred.breakdown.find((c) => c.points === 35)).toBeTruthy();
  });
});

// ── Integration ─────────────────────────────────────────────────────────────

describe("shiftPlanner/generateDailyDraft", () => {
  it("assigns a dealer at most once per day (acceptance 1)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [mkDealer("a")],
      templates: [mkTemplate("t1", "08:00", "16:00"), mkTemplate("t2", "16:00", "00:00")],
      availability: [],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    });
    const forA = result.assignments.filter((x) => x.dealerId === "a");
    expect(forA).toHaveLength(1);
    expect(result.unfilled.some((u) => u.templateId === "t2")).toBe(true);
  });

  it("does not auto-fill a dealer who requested leave (acceptance 2)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [mkDealer("a")],
      templates: [mkTemplate("t1", "08:00", "16:00")],
      availability: [mkReq("a", { leaveRequested: true })],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    });
    expect(result.assignments).toHaveLength(0);
    expect(result.unfilled.some((u) => u.templateId === "t1")).toBe(true);
    expect(
      result.rejections.some((r) => r.dealerId === "a" && r.reason === "on_leave")
    ).toBe(true);
  });

  it("prefers the dealer whose preference matches (acceptance 8)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [mkDealer("a"), mkDealer("b")],
      templates: [mkTemplate("t1", "11:00", "19:00", { needCount: 1 })],
      availability: [mkReq("b", { preferredTemplateIds: ["t1"] })],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].dealerId).toBe("b");
  });

  it("computes 8h duration and wraps coverage for an 18–02 shift (acceptance 4 & 9)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [mkDealer("a")],
      templates: [mkTemplate("t1", "18:00", "02:00")],
      availability: [],
      config: { ...CONFIG, requirementByHour: { 18: 1, 19: 1, 0: 1, 1: 1 } },
      nowIso: iso(WD, "07:00"),
    });
    expect(result.assignments[0].durationHours).toBe(8);
    expect(result.assignments[0].isNightShift).toBe(true);
    const hour0 = result.coverage.find((c) => c.hour === 0);
    expect(hour0?.assigned).toBe(1);
    expect(hour0?.deficit).toBe(0);
  });

  it("flags coverage gaps and unfilled slots when understaffed (acceptance 6 & 10)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [mkDealer("a")], // only one dealer for a 3-need slot
      templates: [mkTemplate("t1", "16:00", "00:00", { needCount: 3 })],
      availability: [],
      config: { ...CONFIG, requirementByHour: { 16: 3, 17: 3 } },
      nowIso: iso(WD, "07:00"),
    });
    const unfilled = result.unfilled.find((u) => u.templateId === "t1");
    expect(unfilled?.missing).toBe(2);
    const hour16 = result.coverage.find((c) => c.hour === 16);
    expect(hour16?.deficit).toBe(2); // 3 required − 1 assigned
    expect(hour16?.status).toBe("under");
    expect(result.warnings.some((w) => w.kind === "coverage_gap")).toBe(true);
  });

  it("does not schedule a PLO slot to a non-PLO dealer (acceptance 3)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [mkDealer("a", { skills: ["Cash"] })],
      templates: [mkTemplate("t1", "12:00", "20:00", { requiredSkills: ["PLO"] })],
      availability: [],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    });
    expect(result.assignments).toHaveLength(0);
    expect(
      result.rejections.some((r) => r.dealerId === "a" && r.reason === "missing_required_skill")
    ).toBe(true);
  });

  it("does not exceed weekly max hours when filling (acceptance 5)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [mkDealer("a", { assignedHoursThisWeek: 44, maxHoursPerWeek: 48 })],
      templates: [mkTemplate("t1", "08:00", "16:00")],
      availability: [],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    });
    expect(result.assignments).toHaveLength(0);
    expect(
      result.rejections.some((r) => r.dealerId === "a" && r.reason === "exceeds_weekly_max_hours")
    ).toBe(true);
  });

  it("schedules a Lead-required slot only to a Lead (acceptance 7)", () => {
    const result = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: [
        mkDealer("nonlead", { isLead: false, skills: ["Tournament"] }),
        mkDealer("lead", { isLead: true, tier: "A", skills: ["Tournament"] }),
      ],
      templates: [
        mkTemplate("t1", "16:00", "00:00", { needsLead: true, requiredSkills: ["Tournament"] }),
      ],
      availability: [],
      config: CONFIG,
      nowIso: iso(WD, "07:00"),
    });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].dealerId).toBe("lead");
    expect(result.assignments[0].role).toBe("Lead");
  });
});

// ── Coverage helper direct ──────────────────────────────────────────────────

describe("shiftPlanner/computeCoverageByHour", () => {
  it("returns 24 buckets and marks over/under/ok", () => {
    const buckets = computeCoverageByHour(
      [
        {
          templateId: "t1",
          templateLabel: "08:00",
          dealerId: "a",
          dealerName: "A",
          workDate: WD,
          scheduledStartAt: iso(WD, "08:00"),
          scheduledEndAt: iso(WD, "16:00"),
          durationHours: 8,
          role: "Dealer",
          status: "draft",
          score: 10,
          scoreBreakdown: [],
          reasons: [],
          isNightShift: false,
        },
      ],
      { 8: 1, 9: 2, 16: 0 },
      TZ
    );
    expect(buckets).toHaveLength(24);
    expect(buckets.find((b) => b.hour === 8)?.status).toBe("ok"); // covered, req met
    expect(buckets.find((b) => b.hour === 9)?.status).toBe("under"); // covered, short 1
    expect(buckets.find((b) => b.hour === 10)?.status).toBe("over"); // covered, req 0
    expect(buckets.find((b) => b.hour === 16)?.status).toBe("ok"); // end exclusive, not covered
  });
});
