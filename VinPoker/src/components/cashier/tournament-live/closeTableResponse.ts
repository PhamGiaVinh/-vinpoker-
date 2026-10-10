export interface CloseTableMove {
  entry_id?: string;
  player_name: string;
  from_seat: number;
  to_table_number: number | null;
  to_seat_number: number;
  receipt_code: string;
}

export interface CloseTableResponse {
  ok?: boolean;
  closed?: boolean;
  already_closed?: boolean;
  error?: string;
  hand_id?: string;
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

export type CanonicalCloseResult =
  | { kind: "closed" | "pending"; movedCount: number; pendingCount: number }
  | { kind: "error"; code: string };

/** Printable tickets must be server-issued and match the immediate preview. */
export function parseCanonicalBreakTickets(value: unknown, expected: {
  entryId: string; sourceSeatNumber: number; destinationTableNumber: number;
  destinationSeatNumber: number; transferMode: "immediate" | "after_current_hand";
}[]): CloseTableMove[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tickets = (value as Record<string, unknown>).issued_tickets;
  const immediate = expected.filter((move) => move.transferMode === "immediate");
  if (!Array.isArray(tickets) || tickets.length !== immediate.length) return null;
  const entries = new Set<string>();
  const codes = new Set<string>();
  const result: CloseTableMove[] = [];
  for (const ticket of tickets) {
    if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) return null;
    const row = ticket as Record<string, unknown>;
    const match = immediate.find((move) => move.entryId === row.entry_id);
    if (!match || entries.has(match.entryId) || typeof row.receipt_code !== "string" || !row.receipt_code.trim()
      || codes.has(row.receipt_code) || typeof row.player_name !== "string" || !row.player_name.trim()
      || row.from_seat !== match.sourceSeatNumber || row.to_table_number !== match.destinationTableNumber
      || row.to_seat_number !== match.destinationSeatNumber) return null;
    entries.add(match.entryId);
    codes.add(row.receipt_code);
    result.push({ entry_id: match.entryId, player_name: row.player_name, from_seat: match.sourceSeatNumber,
      to_table_number: match.destinationTableNumber, to_seat_number: match.destinationSeatNumber,
      receipt_code: row.receipt_code });
  }
  return result;
}

/** Canonical close/break receipts do not contain legacy seat-ticket arrays.
 * Scope and count checks prevent a deferred break or another session's reply
 * from being displayed as a completed close. Never manufacture a ticket.
 */
export function parseCanonicalCloseResult(value: unknown, scope: {
  tournamentTableId: string; tableSessionId: string; activeSeatCount: number;
}): CanonicalCloseResult {
  const invalid = { kind: "error", code: "invalid_response" } as const;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  const row = value as Record<string, unknown>;
  if (row.ok === false && typeof row.error === "string") return { kind: "error", code: row.error };
  if (row.ok !== true || row.tournament_table_id !== scope.tournamentTableId
    || row.table_session_id !== scope.tableSessionId) return invalid;
  if (!Number.isSafeInteger(scope.activeSeatCount) || scope.activeSeatCount < 0) return invalid;
  const moved = row.moved_count ?? (scope.activeSeatCount === 0 ? 0 : undefined);
  const pending = row.pending_count ?? (scope.activeSeatCount === 0 ? 0 : undefined);
  if (typeof moved !== "number" || !Number.isSafeInteger(moved) || moved < 0
    || typeof pending !== "number" || !Number.isSafeInteger(pending) || pending < 0
    || moved + pending !== scope.activeSeatCount) return invalid;
  if (row.closed === true && row.break_pending !== true && pending === 0) {
    return { kind: "closed", movedCount: moved, pendingCount: pending };
  }
  if (row.closed === false && row.break_pending === true && pending > 0) {
    return { kind: "pending", movedCount: moved, pendingCount: pending };
  }
  return invalid;
}

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
  if (!Array.isArray(response.moved)) {
    return { kind: "error", response, code: "invalid_response" };
  }

  // The legacy empty-table branch confirms `closed: true` with `moved: []`,
  // but omits `moved_count`. Normalize that one unambiguous shape only: a
  // populated source still needs a complete, server-issued move receipt.
  const movedCount = response.moved_count === undefined
    && sourceActiveSeats === 0
    && response.moved.length === 0
    ? 0
    : response.moved_count;
  if (typeof movedCount !== "number" || !Number.isInteger(movedCount) || movedCount < 0) {
    return { kind: "error", response, code: "invalid_response" };
  }
  if (response.moved.length !== movedCount) {
    return { kind: "error", response, code: "invalid_response" };
  }
  if (response.already_closed === true && movedCount !== 0) {
    return { kind: "error", response, code: "invalid_response" };
  }
  if (sourceActiveSeats > 0 && movedCount === 0 && response.already_closed !== true) {
    return { kind: "error", response, code: "unexpected_zero_moves" };
  }
  if (
    sourceActiveSeats > 0
    && response.already_closed !== true
    && movedCount !== sourceActiveSeats
  ) {
    return { kind: "error", response, code: "move_count_mismatch" };
  }

  return {
    kind: "success",
    response: {
      ...response,
      moved_count: movedCount,
      moved: response.moved,
    } as Required<Pick<CloseTableResponse, "moved_count" | "moved">> & CloseTableResponse,
  };
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
    case "seat_entry_mismatch":
      return "Ghế và entry không khớp. Không có dữ liệu nào bị thay đổi.";
    case "table_has_active_hand":
      return "Bàn đang có hand hoạt động. Hãy hoàn tất hoặc xử lý hand trước khi đóng bàn.";
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
