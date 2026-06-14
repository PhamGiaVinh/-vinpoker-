// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2.1 — pure auto-fill scheduler core
// ═══════════════════════════════════════════════════════════════════════════════
// Hardens the owner's generateDailyDraft sample: typed hard-reject reasons,
// cross-midnight rest + duration, weekly-hours cap, night-shift fairness, and
// coverage-by-hour. Pure (no React / Supabase): inputs in, draft out.
//
// Invariants enforced:
//   • a dealer gets at most ONE assignment per work date
//   • no scheduling onto leave / unavailable / missing-skill / over-cap shifts
//   • ≥ minRestHours between a dealer's previous shift end and a new start

import type {
  AvailabilityRequest,
  CoverageBucket,
  DraftAssignment,
  GenerateDailyDraftInput,
  GenerateDailyDraftResult,
  RejectionReason,
  RejectionRecord,
  ScoreComponent,
  SchedulerConfig,
  SchedulerDealer,
  SchedulerWarning,
  ShiftTemplate,
  UnfilledSlot,
} from "@/types/shiftPlanner";
import { computeCoverageByHour } from "./coverage";
import { hoursBetween, isNightShift, shiftDurationHours } from "./time";

export const SOLVER_VERSION = "shift-planner-v2.1";

/** A dealer must have ≥1 of the slot's required skills (none required → ok). */
function hasRequiredSkill(dealer: SchedulerDealer, template: ShiftTemplate): boolean {
  if (template.requiredSkills.length === 0) return true;
  return template.requiredSkills.some((skill) => dealer.skills.includes(skill));
}

const REJECTION_DETAILS: Record<RejectionReason, string> = {
  already_assigned_same_day: "Đã có ca trong ngày",
  on_leave: "Đã xin nghỉ",
  marked_unavailable: "Báo không thể làm khung này",
  missing_required_skill: "Thiếu kỹ năng yêu cầu",
  exceeds_weekly_max_hours: "Vượt giới hạn giờ/tuần",
  insufficient_rest: "Chưa đủ thời gian nghỉ giữa hai ca",
  needs_lead: "Ca yêu cầu Lead/Senior",
  inactive: "Dealer không ở trạng thái hoạt động",
};

/** All hard-reject reasons (empty array = eligible). Order is most-fundamental
 *  first so callers can show a primary reason via [0]. */
export function hardRejectReasons(
  dealer: SchedulerDealer,
  template: ShiftTemplate,
  workDate: string,
  request: AvailabilityRequest | undefined,
  config: SchedulerConfig,
  alreadyAssignedToday: ReadonlySet<string>
): RejectionReason[] {
  const reasons: RejectionReason[] = [];

  if (dealer.status !== "active") reasons.push("inactive");
  if (alreadyAssignedToday.has(dealer.id)) reasons.push("already_assigned_same_day");
  if (request?.leaveRequested) reasons.push("on_leave");
  if (dealer.unavailableDates?.includes(workDate)) reasons.push("marked_unavailable");
  if (request?.unavailableTemplateIds.includes(template.id)) reasons.push("marked_unavailable");
  if (!hasRequiredSkill(dealer, template)) reasons.push("missing_required_skill");

  const duration = shiftDurationHours(template.startAt, template.endAt);
  if (dealer.assignedHoursThisWeek + duration > dealer.maxHoursPerWeek) {
    reasons.push("exceeds_weekly_max_hours");
  }
  if (template.needsLead && !dealer.isLead) reasons.push("needs_lead");

  if (dealer.lastShiftEndAt) {
    const rest = hoursBetween(dealer.lastShiftEndAt, template.startAt);
    if (rest >= 0 && rest < config.minRestHours) reasons.push("insufficient_rest");
  }

  return reasons;
}

export interface CandidateScore {
  score: number;
  breakdown: ScoreComponent[];
  reasons: string[];
}

/** Soft score for an eligible dealer/slot pairing. Spec weights. */
export function scoreDealerForSlot(
  dealer: SchedulerDealer,
  template: ShiftTemplate,
  config: SchedulerConfig,
  request: AvailabilityRequest | undefined
): CandidateScore {
  const breakdown: ScoreComponent[] = [];
  const reasons: string[] = [];
  const add = (label: string, points: number) => {
    breakdown.push({ label, points });
    if (points > 0) reasons.push(label);
  };

  const duration = shiftDurationHours(template.startAt, template.endAt);
  const startKey = template.label.slice(0, 5); // "08:00" style key when present
  const night = isNightShift(template.startAt, template.endAt, config.tzOffsetMinutes);

  if (request?.preferredTemplateIds.includes(template.id)) add("Đúng nguyện vọng ưu tiên", 35);
  if (request?.availableTemplateIds.includes(template.id)) add("Xác nhận có thể làm khung này", 18);

  const historyHits =
    dealer.preferredStartHours[startKey] ?? dealer.preferredStartHours[template.label] ?? 0;
  if (historyHits > 0) add("Thường làm khung giờ này", Math.min(20, historyHits * 5));

  if (hasRequiredSkill(dealer, template) && template.requiredSkills.length > 0) {
    add("Đúng kỹ năng yêu cầu", 10);
  } else if (dealer.isLead || dealer.tier === "A") {
    add("Cấp bậc phù hợp peak/giám sát", 10);
  }

  const projected = dealer.assignedHoursThisWeek + duration;
  if (projected <= dealer.weeklyTargetHours) add("Còn room giờ/tuần", 8);
  else if (projected > dealer.maxHoursPerWeek * 0.9) add("Gần chạm giới hạn giờ/tuần", -10);

  if (night && dealer.nightShiftsThisWeek + 1 > config.maxNightShiftsPerWeek) {
    add("Quá nhiều ca đêm trong tuần", -15);
  }

  // Ignored an explicitly stated preference: dealer listed preferred shifts but
  // this is not one of them (and they did not request leave).
  if (
    request &&
    !request.leaveRequested &&
    request.preferredTemplateIds.length > 0 &&
    !request.preferredTemplateIds.includes(template.id)
  ) {
    add("Lệch nguyện vọng nhân viên", -20);
  }

  const score = breakdown.reduce((sum, c) => sum + c.points, 0);
  return { score, breakdown, reasons };
}

/** Build the per-dealer weekly-hours lookup (helper for adapters/tests). */
export function buildWeeklyHoursMap(dealers: SchedulerDealer[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const d of dealers) map[d.id] = d.assignedHoursThisWeek;
  return map;
}

/** Harder slots first: Lead-required, then more required skills, then earlier start. */
function templateHardness(t: ShiftTemplate): number {
  return (t.needsLead ? 1000 : 0) + t.requiredSkills.length * 100;
}

export function generateDailyDraft(input: GenerateDailyDraftInput): GenerateDailyDraftResult {
  const { workDate, dealers, templates, availability, config } = input;
  const requestByDealer = new Map(availability.map((r) => [r.dealerId, r]));
  const alreadyAssignedToday = new Set<string>();
  const assignments: DraftAssignment[] = [];
  const unfilled: UnfilledSlot[] = [];
  const rejections: RejectionRecord[] = [];
  const warnings: SchedulerWarning[] = [];

  const sortedTemplates = [...templates].sort((a, b) => {
    const byHardness = templateHardness(b) - templateHardness(a);
    if (byHardness !== 0) return byHardness;
    return Date.parse(a.startAt) - Date.parse(b.startAt);
  });

  for (const template of sortedTemplates) {
    const duration = shiftDurationHours(template.startAt, template.endAt);
    const night = isNightShift(template.startAt, template.endAt, config.tzOffsetMinutes);

    let filled = 0;
    while (filled < template.needCount) {
      const candidates = dealers
        .map((dealer) => {
          const request = requestByDealer.get(dealer.id);
          const rejects = hardRejectReasons(
            dealer,
            template,
            workDate,
            request,
            config,
            alreadyAssignedToday
          );
          if (rejects.length > 0) return null;
          return { dealer, request, ...scoreDealerForSlot(dealer, template, config, request) };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.dealer.assignedHoursThisWeek !== b.dealer.assignedHoursThisWeek) {
            return a.dealer.assignedHoursThisWeek - b.dealer.assignedHoursThisWeek;
          }
          if (a.dealer.tier !== b.dealer.tier) return a.dealer.tier.localeCompare(b.dealer.tier);
          return a.dealer.id.localeCompare(b.dealer.id);
        });

      const selected = candidates[0];
      if (!selected) break;

      assignments.push({
        templateId: template.id,
        templateLabel: template.label,
        dealerId: selected.dealer.id,
        dealerName: selected.dealer.fullName,
        workDate,
        scheduledStartAt: template.startAt,
        scheduledEndAt: template.endAt,
        durationHours: duration,
        role: template.needsLead ? "Lead" : "Dealer",
        status: "draft",
        score: selected.score,
        scoreBreakdown: selected.breakdown,
        reasons: selected.reasons,
        isNightShift: night,
      });

      alreadyAssignedToday.add(selected.dealer.id);

      if (selected.score < 20) {
        warnings.push({
          kind: "low_score",
          detail: `${selected.dealer.fullName} xếp ${template.label} với điểm thấp (${selected.score}) — TD nên kiểm tra lại.`,
        });
      }
      const projected = selected.dealer.assignedHoursThisWeek + duration;
      if (projected > selected.dealer.maxHoursPerWeek * 0.9) {
        warnings.push({
          kind: "near_weekly_limit",
          detail: `${selected.dealer.fullName} gần chạm giới hạn giờ/tuần (${projected.toFixed(0)}/${selected.dealer.maxHoursPerWeek}h).`,
        });
      }
      if (night && selected.dealer.nightShiftsThisWeek + 1 > config.maxNightShiftsPerWeek) {
        warnings.push({
          kind: "night_overload",
          detail: `${selected.dealer.fullName} nhận thêm ca đêm (${selected.dealer.nightShiftsThisWeek + 1} ca đêm/tuần).`,
        });
      }

      filled++;
    }

    if (filled < template.needCount) {
      const missing = template.needCount - filled;
      unfilled.push({
        templateId: template.id,
        templateLabel: template.label,
        missing,
        detail: `Thiếu ${missing} dealer cho ${template.label}.`,
      });
      // Why couldn't we fill it — record hard-reject reasons for the unassigned.
      for (const dealer of dealers) {
        if (alreadyAssignedToday.has(dealer.id)) continue;
        const request = requestByDealer.get(dealer.id);
        const rejects = hardRejectReasons(
          dealer,
          template,
          workDate,
          request,
          config,
          alreadyAssignedToday
        );
        if (rejects.length === 0) continue;
        const reason = rejects[0];
        rejections.push({
          dealerId: dealer.id,
          dealerName: dealer.fullName,
          templateId: template.id,
          templateLabel: template.label,
          reason,
          detail: REJECTION_DETAILS[reason],
        });
      }
    }
  }

  const coverage: CoverageBucket[] = computeCoverageByHour(
    assignments,
    config.requirementByHour,
    config.tzOffsetMinutes
  );
  for (const bucket of coverage) {
    if (bucket.deficit >= 1) {
      warnings.push({
        kind: "coverage_gap",
        detail: `Thiếu ${bucket.deficit} dealer lúc ${String(bucket.hour).padStart(2, "0")}:00 (cần ${bucket.required}, đã xếp ${bucket.assigned}).`,
      });
    }
  }

  return {
    assignments,
    unfilled,
    rejections,
    coverage,
    warnings,
    runMeta: {
      solverVersion: SOLVER_VERSION,
      generatedAt: input.nowIso ?? new Date().toISOString(),
      workDate,
    },
  };
}
