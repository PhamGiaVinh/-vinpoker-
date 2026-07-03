// ⚠️ DỮ LIỆU MẪU (mock/spec) để duyệt thiết kế "Tài chính & Đối soát" — KHÔNG phải số thật.
// Mọi con số tuân thủ công thức trong VBacker/09-ACCOUNTING-CONTROL (và skill
// vinpoker-business-quant): fee+pool = buy-in; subsidy = max(0, GTD − pool);
// biên đóng góp = phí giữ lại + doanh thu khác − subsidy − chi phí trực tiếp.
// Các cảnh báo #656 là CẢNH BÁO MẪU thuộc nhóm rủi ro repair-wave đã biết
// (code đã merge, chờ áp dụng live) — trạng thái thật xác minh qua MODULE_STATUS trước khi tin.
// File __tests__/mockData.test.ts khóa các bất biến này — sửa số ở đây phải giữ test xanh.

import type {
  CashChannelFixture,
  EscrowFixture,
  EventPnlFixture,
  MoneyLine,
  PayoutRow,
  PayrollLineFixture,
  RangeForecast,
  SeriesAllocation,
  VarianceItem,
} from "./types";

// ── Event P&L ────────────────────────────────────────────────────────────────

const DEEPSTACK_COSTS: MoneyLine[] = [
  { id: "ds-dealer", label: "Lương dealer (theo giải)", amount: 9_600_000, state: "provisional", kind: "cost" },
  { id: "ds-floor", label: "Lương floor", amount: 3_000_000, state: "provisional", kind: "cost" },
  { id: "ds-cashier", label: "Lương thu ngân", amount: 2_400_000, state: "provisional", kind: "cost" },
  { id: "ds-marketing", label: "Chi phí marketing", amount: 2_000_000, state: "provisional", kind: "cost" },
  {
    id: "ds-pt",
    label: "Lương PT",
    amount: 0,
    state: "provisional",
    kind: "cost",
    missing: true,
    note: "Chưa có trong P&L — sửa lỗi đã merge (#656 R2), chờ áp dụng live. Không phải chi phí 0.",
  },
];

const TURBO_COSTS: MoneyLine[] = [
  { id: "tb-dealer", label: "Lương dealer (theo giải)", amount: 5_400_000, state: "final", kind: "cost" },
  { id: "tb-floor", label: "Lương floor", amount: 1_800_000, state: "final", kind: "cost" },
  { id: "tb-cashier", label: "Lương thu ngân", amount: 1_200_000, state: "final", kind: "cost" },
  { id: "tb-other", label: "Chi phí trực tiếp khác", amount: 1_500_000, state: "final", kind: "cost" },
  {
    id: "tb-pt",
    label: "Lương PT",
    amount: 0,
    state: "provisional",
    kind: "cost",
    missing: true,
    note: "Chưa có trong P&L — sửa lỗi đã merge (#656 R2), chờ áp dụng live.",
  },
];

// 88 entries × 5,5tr (5tr vào pool + 0,5tr phí) — pool 440tr, phí giữ lại 44tr.
// GTD 500tr → bù đắp 60tr. Chi phí trực tiếp (chưa gồm PT) 17tr → biên đóng góp −33tr.
// Hòa vốn GTD = ceil(500tr/5tr) = 100. Hòa vốn đóng góp = ceil((500tr+17tr−0)/5tr) = 104.
export const MOCK_EVENTS: EventPnlFixture[] = [
  {
    id: "deepstack-500",
    name: "VinPoker Deepstack 500tr GTD",
    date: "2026-06-30",
    state: "provisional",
    entries: 88,
    buyInPerEntry: 5_500_000,
    feePerEntry: 500_000,
    poolPerEntry: 5_000_000,
    gtd: 500_000_000,
    playerFundedPool: 440_000_000,
    gtdSubsidy: 60_000_000,
    retainedFee: 44_000_000,
    costs: DEEPSTACK_COSTS,
    otherRevenue: 0,
    contribution: -33_000_000,
    breakEvenGtdEntries: 100,
    breakEvenContributionEntries: 104,
  },
  {
    id: "daily-turbo",
    name: "Daily Turbo 2tr",
    date: "2026-07-01",
    state: "final",
    entries: 54,
    buyInPerEntry: 2_000_000,
    feePerEntry: 300_000,
    poolPerEntry: 1_700_000,
    gtd: null,
    playerFundedPool: 91_800_000,
    gtdSubsidy: 0,
    retainedFee: 16_200_000,
    costs: TURBO_COSTS,
    otherRevenue: 0,
    contribution: 6_300_000,
    breakEvenGtdEntries: null,
    breakEvenContributionEntries: null,
  },
];

// ── Tổng quan (roll-up nhất quán từ 2 giải trên) ────────────────────────────

export const MOCK_OVERVIEW = {
  periodLabel: "Tháng 7/2026 (đến 02/07)",
  retainedRevenue: 60_200_000, // 44tr + 16,2tr
  directCosts: 26_900_000, // 17tr + 9,9tr (CHƯA gồm lương PT — xem cảnh báo)
  gtdSubsidy: 60_000_000,
  contribution: -26_700_000, // −33tr + 6,3tr
  passThroughPool: 531_800_000, // 440tr + 91,8tr — tiền của người chơi, không phải doanh thu
  payoutOwed: 28_500_000,
  escrowHeld: 20_000_000,
  liabilitiesHeld: 48_500_000, // 28,5tr phải trả giải + 20tr ký quỹ
  openAlerts: 5, // các mục chưa "đã giải thích" trong hàng chờ cảnh báo
} as const;

export const MOCK_ENTRY_FORECAST: RangeForecast = {
  min: 70,
  max: 105,
  typical: 85,
  baselineNote: "giải tương tự lần trước: 78 entries · trung vị 6 giải gần nhất: 84",
};

// ── Chốt sổ cuối ngày (SPEC — chưa xây dựng) ────────────────────────────────

export type CloseStepStatus = "done" | "warning" | "blocked" | "pending";

export const MOCK_DAILY_CLOSE = {
  dayLabel: "Ngày 02/07/2026",
  steps: [
    { id: "open", label: "Mở ngày", status: "done" as CloseStepStatus, note: "Két đầu ngày 12.000.000 ₫" },
    { id: "collect", label: "Gom ghi nhận vận hành", status: "done" as CloseStepStatus, note: "Buy-in, re-entry, payout, lương tích lũy trong ngày" },
    { id: "bank", label: "Đối soát bank/két", status: "warning" as CloseStepStatus, note: "2 dòng chưa khớp (+1.100.000 ₫ bank · −200.000 ₫ két)" },
    { id: "variance", label: "Kiểm tra chênh lệch", status: "warning" as CloseStepStatus, note: "Chênh lệch chưa giải thích được ghi nhận, không tự xoá" },
    { id: "owner", label: "Chủ CLB duyệt", status: "pending" as CloseStepStatus, note: "Chưa ký — toàn bộ số của ngày vẫn là Tạm tính" },
    { id: "final", label: "Chốt sổ (bất biến)", status: "blocked" as CloseStepStatus, note: "Sau khi ký: sửa bằng bút toán điều chỉnh, không sửa lịch sử" },
  ],
} as const;

// ── Series P&L ───────────────────────────────────────────────────────────────

export const MOCK_SERIES = {
  name: "Summer Series 2026",
  eventIds: ["deepstack-500", "daily-turbo"],
  eventContributionTotal: -26_700_000,
  allocations: [
    {
      label: "Marketing cấp series",
      amount: 25_000_000,
      rule: "Phân bổ theo entry (88/142 · 54/142) — quy tắc nêu rõ, không giấu vào một giải",
      perEvent: [
        { eventId: "deepstack-500", amount: 15_500_000 },
        { eventId: "daily-turbo", amount: 9_500_000 },
      ],
    },
  ] satisfies SeriesAllocation[],
  contributionAfterAllocations: -51_700_000, // −26,7tr − 25tr
  state: "provisional" as const, // 1 giải còn Tạm tính → tổng series chưa chốt
} as const;

// ── Tiền mặt / SePay / Bank ─────────────────────────────────────────────────

export const MOCK_CASH_CHANNELS: CashChannelFixture[] = [
  {
    channel: "drawer",
    label: "Két tiền mặt (02/07)",
    description: "Đếm thực tế cuối ca so với số hệ thống kỳ vọng",
    expected: 18_400_000,
    actual: 18_200_000,
    state: "provisional",
    buckets: [], // −200k: đã đếm lại, chưa giải thích được — giữ nguyên là "chênh lệch chưa giải thích"
  },
  {
    channel: "sepay",
    label: "Bank qua SePay (02/07)",
    description: "61 giao dịch bank so với buy-in điện tử hệ thống ghi nhận",
    expected: 304_400_000,
    actual: 305_500_000,
    state: "provisional",
    buckets: [
      { bucket: "timing", amount: 900_000, note: "Chuyển khoản 23:58 — webhook ghi nhận 00:04 hôm sau, chuyển sang kỳ kế tiếp" },
      { bucket: "missing", amount: 200_000, note: "1 khoản không có memo cấu trúc — chưa khớp được với buy-in nào" },
    ],
  },
];

// ── Payout liability ─────────────────────────────────────────────────────────

export const MOCK_PAYOUT = {
  totalPrizes: 500_000_000, // pool 440tr + bù đắp GTD 60tr — GTD được giữ đúng cam kết
  paidTotal: 471_500_000,
  owedTotal: 28_500_000,
  owedRows: [
    { rank: 5, playerMasked: "N.V.T***", amount: 16_500_000, status: "owed", agingDays: 3 },
    { rank: 8, playerMasked: "L.H.P***", amount: 12_000_000, status: "owed", agingDays: 1 },
  ] satisfies PayoutRow[],
  paidRowsSample: [
    { rank: 1, playerMasked: "T.Q.B***", amount: 150_000_000, status: "paid" },
    { rank: 2, playerMasked: "P.M.D***", amount: 95_000_000, status: "paid" },
    { rank: 3, playerMasked: "H.N.K***", amount: 70_000_000, status: "paid" },
  ] satisfies PayoutRow[],
} as const;

// ── Lương & chi phí nhân sự (tích lũy tháng đến 02/07) ──────────────────────

export const MOCK_PAYROLL: PayrollLineFixture[] = [
  {
    category: "dealer",
    label: "Lương dealer",
    amount: 19_500_000,
    state: "provisional",
    note: "Gồm 15tr theo giải + 4,5tr trực ngày (không tính trùng) · trong đó 2.100.000 ₫ OT",
  },
  { category: "floor", label: "Lương floor", amount: 6_200_000, state: "provisional" },
  { category: "cashier", label: "Lương thu ngân", amount: 5_100_000, state: "provisional" },
  {
    category: "pt",
    label: "Lương PT",
    amount: { min: 8_000_000, max: 12_000_000, typical: 10_000_000, baselineNote: "ước theo giờ PT các tháng trước" },
    state: "forecast",
    missing: true,
    note: "Chưa có trong P&L (#656 R2 đã merge, chờ áp dụng live) — chỉ ước khoảng, không phải 0.",
  },
];

export const MOCK_TABLE_HOUR = {
  staffCost: 30_800_000, // 19,5 + 6,2 + 5,1 (chưa gồm PT)
  tableHours: 260,
  costPerTableHour: 118_000, // làm tròn cho hiển thị — con số quyết định, không phải KPI phù phiếm
  missingCheckouts: 1, // 1 dealer chưa check-out hôm qua → giờ công chưa chốt được
} as const;

// ── Staking / VBacker escrow ─────────────────────────────────────────────────

// Bất biến: 120tr vào = 85tr đã trả + 15tr đã hoàn + 20tr đang giữ.
export const MOCK_ESCROW: EscrowFixture = {
  totalIn: 120_000_000,
  released: 85_000_000,
  refunded: 15_000_000,
  balance: 20_000_000,
  rows: [
    { id: "esc-1", label: "Deal staking #A12 — đang chờ kết quả giải", amount: 12_000_000, status: "held" },
    {
      id: "esc-2",
      label: "Deal staking #A09 — deal đã hủy",
      amount: 8_000_000,
      status: "refund_pending_repair",
      note: "Chờ hoàn — đường hoàn tiền đang sửa (#656 R3 đã merge, chờ áp dụng live). Xử lý thủ công phải có ghi log.",
    },
    { id: "esc-3", label: "Deal #A08 — đã trả cho backer", amount: 25_000_000, status: "released" },
    { id: "esc-4", label: "Deal #A05 — đã hoàn (deal hủy)", amount: 15_000_000, status: "refunded" },
  ],
};

// ── Hàng chờ cảnh báo lệch số (7 mục) ───────────────────────────────────────

export const MOCK_ALERTS: VarianceItem[] = [
  {
    id: "al-bank",
    severity: "P1",
    bucket: "bank",
    title: "Bank lệch +1.100.000 ₫ so với ghi nhận",
    detail: "900k lệch kỳ (chuyển khoản đêm) + 200k thiếu memo chưa khớp được.",
    amount: 1_100_000,
    status: "investigating",
    tabRef: "cash",
  },
  {
    id: "al-cash",
    severity: "P2",
    bucket: "cash",
    title: "Két thiếu 200.000 ₫ sau kiểm đếm",
    detail: "Đã đếm lại, không có hoàn F&B hay payout nào giải thích — giữ nguyên là chênh lệch chưa giải thích.",
    amount: 200_000,
    status: "open",
    tabRef: "cash",
  },
  {
    id: "al-pt",
    severity: "P1",
    bucket: "payroll",
    title: "Cảnh báo mẫu: P&L đang thiếu lương PT",
    detail:
      "Nhóm rủi ro repair-wave #656 R2 — code đã merge, chờ áp dụng live. Trạng thái thật xác minh qua MODULE_STATUS trước khi tin. Tổng chi phí nhân sự đang bị khai thiếu.",
    status: "open",
    tabRef: "payroll",
    sample: true,
  },
  {
    id: "al-payout",
    severity: "P1",
    bucket: "payout",
    title: "Cảnh báo mẫu: Payout Edge chưa cập nhật (v1 → v1.1)",
    detail:
      "Nhóm rủi ro repair-wave #656 R1 — code đã merge, chờ deploy. Số liability coi là Tạm tính, xác minh thủ công trước khi trả.",
    status: "open",
    tabRef: "payout",
    sample: true,
  },
  {
    id: "al-fnb",
    severity: "P2",
    bucket: "fnb",
    title: "F&B chưa nối vào Accounting Control",
    detail:
      "Khi nối dữ liệu tài chính F&B, các lệch COGS/công thức/tồn kho sẽ xuất hiện ở đây. Hiện chưa có gì để đối soát — không phải mọi thứ đều khớp.",
    status: "explained",
    tabRef: "fnb",
    sample: true,
  },
  {
    id: "al-staking",
    severity: "P0",
    bucket: "staking",
    title: "Cảnh báo mẫu: 8.000.000 ₫ escrow chờ hoàn — đường hoàn đang sửa",
    detail:
      "Nhóm rủi ro repair-wave #656 R3 — deal hủy nhưng đường hoàn tự động chưa áp dụng live. Rủi ro kẹt tiền của backer; xử lý thủ công phải có chữ ký chủ CLB + ghi log.",
    amount: 8_000_000,
    status: "investigating",
    tabRef: "staking",
    sample: true,
  },
  {
    id: "al-forecast",
    severity: "P2",
    bucket: "forecast",
    title: "Dự báo vs thực tế: 88 entries nằm trong khoảng 70–105",
    detail: "Mục học tập — dự báo giữ được độ phủ; không cần hành động.",
    status: "explained",
    tabRef: "overview",
  },
];

// ── Báo cáo tháng (SPEC — số mẫu, muted) ────────────────────────────────────

export const MOCK_MONTHLY = {
  monthLabel: "Tháng 7/2026 — THÁNG CHƯA CHỐT (còn ngày chưa chốt sổ)",
  sections: [
    { id: "retained", label: "Tiền giữ lại (doanh thu thực)", amount: 60_200_000 },
    { id: "costs", label: "Chi phí trực tiếp (chưa gồm lương PT)", amount: 26_900_000 },
    { id: "subsidy", label: "Bù đắp GTD", amount: 60_000_000 },
    { id: "contribution", label: "Biên đóng góp (chưa trừ chi phí vận hành chung)", amount: -26_700_000 },
    { id: "liabilities", label: "Nợ phải trả còn lại (payout + escrow)", amount: 48_500_000 },
    { id: "variance", label: "Chênh lệch chưa giải thích", amount: 200_000 },
  ],
  risks: [
    "Còn ngày chưa chốt sổ — toàn bộ số là Tạm tính.",
    "P&L thiếu lương PT (#656 R2 đã merge, chờ áp dụng live).",
    "Payout Edge chờ deploy (#656 R1) — liability xác minh thủ công.",
    "8.000.000 ₫ escrow chờ hoàn (#656 R3).",
    "F&B chưa nối vào Accounting Control — biên F&B chưa có trong báo cáo.",
  ],
} as const;

// ── F&B (chưa nối) ───────────────────────────────────────────────────────────

export const MOCK_FNB_NOT_WIRED = {
  title: "Chưa nối dữ liệu tài chính F&B vào Accounting Control",
  detail:
    "Module F&B vận hành riêng (order/bếp/kho). Màn hình này chỉ hiển thị rollup tài chính đã đối soát — phần đó chưa được nối, nên không hiển thị số 0 như thể là kết quả thật.",
  willShow: [
    "Doanh thu F&B đã thu (sau hoàn)",
    "Hoàn tiền F&B (bút toán âm, không sửa lịch sử)",
    "Giá vốn (COGS) bắt buộc theo kho — không ước theo % margin",
    "Biên F&B = doanh thu − COGS",
    "COGS đồ COMP tính vào chi phí của giải được tặng",
    "Trạng thái đơn: đã thu / đã giao / đã hủy",
    "Cảnh báo lệch công thức/tồn kho",
  ],
} as const;
