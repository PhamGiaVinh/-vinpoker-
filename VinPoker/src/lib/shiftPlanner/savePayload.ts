// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — save_shift_run payload builder (pure)
// ═══════════════════════════════════════════════════════════════════════════════
// Maps an in-memory draft → the exact args the save_shift_run RPC expects.

import type { GenerateDailyDraftResult } from "@/types/shiftPlanner";

export interface SaveRunAssignmentRow {
  dealer_id: string;
  template_id: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  role: string;
  score: number | null;
  reason: { reasons: string[] };
}

export interface SaveRunArgs {
  p_club_id: string;
  p_work_date: string;
  p_solver_version: string;
  p_params: Record<string, unknown>;
  p_assignments: SaveRunAssignmentRow[];
}

export function buildSaveRunPayload(
  clubId: string,
  workDate: string,
  draft: GenerateDailyDraftResult,
  /** Extra run params persisted alongside (e.g. V2 demand overrides). */
  paramsExtra?: Record<string, unknown>
): SaveRunArgs {
  return {
    p_club_id: clubId,
    p_work_date: workDate,
    p_solver_version: draft.runMeta.solverVersion,
    p_params: paramsExtra ?? {},
    p_assignments: draft.assignments.map((a) => ({
      dealer_id: a.dealerId,
      template_id: a.templateId,
      scheduled_start_at: a.scheduledStartAt,
      scheduled_end_at: a.scheduledEndAt,
      role: a.role,
      score: a.score,
      reason: { reasons: a.reasons },
    })),
  };
}
