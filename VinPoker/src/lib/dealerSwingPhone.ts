export type DealerPhoneInputMethod = "camera" | "paste" | "manual_list";
export type DealerPhoneCheckinMode = "scheduled" | "unscheduled";

export type DealerPhoneCheckinOutcome =
  | "completed"
  | "partial"
  | "rollout_disabled"
  | "invalid_request"
  | "duplicate_dealer"
  | "batch_too_large"
  | "idempotency_conflict";

export type DealerPhoneCheckinCode =
  | "checked_in_waiting"
  | "checked_in_available"
  | "already_checked_in"
  | "too_early"
  | "dealer_not_found"
  | "dealer_inactive"
  | "club_mismatch"
  | "shift_not_found"
  | "shift_dealer_mismatch"
  | "invalid_shift_state"
  | "reason_required"
  | "conflict"
  | "failed";

export interface DealerPhoneRolloutState {
  master_enabled: boolean;
  allowlisted: boolean;
  all_clubs_enabled: boolean;
  reason?: string | null;
}

export interface DealerPhoneCheckinEntry {
  entry_id: string;
  mode: DealerPhoneCheckinMode;
  input_method: DealerPhoneInputMethod;
  user_id: string | null;
  dealer_id: string | null;
  shift_assignment_id: string | null;
  reason: string | null;
}

export interface DealerPhoneCheckinResult {
  entry_id: string;
  dealer_id?: string | null;
  code: DealerPhoneCheckinCode;
  arrival_at?: string | null;
  payroll_start_at?: string | null;
  window_opens_at?: string | null;
}

export interface DealerPhoneCheckinResponse {
  outcome: DealerPhoneCheckinOutcome;
  request_id?: string;
  club_id?: string;
  reason?: string;
  limit?: number;
  results?: DealerPhoneCheckinResult[];
}

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const USER_QR_RE = new RegExp(`^vinpoker://user/(${UUID_PART})$`);

export function parseDealerUserQr(value: string): string | null {
  const match = USER_QR_RE.exec(value);
  return match ? match[1] : null;
}

export function resolveDealerPhoneRollout(
  state: DealerPhoneRolloutState | null,
  sourceWideRolloutEnabled: boolean,
): boolean {
  if (!state?.master_enabled) return false;
  if (state.allowlisted) return true;
  return sourceWideRolloutEnabled && state.all_clubs_enabled;
}

export const CHECKIN_CODE_LABELS: Record<DealerPhoneCheckinCode, string> = {
  checked_in_waiting: "Đã ghi nhận đến, đang chờ giờ vào ca",
  checked_in_available: "Đã check-in và vào pool",
  already_checked_in: "Dealer đã check-in trước đó",
  too_early: "Chưa đến khung giờ được check-in",
  dealer_not_found: "Không tìm thấy dealer",
  dealer_inactive: "Dealer không còn hoạt động",
  club_mismatch: "Dealer không thuộc CLB đang chọn",
  shift_not_found: "Không tìm thấy ca đã phát hành",
  shift_dealer_mismatch: "Ca không thuộc dealer này",
  invalid_shift_state: "Ca không ở trạng thái hợp lệ",
  reason_required: "Cần nhập lý do ngoài lịch",
  conflict: "Dữ liệu vừa thay đổi, cần tải lại",
  failed: "Không thể check-in dealer",
};

export const CHECKIN_OUTCOME_LABELS: Record<DealerPhoneCheckinOutcome, string> = {
  completed: "Đã xử lý toàn bộ dealer",
  partial: "Một số dealer chưa được xử lý",
  rollout_disabled: "Tính năng vừa được quản trị viên tắt",
  invalid_request: "Yêu cầu không hợp lệ",
  duplicate_dealer: "Danh sách có dealer bị trùng",
  batch_too_large: "Mỗi lần chỉ check-in tối đa 50 dealer",
  idempotency_conflict: "Mã yêu cầu đã được dùng cho dữ liệu khác",
};
