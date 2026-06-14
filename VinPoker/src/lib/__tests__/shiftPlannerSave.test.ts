import { describe, expect, it } from "vitest";
import { buildSaveRunPayload } from "../shiftPlanner/savePayload";
import type { GenerateDailyDraftResult } from "@/types/shiftPlanner";

const OFF = "+07:00";
const WD = "2026-06-17";

const draft: GenerateDailyDraftResult = {
  assignments: [
    {
      templateId: "t1",
      templateLabel: "08–16",
      dealerId: "d1",
      dealerName: "Dealer A",
      workDate: WD,
      scheduledStartAt: `${WD}T08:00:00${OFF}`,
      scheduledEndAt: `${WD}T16:00:00${OFF}`,
      durationHours: 8,
      role: "Dealer",
      status: "draft",
      score: 50,
      scoreBreakdown: [],
      reasons: ["Đúng kỹ năng"],
      isNightShift: false,
    },
  ],
  unfilled: [],
  rejections: [],
  coverage: [],
  warnings: [],
  runMeta: { solverVersion: "shift-planner-v2.1", generatedAt: `${WD}T07:00:00${OFF}`, workDate: WD },
};

describe("buildSaveRunPayload", () => {
  it("maps a draft to save_shift_run args (preserving timestamptz + role + score)", () => {
    const args = buildSaveRunPayload("c1", WD, draft);
    expect(args.p_club_id).toBe("c1");
    expect(args.p_work_date).toBe(WD);
    expect(args.p_solver_version).toBe("shift-planner-v2.1");
    expect(args.p_assignments).toHaveLength(1);
    expect(args.p_assignments[0]).toMatchObject({
      dealer_id: "d1",
      template_id: "t1",
      scheduled_start_at: `${WD}T08:00:00${OFF}`,
      scheduled_end_at: `${WD}T16:00:00${OFF}`,
      role: "Dealer",
      score: 50,
      reason: { reasons: ["Đúng kỹ năng"] },
    });
  });

  it("handles an empty draft", () => {
    const args = buildSaveRunPayload("c1", WD, { ...draft, assignments: [] });
    expect(args.p_assignments).toEqual([]);
  });
});
