const FLOOR_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  actor_not_allowed: "Tài khoản chưa có quyền Floor/Cashier cho CLB này.",
  tournament_not_found: "Không tìm thấy giải đấu.",
  tournament_not_open: "Giải đã đóng hoặc đã huỷ.",
  tournament_completed: "Giải đã kết thúc. Không thể tiếp tục thao tác Floor.",
  tournament_already_closed: "Giải đã chốt. Không thể tự sửa lại kết quả.",
  active_players_remaining: "Vẫn còn người đang ngồi. Hãy loại/chuyển hết người chơi trước khi chốt giải.",
  orphan_active_seat: "Có ghế đang hoạt động nhưng thiếu lượt vào. Hệ thống đã dừng để tránh mất dữ liệu.",
  seat_entry_mismatch: "Ghế và lượt vào không khớp. Hệ thống đã dừng để tránh chuyển nhầm người.",
  seat_table_mismatch: "Ghế không thuộc đúng bàn của giải. Cần kiểm tra dữ liệu trước khi tiếp tục.",
  no_active_seat: "Không tìm thấy ghế đang hoạt động đúng với lượt vào này.",
  seat_occupied: "Ghế vừa có người ngồi. Hãy chọn ghế khác.",
  invalid_destination_table: "Bàn đích không hợp lệ hoặc đã đóng.",
  invalid_seat_number: "Số ghế không hợp lệ.",
  insufficient_capacity: "Không đủ ghế trống. Mở thêm bàn rồi thử lại.",
  entry_not_busted: "Người này không còn ở trạng thái bị loại.",
  busted_seat_not_found: "Không tìm thấy ghế cũ để khôi phục đúng chip. Hệ thống không tự đoán.",
  already_active: "Người này đã có ghế đang hoạt động.",
  prize_already_paid: "Thưởng đã được chi. Cần xử lý payout theo quy trình riêng.",
  stale_seat_state: "Dữ liệu ghế vừa thay đổi. Hãy tải lại trước khi thao tác tiếp.",
  player_has_chips: "Người chơi vẫn còn chip. Chỉ được loại khi chip đã về 0.",
  player_in_active_hand: "Người chơi đang ở một ván chưa kết thúc. Hãy chốt ván trước khi loại.",
  entry_not_seated: "Lượt vào không còn ở trạng thái đang ngồi. Hãy tải lại dữ liệu.",
  already_busted: "Người chơi vừa được loại ở thao tác khác. Hãy tải lại dữ liệu.",
  stale_clock_state: "Đồng hồ vừa thay đổi ở thao tác khác. Hãy tải lại trước khi thử lại.",
  clock_already_started: "Đồng hồ đã được bắt đầu ở thao tác khác.",
};

export function floorOpsResponseErrorCode(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const error = (data as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

export function floorOpsErrorMessage(code: string | null | undefined, fallback = "Thao tác thất bại"): string {
  if (!code) return fallback;
  return FLOOR_ERROR_MESSAGES[code] ?? fallback;
}
