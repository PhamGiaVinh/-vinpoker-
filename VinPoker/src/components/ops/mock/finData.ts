// DỮ LIỆU MẪU (mock) for the mobileOpsV2 finance/accounting/series VIEW screens
// (T1/T2 Tài chính · AC1/AC2 Tài chính & Đối soát · SI1/SI2 Trí tuệ Series). NO Supabase / RPC.
//
// DOCTRINE (kế toán quản trị — vinpoker-business-quant):
//  · Doanh thu giữ lại (phí) ≠ Tiền qua tay (prize pool = tiền người chơi, KHÔNG phải doanh thu).
//  · Bù đắp GTD hiện thành 1 dòng riêng. Chi phí trực tiếp liệt kê từng dòng.
//  · "Biên đóng góp (chưa trừ vận hành chung)" — KHÔNG gọi "lợi nhuận".
//  · Badge: Tạm tính (mở) / Đã chốt (đóng) / Dự báo (khoảng, không phải điểm).
//  · Read-only trên điện thoại — không nút chuyển tiền. Lọc sâu / xuất / cockpit đầy đủ = máy tính.

export const vnd = (n: number) => (n < 0 ? "−" : "") + Math.abs(n).toLocaleString("vi-VN") + "đ";

export type Badge = "provisional" | "final" | "forecast";
export const BADGE_META: Record<Badge, { label: string; cls: string }> = {
  provisional: { label: "Tạm tính", cls: "bg-amber-400/12 text-amber-300" },
  final: { label: "Đã chốt", cls: "bg-emerald-400/12 text-emerald-300" },
  forecast: { label: "Dự báo", cls: "bg-sky-400/12 text-sky-300" },
};

export const FIN_RANGES = ["7 ngày", "30 ngày", "Tháng này"] as const;

// T1 — tổng quan kỳ (Tháng này). Doanh thu giữ lại tách khỏi tiền qua tay.
export const FIN_SUMMARY = {
  retainedFee: 84_600_000,      // doanh thu giữ lại (phí/rake + service fee)
  passThrough: 946_000_000,     // tiền giải thưởng người chơi — pass-through (liability)
  costs: [
    { label: "Lương dealer", value: -31_200_000 },
    { label: "Lương floor", value: -9_800_000 },
    { label: "Lương thu ngân", value: -7_400_000 },
    { label: "Chi phí marketing", value: -5_100_000 },
    { label: "Giá vốn F&B tặng kèm", value: -2_300_000 },
    { label: "Bù đắp đảm bảo GTD", value: -6_000_000 },
  ],
  fnbEnabled: false,            // fnb* flags OFF → hiện "chưa bật", KHÔNG hiện 0đ như thật
};

// T2 — theo giải. Mỗi giải: doanh thu giữ lại, bù GTD, biên đóng góp, hòa vốn.
export interface EventPnl {
  name: string;
  date: string;
  entries: number;
  breakeven: number;   // cần bao nhiêu entries để hòa vốn
  retained: number;
  gtdSubsidy: number;  // 0 nếu phủ đủ
  contribution: number;
  badge: Badge;
}
export const FIN_EVENTS: EventPnl[] = [
  { name: "Sunday Major", date: "CN 06/07", entries: 92, breakeven: 104, retained: 20_240_000, gtdSubsidy: -6_000_000, contribution: 3_180_000, badge: "provisional" },
  { name: "Daily Turbo", date: "T7 05/07", entries: 48, breakeven: 40, retained: 5_280_000, gtdSubsidy: 0, contribution: 2_140_000, badge: "final" },
  { name: "Deep Stack", date: "T6 04/07", entries: 63, breakeven: 55, retained: 9_450_000, gtdSubsidy: 0, contribution: 4_020_000, badge: "final" },
];

// AC1/AC2 — đối soát: quỹ kỳ vọng vs thực tế → chênh lệch.
export interface Variance { label: string; expected: number; actual: number; note?: string }
export const FIN_VARIANCE: Variance[] = [
  { label: "Tiền mặt két (quầy)", expected: 42_500_000, actual: 42_500_000 },
  { label: "Ngân hàng (SePay) vs buy-in ghi nhận", expected: 118_900_000, actual: 118_400_000, note: "1 giao dịch chờ khớp" },
  { label: "Trả thưởng: phải trả vs đã trả", expected: 96_000_000, actual: 96_000_000 },
  { label: "Escrow giải thưởng: vào vs ra", expected: 946_000_000, actual: 946_000_000 },
  { label: "Chip đối chiếu két", expected: 0, actual: 500, note: "1.000 chip mệnh giá đếm lệch" },
];

export const FIN_RECON = {
  provisionalCount: 2,   // ngày/giải đang tạm tính
  finalCount: 5,         // đã chốt
  alerts: 2,             // số cảnh báo lệch ≠ 0
  lastClose: "05/07 06:00",
};

// SI1 — báo cáo series (dự báo là KHOẢNG, kèm baseline).
export const SI_REPORT = {
  series: "Summer Festival 2026",
  nextEvent: "Main Event — CN 13/07",
  gtd: 500_000_000,
  forecastLow: 70,
  forecastHigh: 105,
  forecastMedian: 85,
  baseline: 78,          // giải tương tự lần trước
  breakeven: 96,         // entries hòa vốn GTD
  thinHistory: false,    // nếu true → "giả thuyết / chưa đủ dữ liệu"
  overlayRiskPct: 34,    // % khả năng phải bù GTD
};

// SI2 — nhật ký quyết định (đọc + ghi quyết định; KHÔNG phải đường tiền).
export interface Decision { who: string; when: string; text: string }
export const SI_DECISIONS: Decision[] = [
  { who: "Chủ CLB", when: "01/07", text: "Giữ GTD Main Event 500tr — chấp nhận rủi ro overlay 34%." },
  { who: "TD", when: "28/06", text: "Dời Deep Stack sang thứ 6 để tránh trùng Major." },
];
export const SI_DECISION_OPTIONS = [
  "Giữ nguyên GTD",
  "Giảm GTD một bậc",
  "Tăng marketing đẩy field",
  "Ghi chú khác…",
];
