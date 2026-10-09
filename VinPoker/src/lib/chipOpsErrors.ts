/** Transport errors must not be presented as missing Color-up deployment. */
export function chipOpsRpcErrorMessage(error: unknown): string {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (details.code === "PGRST202" || details.code === "42883") return "Chức năng chip chưa sẵn sàng trên máy chủ. Hãy tải lại hoặc báo quản trị viên.";
  if (details.code === "42501" || details.code === "PGRST301" || details.code === "PGRST302") return "Không xác minh được quyền thao tác chip. Kiểm tra phiên đăng nhập và quyền CLB.";
  return "Không kết nối được máy chủ chip. Hãy tải lại để kiểm tra dữ liệu; thao tác vừa gửi có thể đã được ghi nhận.";
}
