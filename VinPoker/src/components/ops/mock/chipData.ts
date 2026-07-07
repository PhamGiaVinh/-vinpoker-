// DỮ LIỆU MẪU (mock) for the mobileOpsV2 Chip Ops screens (C1/C2 + R2/R3). NO Supabase / RPC.
// Chip inventory & money edits stay desktop — mobile C2 is VIEW-ONLY + cảnh báo lệch.
// R2 color-up (money) restates before confirm; R3 bag ops confirm before write.

export interface Denom {
  value: number;        // mệnh giá
  color: string;        // tailwind text/border hint
  inPlay: number;       // số chip đang trên bàn
  vault: number;        // số chip trong két
}

export interface StackTemplate { name: string; chips: number; stack: string }

export const CHIP_SET = {
  name: "Bộ chip giải chính",
  boundTo: "Sunday Major · Bàn 1–12",
};

export const CHIP_DENOMS: Denom[] = [
  { value: 25, color: "text-emerald-300", inPlay: 620, vault: 380 },
  { value: 100, color: "text-sky-300", inPlay: 540, vault: 460 },
  { value: 500, color: "text-fuchsia-300", inPlay: 300, vault: 700 },
  { value: 1000, color: "text-amber-300", inPlay: 210, vault: 790 },
  { value: 5000, color: "text-rose-300", inPlay: 90, vault: 410 },
  { value: 25000, color: "text-[#d8bc85]", inPlay: 24, vault: 176 },
];

export const CHIP_TEMPLATES: StackTemplate[] = [
  { name: "Starting 30k", chips: 18, stack: "30.000" },
  { name: "Re-entry 30k", chips: 18, stack: "30.000" },
  { name: "Turbo 20k", chips: 12, stack: "20.000" },
];

// C2 — kho/két: mỗi mệnh giá số hệ thống vs đếm thực → lệch (money = chỉ xem trên mobile)
export const CHIP_VAULT_AUDIT = [
  { value: 25, system: 1000, counted: 1000 },
  { value: 100, system: 1000, counted: 998 },   // lệch -2
  { value: 500, system: 1000, counted: 1000 },
  { value: 1000, system: 1000, counted: 1003 }, // lệch +3
  { value: 5000, system: 500, counted: 500 },
  { value: 25000, system: 200, counted: 200 },
];

// R2 — color-up: rút mệnh giá nhỏ, race lên mệnh giá lớn
export const COLORUP_HISTORY = [
  { id: "cu3", from: 25, to: 100, at: "22:10", chips: 620 },
  { id: "cu2", from: 100, to: 500, at: "23:40", chips: 480 },
];

// R3 — đóng bao chip (bag & tag) cuối ngày
export interface BagRow { player: string; seat: string; total: number; code: string; sealed: boolean }
export const BAG_DAYS = ["Ngày 1 (hôm nay)", "Ngày 1 (hôm qua)"];
export const BAG_ROWS: BagRow[] = [
  { player: "Minh", seat: "B3-4", total: 128000, code: "A-014", sealed: true },
  { player: "Lan", seat: "B5-2", total: 96000, code: "A-015", sealed: true },
  { player: "Tú", seat: "B8-7", total: 210000, code: "", sealed: false },
  { player: "Trang", seat: "B7-1", total: 54000, code: "", sealed: false },
];

export const chipFmt = (n: number) => n.toLocaleString("vi-VN");
