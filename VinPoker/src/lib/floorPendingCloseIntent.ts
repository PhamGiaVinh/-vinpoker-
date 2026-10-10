import type { FloorBreakPlan } from "@/lib/floorTableControlV3";

/** Same-tab recovery only. The journal grants no permission and is not a current roster. */
export type PendingFloorClose = {
  scope: string;
  tournamentId: string;
  tournamentTableId: string;
  tableSessionId: string;
  expectedRevision: number;
  controlEpoch: number;
  activeSeatCount: number;
  requestId: string;
  drawMode: "redraw_balanced" | "fill_lowest_table";
  plan?: FloorBreakPlan;
};

const key = (scope: string) => `vp:floor-close-intent:v1:${encodeURIComponent(scope)}`;
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 500;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function readPendingFloorClose(scope: string): PendingFloorClose | null {
  const raw = sessionStorage.getItem(key(scope));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.scope !== scope
    || ![value.tournamentId, value.tournamentTableId, value.tableSessionId, value.requestId].every(text)
    || ![value.expectedRevision, value.controlEpoch, value.activeSeatCount].every(integer)
    || !["redraw_balanced", "fill_lowest_table"].includes(String(value.drawMode))) {
    throw new Error("Yêu cầu đóng bàn đã lưu không hợp lệ. Chưa thể tạo thao tác khác.");
  }
  const plan = value.plan;
  if (value.activeSeatCount === 0) {
    if (plan !== undefined) throw new Error("Yêu cầu bàn trống không được chứa kế hoạch chuyển người.");
  } else if (!record(plan) || plan.complete !== true || !text(plan.planHash)
    || plan.sourceTournamentTableId !== value.tournamentTableId || plan.expectedRevision !== value.expectedRevision
    || !integer(plan.sourceTableNumber) || !Array.isArray(plan.blockers) || plan.blockers.length !== 0
    || !Array.isArray(plan.moves) || plan.moves.length !== value.activeSeatCount
    || plan.moves.some((move) => !record(move)
      || ![move.entryId, move.playerName, move.destinationTournamentTableId].every(text)
      || !integer(move.sourceSeatNumber) || move.sourceSeatNumber < 1
      || !integer(move.destinationSeatNumber) || move.destinationSeatNumber < 1
      || !integer(move.destinationTableNumber)
      || !["immediate", "after_current_hand"].includes(String(move.transferMode)))
    || new Set(plan.moves.map((move) => move.entryId)).size !== plan.moves.length
    || new Set(plan.moves.map((move) => move.sourceSeatNumber)).size !== plan.moves.length) {
    throw new Error("Kế hoạch đóng bàn đã lưu không đầy đủ hoặc không khớp phiên bàn.");
  }
  return value as PendingFloorClose;
}

export function savePendingFloorClose(value: PendingFloorClose): void {
  const existing = readPendingFloorClose(value.scope);
  if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error("Bàn còn yêu cầu chưa xác minh; không được đổi payload hoặc mã yêu cầu.");
  }
  sessionStorage.setItem(key(value.scope), JSON.stringify(value));
  if (sessionStorage.getItem(key(value.scope)) !== JSON.stringify(value)) {
    throw new Error("Không lưu được yêu cầu đóng bàn để khôi phục sau reload.");
  }
}

export function clearPendingFloorClose(value: PendingFloorClose): void {
  const existing = readPendingFloorClose(value.scope);
  if (existing && existing.requestId !== value.requestId) throw new Error("Mã đóng bàn đã thay đổi; cần đối chiếu lại.");
  sessionStorage.removeItem(key(value.scope));
  if (sessionStorage.getItem(key(value.scope)) !== null) throw new Error("Không xóa được yêu cầu đóng bàn đã đối chiếu.");
}
