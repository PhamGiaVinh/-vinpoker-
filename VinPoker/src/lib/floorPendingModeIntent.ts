/** Same-tab recovery journal only. Server still authorizes and validates every replay. */
export type PendingFloorModeIntent = {
  scope: string;
  args: { tournamentTableId: string; tableSessionId: string; controlMode: "manual" | "tracker";
    expectedRevision: number; expectedEpoch: number; requestId: string };
};
const key = (scope: string) => `vp:floor-mode-intent:v1:${encodeURIComponent(scope)}`;
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 500;
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function readPendingFloorModeIntent(scope: string): PendingFloorModeIntent | null {
  const raw = sessionStorage.getItem(key(scope));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.scope !== scope || !record(value.args)
    || ![value.args.tournamentTableId, value.args.tableSessionId, value.args.requestId].every(text)
    || ![value.args.expectedRevision, value.args.expectedEpoch].every(integer)
    || !["manual", "tracker"].includes(String(value.args.controlMode))) {
    throw new Error("Yêu cầu đổi mode đã lưu không hợp lệ; chưa thể tạo thao tác khác.");
  }
  return value as PendingFloorModeIntent;
}

export function savePendingFloorModeIntent(value: PendingFloorModeIntent): void {
  const old = readPendingFloorModeIntent(value.scope);
  const raw = JSON.stringify(value);
  if (old && JSON.stringify(old) !== raw) throw new Error("Còn yêu cầu chưa xác minh; không thay payload hoặc request ID.");
  sessionStorage.setItem(key(value.scope), raw);
  if (sessionStorage.getItem(key(value.scope)) !== raw) throw new Error("Không lưu được yêu cầu để khôi phục sau reload.");
}

export function clearPendingFloorModeIntent(value: PendingFloorModeIntent): void {
  const old = readPendingFloorModeIntent(value.scope);
  if (old && JSON.stringify(old) !== JSON.stringify(value)) throw new Error("Yêu cầu đã lưu bị thay đổi; cần đối chiếu lại.");
  sessionStorage.removeItem(key(value.scope));
  if (sessionStorage.getItem(key(value.scope)) !== null) throw new Error("Không xóa được yêu cầu đã đối chiếu.");
}
