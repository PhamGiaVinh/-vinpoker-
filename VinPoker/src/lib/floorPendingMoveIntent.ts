import type { FloorExactMoveIntent } from "@/lib/floorTableControlV3";

/** Recovery journal only; never a source of permission, occupancy or ticket validity. */
export type PendingFloorMove = {
  scope: string;
  /** Undefined identifies legacy v4 journals; never reinterpret them as v5. */
  operation?: "move_player_seat_v4" | "move_player_seat_v5";
  intent: FloorExactMoveIntent;
  sourceSeat: number;
  stack: number;
  fromTableNumber: number | null;
  toTableNumber: number | null;
  meta: { name: string; start_time: string | null };
};

const key = (scope: string) => `vp:floor-move-intent:v1:${encodeURIComponent(scope)}`;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 500;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function readPendingFloorMove(scope: string): PendingFloorMove | null {
  const raw = sessionStorage.getItem(key(scope));
  if (raw === null) return null;
  const stored: unknown = JSON.parse(raw);
  if (!stored || typeof stored !== "object") throw new Error("Mã yêu cầu đã lưu không hợp lệ.");
  const value = stored as Partial<PendingFloorMove>;
  const intent = value.intent;
  if (value.scope !== scope || (value.operation !== undefined
    && value.operation !== "move_player_seat_v4" && value.operation !== "move_player_seat_v5") || !intent
    || ![intent.entryId, intent.fromTournamentTableId, intent.fromTableSessionId,
      intent.toTournamentTableId, intent.toTableSessionId, intent.reason, intent.requestId].every(text)
    || ![intent.expectedSourceRevision, intent.expectedDestinationRevision,
      intent.expectedSourceEpoch, intent.expectedDestinationEpoch, intent.toSeatNumber, value.sourceSeat, value.stack].every(integer)
    || intent.toSeatNumber < 1 || (value.sourceSeat ?? 0) < 1
    || ![value.fromTableNumber, value.toTableNumber].every((number) => number === null || integer(number))
    || !value.meta || !text(value.meta.name)
    || !(value.meta.start_time === null || text(value.meta.start_time))) {
    throw new Error("Mã yêu cầu đã lưu không hợp lệ. Chưa thể tạo thao tác khác.");
  }
  return value as PendingFloorMove;
}

export function savePendingFloorMove(value: PendingFloorMove): void {
  const existing = readPendingFloorMove(value.scope);
  if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error("Entry còn một yêu cầu chưa xác minh; không được thay payload hoặc mã yêu cầu.");
  }
  sessionStorage.setItem(key(value.scope), JSON.stringify(value));
  // Fail before sending if browser storage silently refuses the journal write.
  if (sessionStorage.getItem(key(value.scope)) !== JSON.stringify(value)) {
    throw new Error("Không lưu được mã yêu cầu để khôi phục sau reload.");
  }
}

export function clearPendingFloorMove(value: PendingFloorMove): void {
  const existing = readPendingFloorMove(value.scope);
  if (existing && existing.intent.requestId !== value.intent.requestId) {
    throw new Error("Mã yêu cầu hiện tại đã thay đổi; cần đối chiếu lại.");
  }
  sessionStorage.removeItem(key(value.scope));
  if (sessionStorage.getItem(key(value.scope)) !== null) throw new Error("Không xóa được mã đã đối chiếu.");
}
