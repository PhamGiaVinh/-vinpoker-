import { describe, expect, it } from "vitest";
import { computeWeeklyAggregates } from "../shiftPlanner/weeklyAggregates";
import { buildLiveScenario, requirementFromTemplates } from "../shiftPlanner/liveAdapter";
import { generateDailyDraft } from "../shiftPlanner/generateDailyDraft";
import type { ShiftTemplate } from "@/types/shiftPlanner";

const TZ = 420; // VN +07:00
const OFF = "+07:00";
const WD = "2026-06-17"; // Wednesday → local week Mon 2026-06-15 .. Sun 2026-06-21

describe("weeklyAggregates — overlap, not work_date (cross-midnight/week)", () => {
  it("counts only the in-week portion of a Sunday 18–02 shift (6h)", () => {
    const agg = computeWeeklyAggregates(
      [{ dealerId: "d1", scheduledStartAt: `2026-06-21T18:00:00${OFF}`, scheduledEndAt: `2026-06-22T02:00:00${OFF}` }],
      WD,
      TZ
    );
    expect(agg.d1.assignedHoursThisWeek).toBeCloseTo(6, 5); // 18:00–00:00 falls in this week
    expect(agg.d1.nightShiftsThisWeek).toBe(1); // starts in-week, crosses midnight
  });

  it("counts only the in-week tail of a prior-Sunday 18–02 shift (2h)", () => {
    const agg = computeWeeklyAggregates(
      [{ dealerId: "d1", scheduledStartAt: `2026-06-14T18:00:00${OFF}`, scheduledEndAt: `2026-06-15T02:00:00${OFF}` }],
      WD,
      TZ
    );
    expect(agg.d1.assignedHoursThisWeek).toBeCloseTo(2, 5); // only Mon 00:00–02:00 is in this week
    expect(agg.d1.nightShiftsThisWeek).toBe(0); // starts in the PRIOR week
    expect(agg.d1.lastShiftEndAt).toBe(new Date(`2026-06-15T02:00:00${OFF}`).toISOString());
  });
});

describe("requirementFromTemplates", () => {
  it("sums need_count across each covered local hour", () => {
    const templates: ShiftTemplate[] = [
      { id: "t1", clubId: "c", label: "08–16", startAt: `${WD}T08:00:00${OFF}`, endAt: `${WD}T16:00:00${OFF}`, defaultHours: 8, requiredSkills: [], needsLead: false, needCount: 2 },
    ];
    const req = requirementFromTemplates(templates, TZ);
    expect(req[8]).toBe(2);
    expect(req[15]).toBe(2);
    expect(req[16]).toBeUndefined(); // end is exclusive
  });
});

describe("buildLiveScenario", () => {
  it("maps DB rows → scenario (skills merge, template projection, availability) and runs the core", () => {
    const scenario = buildLiveScenario({
      clubId: "c1",
      workDate: WD,
      tzOffsetMinutes: TZ,
      dealerRows: [
        { id: "d1", club_id: "c1", full_name: "Dealer A", tier: "A", status: "active", skills: ["Cash", "Tournament"] },
        { id: "d2", club_id: "c1", full_name: "Dealer B", tier: "B", status: "active", skills: ["Cash"] },
      ],
      skillRows: [{ dealer_id: "d2", game_type: "PLO" }],
      templateRows: [
        // stored anchored to an arbitrary date — must be projected onto WD
        { id: "t1", club_id: "c1", label: "08–16", scheduled_start_at: `2026-01-01T08:00:00${OFF}`, scheduled_end_at: `2026-01-01T16:00:00${OFF}`, default_hours: 8, required_skills: [], needs_lead: false, need_count: 1 },
        { id: "t2", club_id: "c1", label: "16–00", scheduled_start_at: `2026-01-01T16:00:00${OFF}`, scheduled_end_at: `2026-01-02T00:00:00${OFF}`, default_hours: 8, required_skills: ["Tournament"], needs_lead: true, need_count: 1 },
      ],
      availabilityRows: [
        { dealer_id: "d1", work_date: WD, kind: "preferred", template_id: "t2", note: null },
        { dealer_id: "d2", work_date: WD, kind: "leave", template_id: null, note: "xin nghỉ" },
      ],
      weekAssignmentRows: [],
    });

    // dealer_skills merged into d2
    expect(scenario.dealers.find((d) => d.id === "d2")!.skills).toContain("PLO");
    // templates projected onto the selected work date
    expect(scenario.templates.find((t) => t.id === "t1")!.startAt.startsWith(WD)).toBe(true);
    // 16:00 → 00:00 rolls the end to the next calendar day
    expect(scenario.templates.find((t) => t.id === "t2")!.endAt.startsWith("2026-06-18")).toBe(true);
    // availability grouped per dealer
    expect(scenario.availability.find((a) => a.dealerId === "d2")!.leaveRequested).toBe(true);

    const draft = generateDailyDraft({
      workDate: WD,
      clubId: "c1",
      dealers: scenario.dealers,
      templates: scenario.templates,
      availability: scenario.availability,
      config: scenario.config,
      nowIso: `${WD}T07:00:00${OFF}`,
    });
    // d1 (lead + Tournament, prefers t2) fills the lead slot; d2 (on leave) is not scheduled
    expect(draft.assignments.find((a) => a.templateId === "t2")?.dealerId).toBe("d1");
    expect(draft.assignments.some((a) => a.dealerId === "d2")).toBe(false);
  });
});
