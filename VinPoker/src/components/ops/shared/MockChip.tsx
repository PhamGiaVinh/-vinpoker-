// Chip "DỮ LIỆU MẪU" theo TỪNG trang (thay chip toàn cục cũ ở OpsShell): chỉ đặt trên
// trang /ops mà nội dung CHÍNH còn là fixture mock. Trang dữ liệu thật (Hôm nay, cockpit,
// Bàn, Cashier, Dealer Swing) KHÔNG được gắn — chip toàn cục cũ làm operator hoặc nghi ngờ
// thao tác thật ("chỉ là mẫu") hoặc quen bỏ qua cảnh báo.
export function MockChip() {
  return (
    <span className="shrink-0 rounded-full bg-[#00ff88]/12 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#63ffb5]">
      DỮ LIỆU MẪU
    </span>
  );
}
