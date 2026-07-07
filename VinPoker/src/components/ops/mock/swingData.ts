// DỮ LIỆU MẪU (mock) for the mobileOpsV2 Dealer Swing screens (D1–D6 + P1/P2). NO Supabase / RPC.
// Fictional names + example times only. Real-data wiring is a separate owner-gated step.

export interface SwingTable {
  tableNo: number;
  dealer: string | null;
  since: string;        // "13:40"
  remainMin: number;    // minutes to next swing; negative = OT
  next?: string;        // preassigned next dealer
  missing?: boolean;
}

export interface SwingDealer {
  name: string;
  state: "active" | "ready" | "rest" | "preassign" | "missing" | "pending";
  info: string;
  table?: number | null;
  restReady?: boolean;  // đã nghỉ đủ 15 phút
}

export const SWING_TABLES: SwingTable[] = [
  { tableNo: 9, dealer: "Hoa", since: "12:55", remainMin: -5, next: "Vy", missing: false },
  { tableNo: 12, dealer: null, since: "—", remainMin: 0, missing: true },
  { tableNo: 8, dealer: "Tú", since: "13:12", remainMin: 3 },
  { tableNo: 7, dealer: "Minh", since: "13:40", remainMin: 12 },
  { tableNo: 10, dealer: "Lan", since: "13:20", remainMin: 22, next: "Vy" },
  { tableNo: 11, dealer: "Trang", since: "13:30", remainMin: 28 },
];

export const SWING_DEALERS: SwingDealer[] = [
  { name: "Hoa", state: "active", info: "hôm nay 5h40 · nghỉ 2 lần", table: 9 },
  { name: "Minh", state: "active", info: "hôm nay 4h10 · bàn 7 · còn 12:30", table: 7 },
  { name: "Vy", state: "ready", info: "nghỉ từ 13:48 · đủ 15 phút", table: null, restReady: true },
  { name: "Đạt", state: "ready", info: "nghỉ từ 13:40 · đủ 15 phút", table: null, restReady: true },
  { name: "Lan", state: "rest", info: "nghỉ từ 14:02 · còn 8 phút", table: null, restReady: false },
  { name: "Vy2", state: "preassign", info: "chờ vào bàn 10", table: 10 },
  { name: "Sơn", state: "pending", info: "xin nghỉ ưu tiên 13:55", table: null },
];

export const SWING_STAFF = {
  need: 14,          // theo nhịp xoay ca
  have: 15,
  surplus: 1,
  suggestRelease: "Lan",
  suggestReason: "làm nhiều nhất hôm nay (6h10)",
  pendingLeave: 1,
  checkedInToday: 15,
};

export const SWING_CHECKIN_LIST = [
  { name: "Quang", note: "ca 14:00–22:00 theo lịch", scheduled: true },
  { name: "Hằng", note: "ca 14:00–22:00 theo lịch", scheduled: true },
  { name: "Tùng", note: "ngoài lịch hôm nay", scheduled: false },
];

export const SWING_CHECKOUT_LIST = [
  { name: "Lan", hours: "6h10", checked: true },
  { name: "Đạt", hours: "4h40", checked: true },
  { name: "Vy", hours: "4h05", checked: false },
  { name: "Sơn", hours: "3h20", checked: false },
];

export const BREAK_PRESETS = [15, 30, 45, 60];
