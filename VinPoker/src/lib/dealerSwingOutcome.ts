export type DealerSwingUiOutcome =
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
  | { kind: "unknown"; message: string };

export function classifyManualSwingOutcome(result: unknown): DealerSwingUiOutcome {
  const row = typeof result === "object" && result !== null
    ? result as { outcome?: unknown; message?: unknown }
    : {};
  const outcome = typeof row.outcome === "string" ? row.outcome : "";
  const serverMessage = typeof row.message === "string" ? row.message : null;

  if (["swung", "swung_to_break", "swung_to_pool"].includes(outcome)) {
    return { kind: "success", message: "Swing thành công!" };
  }
  if (["race_lost", "version_conflict", "already_in_transition"].includes(outcome)) {
    return { kind: "warning", message: "Bàn này vừa được xử lý bởi người khác. Đang cập nhật..." };
  }
  if (["no_dealer", "no_dealer_available"].includes(outcome)) {
    return { kind: "warning", message: "Không đủ dealer khả dụng để thay thế." };
  }
  if (["not_found", "state_mismatch"].includes(outcome)) {
    return { kind: "warning", message: "Assignment không còn hiệu lực. Đang cập nhật..." };
  }
  if (outcome === "enforce_next_swing") {
    return { kind: "info", message: serverMessage ?? "Dealer tiếp theo cần nghỉ sớm, sẽ swing tiếp." };
  }
  if (outcome === "error") {
    return { kind: "error", message: `Lỗi: ${serverMessage ?? "Unknown"}` };
  }
  return {
    kind: "unknown",
    message: "Chưa xác định được kết quả swing. Đang tải lại trạng thái từ máy chủ...",
  };
}

export function classifyProcessSwingResult(result: unknown): DealerSwingUiOutcome {
  const row = typeof result === "object" && result !== null
    ? result as { status?: unknown; error_code?: unknown; processed_count?: unknown }
    : {};
  const status = typeof row.status === "string" ? row.status : "";
  if (status === "completed") {
    const count = typeof row.processed_count === "number" && Number.isFinite(row.processed_count)
      ? row.processed_count
      : 0;
    return { kind: "success", message: `Đã xử lý ${count} swing` };
  }
  if (["partial", "locked", "dependency_unavailable", "business_failed"].includes(status)) {
    return {
      kind: status === "locked" ? "warning" : "error",
      message: "Đợt swing chưa hoàn tất. Đã tải lại trạng thái để kiểm tra.",
    };
  }
  return {
    kind: "unknown",
    message: "Chưa xác định được kết quả xử lý. Đã tải lại trạng thái từ máy chủ.",
  };
}
