// DỮ LIỆU MẪU (mock) for the mobileOpsV2 Bàn / Cảnh báo / Giải đấu / Thêm screens. NO Supabase / RPC.
// Fictional names + example amounts only. Nothing here reaches production while FEATURES.mobileOpsV2 is OFF.
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

export const MOCK_TABLES: MockTable[] = [
  { tableNo: 7, status: "running", occ: 9, max: 9, dealer: "Minh", needsFloor: true },
  { tableNo: 8, status: "running", occ: 6, max: 9, dealer: null, needsFloor: true },
  { tableNo: 9, status: "running", occ: 8, max: 9, dealer: "Hoa" },
  { tableNo: 10, status: "running", occ: 7, max: 9, dealer: "Tú" },
  { tableNo: 11, status: "open", occ: 0, max: 9, dealer: null },
  { tableNo: 12, status: "paused", occ: 5, max: 9, dealer: "Lan" },
];

export const MOCK_SEATS: MockSeat[] = [
  { seat: 1, name: "Nguyễn Văn A", chip: "38.000", entryNo: 1 },
  { seat: 2, name: "Trần Thị B", chip: "52.000", entryNo: 1 },
  { seat: 3, name: null, chip: null },
  { seat: 4, name: "Lê Văn C", chip: "21.000", entryNo: 2 },
  { seat: 5, name: "Phạm Văn D", chip: "64.000", entryNo: 1 },
  { seat: 6, name: null, chip: null },
];

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
  { name: "Nguyễn Văn A", phone: "090•••••23", status: "Đang chơi", place: "Bàn 7 · Ghế 4", entry: "#1 · 13:20" },
  { name: "Trần Thị B", phone: "091•••••88", status: "Đang chơi", place: "Bàn 8 · Ghế 2", entry: "#1 · 13:05" },
  { name: "Lê Văn C", phone: "098•••••11", status: "Đã loại", place: "Hạng 92 · out 14:02", entry: "#2 · 12:40" },
];
