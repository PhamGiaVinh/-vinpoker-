// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2 — plain-VN labels + actionable hints per rejection
// ═══════════════════════════════════════════════════════════════════════════════
// The scheduler's RejectionReason codes already carry VN details inside
// generateDailyDraft (REJECTION_DETAILS, module-private). The V2 UI needs the
// same labels EXPORTED plus a one-line "what to do next" hint per reason, and a
// severity split: HARD reasons block a manual add outright; SOFT reasons warn
// but allow an explicit override ("Vẫn gán") — manual assignment intentionally
// bypasses availability, mirroring AddShiftDialog's contract.

import type { RejectionReason } from "@/types/shiftPlanner";

export const REJECTION_LABELS: Record<RejectionReason, string> = {
  already_assigned_same_day: "Đã có ca trong ngày",
  on_leave: "Đã xin nghỉ",
  marked_unavailable: "Báo không thể làm khung này",
  missing_required_skill: "Thiếu kỹ năng yêu cầu",
  exceeds_weekly_max_hours: "Vượt giới hạn giờ/tuần",
  insufficient_rest: "Chưa đủ giờ nghỉ giữa 2 ca",
  needs_lead: "Ca yêu cầu Lead/Senior",
  inactive: "Dealer không hoạt động",
};

export const REJECTION_HINTS: Record<RejectionReason, string> = {
  already_assigned_same_day: "Mỗi dealer 1 ca/ngày — xoá ca cũ trước nếu muốn đổi khung.",
  on_leave: "Dealer đã được duyệt nghỉ hôm nay — chọn người khác.",
  marked_unavailable: "Dealer báo bận khung này — chọn khung khác hoặc người khác.",
  missing_required_skill: "Chọn dealer có kỹ năng phù hợp, hoặc bỏ yêu cầu kỹ năng ở Quản lý ca.",
  exceeds_weekly_max_hours: "Dealer sắp vượt giờ/tuần — chọn người còn quỹ giờ.",
  insufficient_rest: "Chọn dealer khác hoặc khung ca bắt đầu muộn hơn.",
  needs_lead: "Chọn dealer Lead/Senior (hạng A), hoặc tắt yêu cầu Lead ở Quản lý ca.",
  inactive: "Dealer đang tắt hoạt động — bật lại ở Quản lý Dealer nếu cần.",
};

/** Reasons that BLOCK a manual add (DB/unique-index would reject anyway). */
export const HARD_REJECTIONS: ReadonlySet<RejectionReason> = new Set([
  "already_assigned_same_day",
  "inactive",
]);

export function isHardRejection(r: RejectionReason): boolean {
  return HARD_REJECTIONS.has(r);
}

/** Plain-VN fit label replacing the opaque "95đ" score readout. */
export function fitLabel(score: number): { label: string; tone: "good" | "ok" | "meh" } {
  if (score >= 40) return { label: "Rất phù hợp", tone: "good" };
  if (score >= 15) return { label: "Phù hợp", tone: "ok" };
  return { label: "Tạm được", tone: "meh" };
}
