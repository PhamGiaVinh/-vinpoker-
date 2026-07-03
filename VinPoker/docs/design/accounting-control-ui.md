# Accounting Control UI — "Tài chính & Đối soát"

- **Ngày:** 2026-07-03 · **Trạng thái:** UI SHELL (mock) — flag `accountingControl` OFF
- **Route:** `/club/admin/accounting-control` · **Nguồn doctrine:** `VBacker/09-ACCOUNTING-CONTROL/*`
  + skill `vinpoker-business-quant` (canonical copy: `docs/agent-skills/vinpoker-business-quant/`)
- Ghi chú governance: `docs/design/` trước đây chưa tồn tại trên main — UI/UX Master Map
  (Phase 0) vẫn còn thiếu; file này là file đầu tiên của thư mục.

## 1. Mục đích & định vị

Buồng lái tài chính cho CHỦ CLB (không phải màn hình kế toán viên): trả lời "tiền có khớp
không, club thực giữ lại bao nhiêu, đang nợ ai gì, rủi ro ở đâu".

- **Kế toán quản trị (management accounting)** — KHÔNG phải kế toán thuế/pháp lý; không VAT,
  không hóa đơn, không sổ cái pháp định; không định vị thay phần mềm kế toán.
- **Tên gọi:** UI = "Tài chính & Đối soát" · docs/code = "Accounting Control" · không bao giờ
  gọi trần "Kế toán".
- **Tầng 2 chỉ-đọc:** module vận hành (Cashier, F&B, Payout, Payroll/Dealer Swing,
  Staking/VBacker, SePay) giữ nghiệp vụ và phát sự kiện; trang này chỉ tổng hợp, đối soát,
  cảnh báo. Không có nút thao tác tiền.

## 2. Kiến trúc 11 tab (IA)

| # | Tab id | Nhãn | Component | Câu hỏi chính | Doctrine nguồn |
|---|--------|------|-----------|----------------|----------------|
| 1 | overview | Tổng quan | OverviewTab | Tháng này club thực giữ lại bao nhiêu — và đang giữ hộ/nợ ai bao nhiêu? | ACCOUNTING_CONTROL_HOME, MONEY_FLOW_MAP |
| 2 | close | Chốt sổ | DailyCloseTab (SPEC) | Cuối ngày, ai xác nhận số nào là thật? | DAILY_CLOSE |
| 3 | event-pnl | Event P&L | EventPnlTab | Giải này club thực sự lời hay lỗ bao nhiêu từ phí? | EVENT_PNL |
| 4 | series-pnl | Series P&L | SeriesPnlTab | Cả chuỗi giải cộng lại, club được gì? | SERIES_PNL |
| 5 | cash | Tiền & Bank | CashBankTab | Tiền trong bank/két có khớp với sổ không? | BANK_CASH_RECONCILIATION |
| 6 | payout | Phải trả giải | PayoutLiabilityTab | Club còn nợ người chơi bao nhiêu tiền thưởng? | PAYOUT_LIABILITIES |
| 7 | fnb | F&B | FnbFinanceTab | Biên F&B đã có trong sổ chưa? | FNB_FINANCE_RECOGNITION |
| 8 | payroll | Lương & chi phí | PayrollCostTab | Chi phí người vận hành tháng này — ghi nhận đủ chưa? | PAYROLL_AND_WAGES |
| 9 | staking | Ký quỹ staking | StakingEscrowTab | Tiền của backer đang nằm ở đâu, có đủ không? | STAKING_ESCROW_CONTROL |
| 10 | alerts | Cảnh báo | VarianceAlertsTab | Số nào đang không khớp và ai cần xử lý? | DATA_QUALITY_FOR_FINANCE |
| 11 | monthly | Báo cáo tháng | MonthlyReportTab (SPEC) | Cả tháng: giữ được bao nhiêu, nợ gì, rủi ro gì? | OWNER_MONTHLY_REPORT |

Tab strip cuộn ngang (mobile 390px); nhãn ngắn trên trigger, tiêu đề đầy đủ trong TabShell.

## 3. Bản đồ sở hữu dữ liệu (theo MONEY_FLOW_MAP)

| Số liệu trên trang | Module Tier-1 sở hữu | Phân loại |
|---|---|---|
| Phí/rake giữ lại | Cashier/Tournament | Retained revenue (duy nhất được màu primary) |
| Prize pool | Cashier/Tournament → Payout | Pass-through → liability (màu custody gold) |
| Bù đắp GTD | Tournament/Payout | Cost |
| Lương dealer/floor/thu ngân/PT | Payroll/Dealer Swing | Cost (giá trị đã lưu không tính lại) |
| Doanh thu/COGS F&B | F&B | Retained revenue/Cost — CHƯA NỐI vào trang này |
| Dòng bank SePay/VietQR | SePay ingestion | Cash movement (không phải doanh thu) |
| Két tiền mặt | Cashier | Internal transfer / đối soát |
| Escrow staking | Staking/VBacker | Pass-through → liability |

## 4. Nhãn, trạng thái & cảnh báo

- **4 con dấu trạng thái** (DataStateBadge — bắt buộc trên mọi giá trị tiền):
  Dự báo (viền đứt, luôn là KHOẢNG) · Tạm tính (amber) · Đã đối soát (xanh #378ADD) ·
  Đã chốt (primary — chỉ thứ đã qua sự kiện đóng sổ).
- **Chuỗi bắt buộc:** (Tổng quan) "Doanh thu giữ lại ≠ tổng buy-in. Prize pool và escrow là
  tiền pass-through/liability, không phải doanh thu." · (Series) "Series Intelligence dự báo
  trước. Accounting Control chốt số thật sau event/series. Forecast không phải accounting
  truth." · Nhãn biên: "Biên đóng góp (chưa trừ chi phí vận hành chung)".
- **Từ cấm:** "lợi nhuận", "net profit" — không xuất hiện; "lãi ròng" chỉ được xuất hiện trong
  phủ định "chưa phải lãi ròng" (Báo cáo tháng). Test guard khóa quy tắc này.
- **Hòa vốn phải là CẶP nhãn:** "Hòa vốn GTD (đủ phủ đảm bảo)" và "Hòa vốn đóng góp (gồm chi
  phí trực tiếp)" — không bao giờ một nhãn "hòa vốn" trơ.
- **Module chưa nối (F&B):** render NotWiredState "Chưa nối dữ liệu tài chính F&B vào
  Accounting Control" — không render số 0 như kết quả thật.
- **3 cảnh báo mẫu nhóm #656** (R1 payout Edge · R2 lương PT · R3 hoàn escrow): gắn chip
  "Cảnh báo mẫu", wording "code đã merge, chờ áp dụng live"; trạng thái thật xác minh qua
  `VBacker/01-MODULE-STATUS/MODULE_STATUS.md` trước khi tin — KHÔNG hardcode như live truth.

## 5. Kế hoạch nối dữ liệu thật (future wiring — KHÔNG nằm trong PR này)

Mỗi tab nối riêng, sau cổng duyệt của chủ CLB, mỗi bước một flag riêng:

| Tab | Nguồn đọc ứng viên (read-only) | Điều kiện trước |
|---|---|---|
| Tổng quan / Event P&L | `get_club_finance_summary` + scoping theo giải | PT wage (#656 R2) áp dụng live |
| Tiền & Bank | worklist đối soát SePay (RPC chỉ-đọc) | flag `sepayReconcile` + UAT |
| Phải trả giải | bảng payout + snapshot freeze-at-close | Payout Edge v1.1 deploy (#656 R1) |
| Lương & chi phí | payroll đã lưu + PT ledger | #656 R2 áp dụng + types regen |
| Ký quỹ staking | escrow ledger | #656 R3 áp dụng + smoke suite |
| F&B | fnb finance rollup | flip `fnb_in_club_net` sau golden-diff |
| Chốt sổ / Báo cáo tháng | CHƯA CÓ backend — cần xây Daily Close / Close Report wedge | spec này là hợp đồng nghiệm thu |

Quy tắc cứng: wiring không bao giờ đi cùng PR UI; mọi RPC mới/flag flip đều owner-gated.

## 6. Những gì còn là mock/SPEC

TẤT CẢ số liệu là mock (fixtures `mock/mockData.ts`, test khóa công thức tại
`__tests__/mockData.test.ts`). Tab 2 (Chốt sổ) + Tab 11 (Báo cáo tháng) là SPEC — vẫn là SPEC
kể cả sau khi các tab khác nối dữ liệu, cho tới khi Daily Close / Close Report được xây.

## 7. Checklist screenshot & quy trình chụp

| Màn | 1280px | 768px | 390px |
|---|---|---|---|
| Tổng quan | ✅ bắt buộc | spot-check | ✅ bắt buộc (thấy tab cuộn) |
| Event P&L | ✅ bắt buộc | — | — |
| Cảnh báo lệch số | ✅ bắt buộc | — | — |
| Lương & chi phí | — | — | ✅ bắt buộc |

Quy trình: dev preview không có phiên đăng nhập → bật tạm flag + bypass gate CỤC BỘ
(không commit) → chụp → revert → `git diff` chứng minh `accountingControl: false` và gate
nguyên vẹn trước khi commit. PR body khai báo rõ thủ tục này. Không bao giờ commit nới gate.
