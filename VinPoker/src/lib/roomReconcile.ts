/**
 * roomReconcile — shared helpers/types for the room-reconcile RPC
 * `reconcile_dealer_room_state` (LIVE since 2026-06-13, incl. club-scope fix
 * 20260818000002 and the park-and-place swap fix 20260819000004).
 *
 * Consumed by the multi-table wizard (#33F). These were copied from
 * CorrectWrongTableDealerModal.tsx (the single-table modal, #33C) so the
 * wizard does not duplicate them inline. The merged modal is intentionally
 * left unchanged in #33F; a follow-up PR will refactor it to consume this
 * module once #33F stabilizes.
 */
import { supabase } from "@/integrations/supabase/client";

export const QUICK_MINUTES = [5, 10, 15] as const;

export const DISPLACED_OPTIONS = [
  { value: "pool_available", label: "Về pool (sẵn sàng nhận bàn)" },
  { value: "on_break", label: "Cho nghỉ giải lao" },
  { value: "unknown_needs_floor_check", label: "Chưa rõ — giữ lại, floor kiểm tra" },
  { value: "no_show", label: "Không có mặt (no-show)" },
] as const;

export const ACTION_LABELS: Record<string, string> = {
  move: "Chuyển bàn",
  assign: "Gán mới",
  release: "Giải phóng",
  already_correct: "Đã đúng",
  blocked: "Bị chặn",
};

export const CONFLICT_LABELS: Record<string, string> = {
  effective_at_before_assignment: "Thời điểm sửa sớm hơn lúc dealer được gán — kiểm tra lại giờ",
  dealer_active_elsewhere: "Dealer đang được ghi ở bàn khác chưa nằm trong sửa đổi (trạng thái vừa thay đổi?)",
  empty_not_confirmed: "Bàn sẽ trống nhưng chưa được xác nhận trống",
  displaced_unresolved: "Dealer bị thay chưa có hướng xử lý",
  dealer_duplicate_in_payload: "Cùng một dealer được ghi ở hai bàn trong sửa đổi",
};

export interface PlanRow {
  table_id: string;
  action: string;
  current_attendance_id?: string | null;
  actual_attendance_id?: string | null;
  expected_assignment_id?: string | null; // CAS echo from dry-run
  expected_version?: number | null; // CAS echo from dry-run
}

export interface ConflictRow {
  type?: string;
  [k: string]: unknown;
}

export interface ReconcileResult {
  outcome?: string;
  detail?: string;
  can_apply?: boolean;
  correction_id?: string;
  plan?: PlanRow[];
  conflicts?: ConflictRow[];
  summary?: {
    released?: number;
    moved?: number;
    assigned?: number;
    displaced?: number;
    slots_superseded?: number;
  };
}

export type CorrectionEntry = Record<string, unknown>;

export function hhmm(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--";
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Effective time: explicit datetime-local wins, else now − minutesAgo. */
export function computeEffectiveAtMs(customTime: string, minutesAgo: number): number | null {
  if (customTime) {
    const t = new Date(customTime).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return Date.now() - minutesAgo * 60_000;
}

export function isTooFuture(ms: number | null): boolean {
  return ms != null && ms > Date.now() + 60_000;
}

export function isTooOld(ms: number | null): boolean {
  return ms != null && ms < Date.now() - 120 * 60_000;
}

/** Copy CAS echo (expected_assignment_id/expected_version) from a dry-run plan
 *  into the apply corrections payload, matched by table_id. */
export function attachCas(corrections: CorrectionEntry[], casPlan: PlanRow[] | null): CorrectionEntry[] {
  if (!casPlan) return corrections;
  for (const c of corrections) {
    const p = casPlan.find((r) => r.table_id === (c.table_id as string));
    if (p?.expected_assignment_id) c.expected_assignment_id = p.expected_assignment_id;
    if (p?.expected_version != null) c.expected_version = p.expected_version;
  }
  return corrections;
}

export interface CallReconcileArgs {
  clubId: string;
  corrections: CorrectionEntry[];
  displaced: CorrectionEntry[];
  effectiveAtMs: number;
  reason: string;
  dryRun: boolean;
  adminOverride: boolean;
}

/** Named-param call to the live RPC. Untyped (.rpc as any): not in generated
 *  types yet — same pattern as set_rotation_slot_dealer / the single-table modal. */
export async function callReconcile(args: CallReconcileArgs): Promise<ReconcileResult> {
  const { clubId, corrections, displaced, effectiveAtMs, reason, dryRun, adminOverride } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("reconcile_dealer_room_state", {
    p_club_id: clubId,
    p_corrections: corrections,
    p_effective_at: new Date(effectiveAtMs).toISOString(),
    p_reason: reason,
    p_displaced: displaced,
    p_dry_run: dryRun,
    p_admin_override: adminOverride,
  });
  if (error) throw new Error(error.message);
  return data as ReconcileResult;
}
