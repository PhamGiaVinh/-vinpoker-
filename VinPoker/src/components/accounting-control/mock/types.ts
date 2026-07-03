// Kiểu dữ liệu cho UI shell "Tài chính & Đối soát" (Accounting Control).
// Toàn bộ là MOCK/SPEC — không có kiểu nào ánh xạ bảng/RPC thật. Doctrine nguồn:
// VBacker/09-ACCOUNTING-CONTROL (tiền pass-through không bao giờ là doanh thu;
// mọi con số mang đúng một trạng thái dữ liệu; dự báo luôn là khoảng, không phải điểm).

/** Trạng thái của một con số tiền — mỗi giá trị hiển thị phải mang đúng một trạng thái. */
export type DataState = "forecast" | "provisional" | "reconciled" | "final";

export const DATA_STATE_META: Record<
  DataState,
  { label: string; badgeClass: string; description: string }
> = {
  forecast: {
    label: "Dự báo",
    badgeClass: "border-dashed border-muted-foreground/50 text-muted-foreground bg-transparent",
    description: "Dự phóng trước sự kiện — luôn là một khoảng, không bao giờ là số chắc chắn.",
  },
  provisional: {
    label: "Tạm tính",
    badgeClass: "border-amber-500/40 text-amber-400 bg-amber-500/10",
    description: "Đã có ghi nhận vận hành thật nhưng chưa đối soát/chưa chốt.",
  },
  reconciled: {
    label: "Đã đối soát",
    badgeClass: "border-[#378ADD]/40 text-[#378ADD] bg-[#378ADD]/10",
    description: "Đã khớp với nguồn tiền độc lập (bank/két) nhưng kỳ chưa đóng.",
  },
  final: {
    label: "Đã chốt",
    badgeClass: "border-primary/40 text-primary bg-primary/10",
    description: "Đã chốt qua sự kiện đóng sổ — bất biến; sửa bằng bút toán điều chỉnh.",
  },
};

/** Phân loại tiền theo MONEY_FLOW_MAP — quyết định màu sắc hiển thị. */
export type MoneyKind = "revenue" | "passthrough" | "liability" | "cost" | "cash" | "info";

/** Dự báo luôn là khoảng — kiểu này khiến "dự báo 1 con số" không thể biểu diễn được. */
export interface RangeForecast {
  min: number;
  max: number;
  typical: number;
  baselineNote: string; // so sánh mốc đơn giản, vd "giải tương tự lần trước: 78 entries"
}

export interface MoneyLine {
  id: string;
  label: string;
  amount: number;
  state: DataState;
  kind: MoneyKind;
  note?: string;
  /** true = dòng chi phí ĐÃ BIẾT là đang thiếu trong số liệu (vd lương PT) — render cảnh báo, không render 0. */
  missing?: boolean;
}

export interface EventPnlFixture {
  id: string;
  name: string;
  date: string;
  state: DataState;
  entries: number;
  buyInPerEntry: number;
  feePerEntry: number;
  poolPerEntry: number;
  gtd: number | null;
  playerFundedPool: number;
  gtdSubsidy: number;
  retainedFee: number;
  costs: MoneyLine[];
  otherRevenue: number; // doanh thu khác CLB GIỮ LẠI (không bao giờ là tiền pool/pass-through)
  contribution: number;
  /** Ngưỡng đủ phủ GTD: ceil(gtd / poolPerEntry). Chỉ là ngưỡng overlay, KHÔNG phải "an toàn". */
  breakEvenGtdEntries: number | null;
  /** Hòa vốn đóng góp (công thức chuẩn của skill): ceil((gtd + chi phí trực tiếp − otherRevenue) / poolPerEntry). */
  breakEvenContributionEntries: number | null;
}

export interface SeriesAllocation {
  label: string;
  amount: number;
  rule: string; // quy tắc phân bổ phải nêu rõ — không bao giờ giấu vào một giải
  perEvent: { eventId: string; amount: number }[];
}

export type VarianceBucket = "timing" | "missing" | "duplicate" | "mapping" | "amount";

export const VARIANCE_BUCKET_LABEL: Record<VarianceBucket, string> = {
  timing: "Lệch kỳ",
  missing: "Thiếu ghi nhận",
  duplicate: "Trùng lặp",
  mapping: "Sai phân loại",
  amount: "Lệch số tiền",
};

export interface CashChannelFixture {
  channel: "drawer" | "sepay" | "app";
  label: string;
  description: string;
  expected: number;
  actual: number;
  state: DataState;
  buckets: { bucket: VarianceBucket; amount: number; note: string }[];
}

export interface PayoutRow {
  rank: number;
  playerMasked: string;
  amount: number;
  status: "owed" | "paid";
  agingDays?: number;
}

export interface PayrollLineFixture {
  category: "dealer" | "floor" | "cashier" | "pt";
  label: string;
  amount: number | RangeForecast;
  state: DataState;
  /** true = dòng lương đang THIẾU khỏi P&L thật — hiển thị cảnh báo, không hiển thị 0. */
  missing?: boolean;
  note?: string;
}

export interface EscrowRow {
  id: string;
  label: string;
  amount: number;
  status: "held" | "released" | "refunded" | "refund_pending_repair";
  note?: string;
}

/** Bất biến kiểm soát: totalIn === released + refunded + balance. Test khóa điều này. */
export interface EscrowFixture {
  totalIn: number;
  released: number;
  refunded: number;
  balance: number;
  rows: EscrowRow[];
}

export type AlertSeverity = "P0" | "P1" | "P2";
export type AlertBucket =
  | "bank"
  | "cash"
  | "payroll"
  | "payout"
  | "fnb"
  | "staking"
  | "forecast";
export type AlertStatus = "open" | "investigating" | "explained";

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: "Đang mở",
  investigating: "Đang kiểm tra",
  explained: "Đã giải thích",
};

export interface VarianceItem {
  id: string;
  severity: AlertSeverity;
  bucket: AlertBucket;
  title: string;
  detail: string;
  amount?: number;
  status: AlertStatus;
  /** id tab liên quan để chủ CLB nhảy sang xem ("xem tab →"). */
  tabRef: string;
  /** true = cảnh báo MẪU thuộc nhóm rủi ro đã biết (repair-wave #656) — không phải trạng thái live đã xác minh. */
  sample?: boolean;
}
