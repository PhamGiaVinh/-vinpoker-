// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2 — pure step/CTA derivation for the 4-step flow header
// ═══════════════════════════════════════════════════════════════════════════════
// The V2 planner guides a non-technical operator through:
//   1 Tạo lịch (AI)  →  2 Thêm thủ công  →  3 Rà soát  →  4 Phát hành & báo dealer
// Steps are navigable (operators hop back and forth); this module only DERIVES
// each chip's visual state and the single contextual CTA — it stores nothing.

export type PlannerStep = 1 | 2 | 3 | 4;
export type ChipState = "done" | "active" | "todo";

export interface PlannerFlags {
  /** A draft (AI or manual) exists for the selected date. */
  draftExists: boolean;
  /** Local edits not yet persisted via save_shift_run. */
  dirty: boolean;
  /** A run id came back from save_shift_run for the current edits. */
  saved: boolean;
  /** The date already has a published run (terminal, read-only). */
  published: boolean;
  /** Total unfilled seats across templates. */
  shortage: number;
}

export function chipStates(step: PlannerStep, f: PlannerFlags): Record<PlannerStep, ChipState> {
  if (f.published) return { 1: "done", 2: "done", 3: "done", 4: "done" };
  const doneUpTo = f.saved ? 3 : f.draftExists ? 1 : 0;
  const states = {} as Record<PlannerStep, ChipState>;
  ([1, 2, 3, 4] as PlannerStep[]).forEach((i) => {
    states[i] = i === step ? "active" : i <= doneUpTo ? "done" : "todo";
  });
  return states;
}

export interface PlannerCta {
  label: string;
  /** Which action the shell should run. */
  action: "generate" | "goManual" | "goReview" | "save" | "publish" | "none";
  disabled?: boolean;
}

/** The one primary button that always answers "làm gì tiếp theo?". */
export function ctaFor(step: PlannerStep, f: PlannerFlags): PlannerCta {
  if (f.published) return { label: "", action: "none" };
  if (!f.draftExists) return { label: "✨ Tạo nháp AI", action: "generate" };
  switch (step) {
    case 1:
      return { label: "Tiếp: Thêm thủ công →", action: "goManual" };
    case 2:
      return { label: "Tiếp: Rà soát →", action: "goReview" };
    case 3:
      return f.dirty || !f.saved
        ? { label: "💾 Lưu nháp", action: "save" }
        : { label: "Tiếp: Phát hành →", action: "publish" };
    case 4:
      return { label: "📣 Phát hành & báo dealer", action: "publish" };
  }
}

/** Which step a fresh mount should land on. */
export function initialStep(f: PlannerFlags): PlannerStep {
  if (f.published) return 4;
  if (!f.draftExists) return 1;
  if (f.saved && !f.dirty) return 4;
  return 3;
}
