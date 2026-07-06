// DỮ LIỆU MẪU (mock) for the mobileOpsV2 screens. NO Supabase / RPC / network.
// Fictional names + example amounts only. Real-data wiring is a separate owner-gated step.
import type { OpStatus } from "../shared/OperationStatusChip";

export interface MockTable {
  tableNo: number;
  status: "running" | "open" | "paused" | "closed";
  occ: number;
  max: number;
  dealer: string | null;
  needsFloor?: boolean;
}

export interface MockSeat {
  seat: number;
  name: string | null;
  chip: string | null;
  entryNo?: number;
}

export interface MockOpAlert {
  id: string;
  icon: string;
  subject: string;
  status: OpStatus;
  detail: string;
}

export interface MockFinLine {
  label: string;
  value: string;
  state: "provisional" | "final";
  note?: string;
  passThrough?: boolean;
  bad?: boolean;
}

export interface MockDealer {
  table: number | null;
  name: string | null;
  state: "active" | "rest" | "preassign" | "missing";
  info: string;
}

// ── Giải đấu (A1 list + cockpit) ──────────────────────────────────────────────
export interface MockTournamentRow {
  id: string;
  name: string;
  time: string;
  buyIn: string;
  status: "running" | "late" | "upcoming" | "closed";
  statusLabel: string;
  entries?: string;
  level?: number;
  blinds?: string;
}

export const MOCK_TOURNAMENT_LIST: MockTournamentRow[] = [
  { id: "t1", name: "HSOP Main Event", time: "18:00", buyIn: "5tr", status: "running", statusLabel: "Đang chơi", entries: "84/210", level: 12, blinds: "5.000/10.000" },
  { id: "t2", name: "Test", time: "19:10", buyIn: "3,3tr", status: "running", statusLabel: "Đang chơi", entries: "0", level: 1, blinds: "500/1.000" },
  { id: "t3", name: "Daily Turbo", time: "21:00", buyIn: "1tr", status: "upcoming", statusLabel: "Sắp mở" },
  { id: "t4", name: "Deepstack 05/07", time: "14:00", buyIn: "3tr", status: "closed", statusLabel: "Đã chốt", entries: "156" },
];

export const MOCK_TOURNAMENT = {
  name: "HSOP Main Event",
  status: "Đang chạy",
  level: 12,
  blinds: "5.000/10.000",
  ante: "10.000",
  remaining: 84,
  total: 210,
  avgStack: "42.000",
  timeToBreak: "14:32",
  prizePool: "693.000.000 đ",
  entries: 231,
};

// ── Sơ đồ bàn (B1 whole-room grid) ────────────────────────────────────────────
export const MOCK_TABLES: MockTable[] = [
  { tableNo: 7, status: "running", occ: 9, max: 9, dealer: "Minh", needsFloor: true },
  { tableNo: 8, status: "running", occ: 6, max: 9, dealer: null },
  { tableNo: 9, status: "running", occ: 8, max: 9, dealer: "Hoa" },
  { tableNo: 10, status: "running", occ: 7, max: 9, dealer: "Tú" },
  { tableNo: 11, status: "running", occ: 9, max: 9, dealer: "Trang" },
  { tableNo: 12, status: "paused", occ: 5, max: 9, dealer: "Lan" },
  { tableNo: 14, status: "running", occ: 8, max: 9, dealer: "Quang" },
  { tableNo: 15, status: "running", occ: 9, max: 9, dealer: "Hằng" },
  { tableNo: 16, status: "running", occ: 7, max: 9, dealer: "Đạt" },
  { tableNo: 18, status: "running", occ: 6, max: 9, dealer: "Vy" },
  { tableNo: 19, status: "open", occ: 0, max: 9, dealer: null },
  { tableNo: 20, status: "open", occ: 0, max: 9, dealer: null },
];

export const MOCK_SEATS: MockSeat[] = [
  { seat: 1, name: "Nguyễn Văn A", chip: "38.000", entryNo: 1 },
  { seat: 2, name: "Trần Thị B", chip: "52.000", entryNo: 1 },
  { seat: 3, name: null, chip: null },
  { seat: 4, name: "Lê Văn C", chip: "21.000", entryNo: 2 },
  { seat: 5, name: "Phạm Văn D", chip: "64.000", entryNo: 1 },
  { seat: 6, name: null, chip: null },
  { seat: 7, name: "Võ Thị E", chip: "45.500", entryNo: 1 },
  { seat: 8, name: "Đinh Văn F", chip: "12.000", entryNo: 1 },
  { seat: 9, name: "Bùi Thị G", chip: "88.000", entryNo: 1 },
];

// ── Hàng chờ (N4 thêm người) ──────────────────────────────────────────────────
export const MOCK_WAITLIST = [
  { name: "Đỗ Văn G", ref: "#REG-081", note: "đã thu buy-in · tiền mặt" },
  { name: "Mai Thị H", ref: "#REG-082", note: "re-entry · chuyển khoản" },
];

// ── Levels (S4) ───────────────────────────────────────────────────────────────
export interface MockLevel {
  label: string;
  minutes: number;
  sb?: string;
  bb?: string;
  ante?: string;
  isBreak?: boolean;
  current?: boolean;
}

export const MOCK_LEVELS: MockLevel[] = [
  { label: "11", minutes: 40, sb: "4k", bb: "8k", ante: "8k" },
  { label: "12", minutes: 40, sb: "5k", bb: "10k", ante: "10k", current: true },
  { label: "13", minutes: 40, sb: "6k", bb: "12k", ante: "12k" },
  { label: "Nghỉ", minutes: 15, isBreak: true },
  { label: "14", minutes: 40, sb: "8k", bb: "16k", ante: "16k" },
  { label: "15", minutes: 40, sb: "10k", bb: "20k", ante: "20k" },
  { label: "16", minutes: 40, sb: "15k", bb: "30k", ante: "30k" },
];

// ── Trả thưởng (S5) ───────────────────────────────────────────────────────────
export const MOCK_PAYOUTS = [
  { rank: "Hạng 1", amount: "180.000.000", top: true },
  { rank: "Hạng 2", amount: "120.000.000", top: true },
  { rank: "Hạng 3", amount: "82.000.000" },
  { rank: "Hạng 4–5", amount: "45.000.000" },
  { rank: "Hạng 6–9", amount: "24.000.000" },
  { rank: "Hạng 10–18", amount: "12.000.000", muted: true },
  { rank: "Hạng 19–27", amount: "8.000.000", muted: true },
];

// ── Lịch sử (S6) ─────────────────────────────────────────────────────────────
export const MOCK_HISTORY = [
  { icon: "out", text: "Loại Võ Thị E — hạng 92", sub: "Bàn 9 · bởi floor Minh", time: "14:02" },
  { icon: "move", text: "Chuyển Lê Văn C 7→9", sub: "cân bàn", time: "13:48" },
  { icon: "level", text: "Lên level 12", sub: "tự động", time: "13:40" },
  { icon: "chip", text: "Sửa chip Phạm D 10k→12k", sub: "đếm lại · cashier Lan", time: "13:22" },
  { icon: "open", text: "Mở bàn 10", sub: "floor Minh", time: "13:05" },
];

// ── Cảnh báo / tài chính / dealer / người chơi (screens khác, giữ nguyên) ────
export const MOCK_TABLE_COUNTS = { running: 9, open: 2, paused: 1, closed: 0 };

export const MOCK_OP_ALERTS: MockOpAlert[] = [
  { id: "o1", icon: "⚠", subject: "Bàn 7 cần bốc lại", status: "todo", detail: "Đã vào final table (9→8)" },
  { id: "o2", icon: "⚠", subject: "Bàn 12 · thiếu dealer", status: "late", detail: "Chờ phân dealer 6 phút" },
  { id: "o3", icon: "•", subject: "Ghế 3/Bàn 5 · late reg", status: "todo", detail: "Khách chờ xếp ghế" },
];

export const MOCK_FIN_LINES: MockFinLine[] = [
  { label: "Còn lại sau lương", value: "12.400.000 đ", state: "provisional", note: "chưa trừ CP vận hành" },
  { label: "Tiền chuyển hộ (prize/ký quỹ)", value: "210.000.000 đ", state: "provisional", passThrough: true },
  { label: "Lệch đối soát quầy", value: "−350.000 đ", state: "provisional", note: "cần giải trình", bad: true },
];

export const MOCK_TOURNAMENTS = [
  { name: "HSOP Main Event", status: "Đang chạy", level: 12, blinds: "5.000/10.000", remaining: 84, total: 210 },
  { name: "Daily Turbo 18h", status: "Late reg", level: 4, blinds: "500/1.000", remaining: 46, total: 52 },
  { name: "Deepstack 21h", status: "Sắp tới", level: 0, blinds: "—", remaining: 0, total: 0 },
];

export const MOCK_DEALERS: MockDealer[] = [
  { table: 7, name: "Minh", state: "active", info: "Vào 13:00 · 1h20m" },
  { table: 12, name: null, state: "missing", info: "Chờ phân dealer" },
  { table: null, name: "Lan", state: "rest", info: "Nghỉ 14:05 · còn 8m" },
  { table: 9, name: "Hoa", state: "active", info: "Vào 13:10 · 1h10m" },
];

export const MOCK_PLAYERS = [
  { name: "Nguyễn Văn A", phone: "090•••••23", status: "Đang chơi", place: "Bàn 7 · Ghế 1", entry: "#1 · 13:20" },
  { name: "Trần Thị B", phone: "091•••••88", status: "Đang chơi", place: "Bàn 7 · Ghế 2", entry: "#1 · 13:05" },
  { name: "Lê Văn C", phone: "098•••••11", status: "Đang chơi", place: "Bàn 7 · Ghế 4", entry: "#2 · 12:40" },
  { name: "Võ Thị E", phone: "097•••••55", status: "Đã loại", place: "Hạng 92 · out 14:02", entry: "#1 · 12:10" },
];
