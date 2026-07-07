// DỮ LIỆU MẪU (mock) for the mobileOpsV2 Cashier screens (Q1–Q6). NO Supabase / RPC.
// Money-in module: mọi nút 💰 (buy-in, re-entry, xác nhận SePay, FUNDED, hoàn tiền) NHẮC LẠI SỐ trước khi ghi.
// Chi tiết/lịch sử/xuất staking = máy tính. Cấp lại thẻ = đã build (PR #725, bản máy tính).

export const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";

export type RegStatus = "waiting" | "confirmed" | "seated";
export interface RegRow {
  name: string;
  phone: string;        // đã che bớt
  status: RegStatus;
  buyin: number;
  method: "cash" | "bank";
  table?: string;       // khi seated
  seat?: number;
}

export const REG_QUEUE: RegRow[] = [
  { name: "Nguyễn Minh", phone: "09••••234", status: "waiting", buyin: 1_100_000, method: "cash" },
  { name: "Trần Lan", phone: "03••••567", status: "waiting", buyin: 1_100_000, method: "bank" },
  { name: "Lê Tú", phone: "07••••890", status: "confirmed", buyin: 1_100_000, method: "cash" },
  { name: "Phạm Trang", phone: "09••••112", status: "seated", buyin: 1_100_000, method: "bank", table: "Bàn 5", seat: 3 },
  { name: "Đỗ Sơn", phone: "08••••334", status: "seated", buyin: 1_100_000, method: "cash", table: "Bàn 3", seat: 7 },
];

export const REG_STATUS_META: Record<RegStatus, { label: string; cls: string }> = {
  waiting: { label: "Chờ xếp", cls: "bg-amber-400/12 text-amber-300" },
  confirmed: { label: "Đã thu", cls: "bg-sky-400/12 text-sky-300" },
  seated: { label: "Đã xếp chỗ", cls: "bg-emerald-400/12 text-emerald-300" },
};

export const CANCEL_REASONS = ["Khách đổi ý", "Trùng đăng ký", "Sai thông tin", "Lý do khác…"];

// Q3 — buy-in
export const BUYIN_TOURNAMENTS = [
  { id: "t1", name: "Sunday Major 20:00", buyin: 1_000_000, fee: 100_000 },
  { id: "t2", name: "Daily Turbo 22:00", buyin: 500_000, fee: 50_000 },
];

// Q4 — SePay settlement (chuyển khoản chờ khớp buy-in)
export interface SePayRow {
  id: string;
  amount: number;
  memo: string;         // nội dung CK
  at: string;
  match?: string;       // người khớp (nếu đoán được)
  done: boolean;
}
export const SEPAY_ROWS: SePayRow[] = [
  { id: "s1", amount: 1_100_000, memo: "MINH SUNDAY", at: "19:42", match: "Nguyễn Minh", done: false },
  { id: "s2", amount: 1_100_000, memo: "TRAN LAN BUYIN", at: "19:45", match: "Trần Lan", done: false },
  { id: "s3", amount: 550_000, memo: "chuyen tien", at: "19:48", done: false },  // không rõ → cần xử lý tay
  { id: "s4", amount: 1_100_000, memo: "TU MAJOR", at: "19:20", match: "Lê Tú", done: true },
];

// Q5 — staking (chỉ nút gấp: xác nhận FUNDED, hoàn tiền; chi tiết = máy tính)
export interface StakeRow { backer: string; player: string; amount: number; pct: number; status: "pending" | "funded" }
export const STAKE_ROWS: StakeRow[] = [
  { backer: "Anh Hùng", player: "Nguyễn Minh", amount: 550_000, pct: 50, status: "pending" },
  { backer: "Chị Mai", player: "Lê Tú", amount: 330_000, pct: 30, status: "pending" },
  { backer: "Anh Dũng", player: "Trần Lan", amount: 770_000, pct: 70, status: "funded" },
];

// Q6 — member verification
export interface VerifyRow { name: string; phone: string; note: string; submitted: string }
export const VERIFY_ROWS: VerifyRow[] = [
  { name: "Vũ Hải", phone: "09••••556", note: "ảnh CCCD + selfie", submitted: "18:30" },
  { name: "Ngô Yến", phone: "03••••778", note: "ảnh CCCD + selfie", submitted: "18:52" },
];
