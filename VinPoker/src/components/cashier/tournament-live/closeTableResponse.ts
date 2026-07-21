export interface CloseTableMove {
  player_name: string;
  from_seat: number;
  to_table_number: number | null;
  to_seat_number: number;
  receipt_code: string;
}

export interface CloseTableResponse {
  ok?: boolean;
  closed?: boolean;
  error?: string;
  need?: number;
  have?: number;
  moved_count?: number;
  moved?: CloseTableMove[];
  total_active_seats?: number;
  entry_backed_active_seats?: number;
  unlinked_active_seats?: number;
  active_chip_total?: number;
}

/** The public shape returned by supabase-js for an RPC transport/database error. */
export interface CloseTableRpcError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export type CloseTableResult =
  | { kind: "success"; response: Required<Pick<CloseTableResponse, "moved_count" | "moved">> & CloseTableResponse }
  | { kind: "error"; response: CloseTableResponse | null; code: string; rpcError?: CloseTableRpcError };

function normalizeRpcError(value: unknown): CloseTableRpcError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = value as Record<string, unknown>;
  const stringField = (field: string): string | null => typeof error[field] === "string" ? error[field] : null;
  const normalized = {
    code: stringField("code"),
    message: stringField("message"),
    details: stringField("details"),
    hint: stringField("hint"),
  };
  return normalized.code || normalized.message || normalized.details || normalized.hint ? normalized : null;
}

/**
 * A close is only successful when the server explicitly confirms the table was
 * closed and supplies a complete move receipt. This keeps stale/partial RPC
 * responses from being rendered as a successful table break.
 */
export function parseCloseTableResult(value: unknown, sourceActiveSeats: number): CloseTableResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "error", response: null, code: "invalid_response" };
  }

  const response = value as CloseTableResponse;
  if (!response.ok || response.closed !== true) {
    return { kind: "error", response, code: response.error ?? "close_failed" };
  }
  if (!Array.isArray(response.moved) || !Number.isInteger(response.moved_count) || response.moved_count < 0) {
    return { kind: "error", response, code: "invalid_response" };
  }
  if (response.moved.length !== response.moved_count) {
    return { kind: "error", response, code: "invalid_response" };
  }
  if (sourceActiveSeats > 0 && response.moved_count === 0) {
    return { kind: "error", response, code: "unexpected_zero_moves" };
  }
  if (sourceActiveSeats > 0 && response.moved_count !== sourceActiveSeats) {
    return { kind: "error", response, code: "move_count_mismatch" };
  }

  return { kind: "success", response: response as Required<Pick<CloseTableResponse, "moved_count" | "moved">> & CloseTableResponse };
}

/**
 * Parses the separate `{ data, error }` values returned by supabase-js. A
 * transport/database error always stays distinct from the structured function
 * result, so an unrelated error can never be labeled as unlinked active seats.
 */
export function parseCloseTableRpcResult(data: unknown, error: unknown, sourceActiveSeats: number): CloseTableResult {
  const rpcError = normalizeRpcError(error);
  if (rpcError) {
    return { kind: "error", response: null, code: rpcError.code ?? "rpc_error", rpcError };
  }
  return parseCloseTableResult(data, sourceActiveSeats);
}

export function closeTableErrorMessage(response: CloseTableResponse | null, fallback?: string): string {
  const code = response?.error ?? fallback;
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền đóng bàn cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/hủy.";
    case "table_not_found": return "Không tìm thấy bàn.";
    case "table_already_closed": return "Bàn này đã được đóng bởi thao tác khác. Hãy tải lại sơ đồ bàn.";
    case "UNLINKED_ACTIVE_SEATS":
      return `Không thể đóng bàn: có ${response?.unlinked_active_seats ?? "?"}/${response?.total_active_seats ?? "?"} ghế đang chơi chưa gắn entry. Không có ghế nào bị thay đổi.`;
    case "insufficient_capacity":
      return `Không đủ ghế trống (cần ${response?.need ?? "?"}, có ${response?.have ?? "?"}) - mở thêm bàn trước khi đóng.`;
    case "unexpected_zero_moves":
      return "Máy chủ báo không chuyển ai dù bàn đang có người. Bàn chưa được xác nhận đóng - hãy tải lại và kiểm tra dữ liệu ghế.";
    case "move_count_mismatch":
      return "Số người được chuyển không khớp số ghế đang chơi. Bàn chưa được xác nhận đóng - hãy tải lại.";
    case "invalid_response":
      return "Máy chủ trả về kết quả đóng bàn không hợp lệ. Không xác nhận thao tác thành công.";
    default: return code ? `Đóng bàn thất bại (${code})` : "Đóng bàn thất bại";
  }
}
