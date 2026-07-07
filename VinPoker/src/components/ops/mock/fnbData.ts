// DỮ LIỆU MẪU (mock) for the mobileOpsV2 F&B screens (F1/F2 + P3/P4/P5 + R4/R5). NO Supabase / RPC.
// Fictional menu, orders, prices only. Real-data wiring is a separate owner-gated step.
// Money doctrine: mọi số là "Tạm tính" trong ca; xác nhận thu tiền phải nhắc lại số.

export type PayMethod = "cash" | "bank";
export type OrderStatus = "pending" | "kitchen" | "paid";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  cat: string;
}

export interface FnbOrder {
  id: string;          // "#1042"
  table: string;       // "Bàn 5" | "Mang về"
  who?: string;        // tên khách nếu có
  items: { name: string; qty: number }[];
  total: number;
  status: OrderStatus;
  method?: PayMethod;  // khi đã thu
  min: number;         // phút kể từ khi tạo
  comp?: boolean;
}

export interface KitchenLine { name: string; qty: number; done: boolean }
export interface KitchenTicket { id: string; table: string; min: number; lines: KitchenLine[] }

export const FNB_CATS = ["Tất cả", "Đồ uống", "Đồ ăn", "Combo"] as const;

export const FNB_MENU: MenuItem[] = [
  { id: "m1", name: "Cà phê đen", price: 25000, cat: "Đồ uống" },
  { id: "m2", name: "Cà phê sữa", price: 30000, cat: "Đồ uống" },
  { id: "m3", name: "Trà đào", price: 35000, cat: "Đồ uống" },
  { id: "m4", name: "Nước suối", price: 15000, cat: "Đồ uống" },
  { id: "m5", name: "Red Bull", price: 25000, cat: "Đồ uống" },
  { id: "m6", name: "Mì xào bò", price: 65000, cat: "Đồ ăn" },
  { id: "m7", name: "Cơm gà", price: 60000, cat: "Đồ ăn" },
  { id: "m8", name: "Khoai tây chiên", price: 40000, cat: "Đồ ăn" },
  { id: "m9", name: "Bánh mì", price: 30000, cat: "Đồ ăn" },
  { id: "m10", name: "Combo đêm", price: 120000, cat: "Combo" },
];

export const FNB_ORDERS: FnbOrder[] = [
  { id: "#1042", table: "Bàn 5", items: [{ name: "Cà phê sữa", qty: 2 }], total: 60000, status: "pending", min: 2 },
  { id: "#1041", table: "Bàn 3", who: "Minh", items: [{ name: "Cơm gà", qty: 1 }, { name: "Trà đào", qty: 2 }], total: 130000, status: "pending", min: 5 },
  { id: "#1040", table: "Bàn 8", items: [{ name: "Mì xào bò", qty: 1 }], total: 65000, status: "kitchen", min: 4 },
  { id: "#1039", table: "Bàn 2", items: [{ name: "Combo đêm", qty: 1 }, { name: "Nước suối", qty: 4 }], total: 180000, status: "paid", method: "cash", min: 22 },
  { id: "#1038", table: "Mang về", items: [{ name: "Bánh mì", qty: 1 }], total: 30000, status: "paid", method: "bank", min: 35 },
  { id: "#1037", table: "Bàn 7", items: [{ name: "Red Bull", qty: 2 }], total: 50000, status: "paid", method: "cash", min: 48, comp: true },
];

export const FNB_KITCHEN: KitchenTicket[] = [
  { id: "#1040", table: "Bàn 8", min: 4, lines: [{ name: "Mì xào bò", qty: 1, done: false }] },
  { id: "#1042", table: "Bàn 5", min: 2, lines: [{ name: "Cà phê sữa", qty: 2, done: false }] },
  { id: "#1041", table: "Bàn 3", min: 6, lines: [{ name: "Cơm gà", qty: 1, done: false }, { name: "Trà đào", qty: 2, done: true }] },
];

export const FNB_SHIFT = {
  openedAt: "14:00",
  cashFloat: 500000,
  cashTaken: 1240000,
  bankTaken: 860000,
  orders: 24,
  comps: 2,
  compValue: 90000,
};

export const FNB_QR_TABLES = [
  { table: "Bàn 1", active: true, scans: 12 },
  { table: "Bàn 2", active: true, scans: 4 },
  { table: "Bàn 3", active: false, scans: 0 },
  { table: "Bàn 5", active: true, scans: 7 },
  { table: "Bàn 8", active: false, scans: 0 },
];

export const FNB_STOCK = [
  { name: "Cà phê (gói)", unit: "gói", system: 40 },
  { name: "Sữa đặc (lon)", unit: "lon", system: 25 },
  { name: "Trà đào (chai)", unit: "chai", system: 18 },
  { name: "Nước suối (chai)", unit: "chai", system: 60 },
  { name: "Red Bull (lon)", unit: "lon", system: 33 },
];

export const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";
