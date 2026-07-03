# iPhone Operations UX Audit — VinPoker (PR-IOS0, docs-only)

> **Trạng thái: SPEC — chưa triển khai.** Không có dòng code app nào đổi trong PR này.
> Cờ đề xuất: `mobileOpsV2` (mặc định OFF, **chưa tồn tại** trong `featureFlags.ts`).
> Base SHA: `e194571d` (origin/main, 2026-07-04). Vai trò đọc: owner / floor / TD / cashier / dealer.
>
> **Ghi đè `uiux-master-map.md` §20.1** (Stitch Dark neon-green #00FF88): chuẩn màu hiện hành là
> **Midnight Sakura** theo `VBacker/02-OWNER-DECISIONS/UI_UX_DIRECTION.md`, đã là `:root` mặc định từ
> PR #665 (`src/index.css:8–113`). §20.1 sẽ sửa ở một chore riêng, KHÔNG sửa trong PR này.

## 1. Phạm vi & phương pháp

Đánh giá **khả năng dùng trên iPhone** (390px, một tay, PWA standalone) của các màn **vận hành** VinPoker.
Đây là tài liệu audit: **chỉ ghi vấn đề**, giải pháp nằm ở các doc IA/spec/wireframe/component/PR-plan.

**Nguồn bằng chứng** (đầy đủ trong `iphone-operations-screens/EVIDENCE.md`):
- `[390-real]` — Playwright chụp **390×844 thật** trang công khai (landing). Không cần đăng nhập.
- `[desktop-obs]` — owner tự đăng nhập + điều hướng, tôi chụp read-only (computer-use). Owner không rành
  DevTools nên chụp ở **desktop width** → xác nhận cấu trúc/nhãn/theme, KHÔNG phản ánh layout 390px.
- `[code]` — **nguồn chính cho hành vi mobile**: breakpoint, `grid-cols`, overflow, target size, safe-area,
  đọc từ source ở base SHA.

**Vì sao không có ảnh 390px cho màn login**: `claude-in-chrome` không cài được trên máy owner → không thể
tự lái Chrome-đã-đăng-nhập về 390px; và tôi **không được phép nhập mật khẩu** để playwright tự đăng nhập.
Bù lại: bằng chứng code rất cụ thể (file:line) + 2 mỏ neo thật (landing 390 + Floor desktop).

**An toàn (đã tuân thủ)**: pre-flight write-on-mount cho mọi route; chỉ điều hướng/đọc, không bấm nút
tiền/nguy hiểm; tripwire mạng; không PII trong tài liệu (nhãn ẩn danh "Player A", "Bàn 3", "số tiền đã che").

## 2. Thang điểm

| Mức | Nghĩa |
|-----|-------|
| **GO** | Floor làm việc chính của màn MỘT TAY ở 390px hôm nay; không P0, ≤1 P1. |
| **HOLD** | Làm được nhưng ≥2 P1 (hai tay, cuộn ngang, target <40px, hành động chính bị chôn) → vào `mobileOpsV2`. |
| **NO-GO** | Cấu trúc desktop ở 390px (cockpit nhiều tab, console 2 cột, bảng rộng) → desktop-only hoặc redesign hẳn, **không bóp cho vừa**. |

- **P0** = nguy cơ bấm nhầm/đọc nhầm hành động **tiền/bust/xoá** trên điện thoại (dẫn master-map §15 confirm restate amount / §8 target ≥40px).
- **P1** = ma sát lớn cho việc floor hằng ngày. **P2** = polish.

## 3. Nhãn live-truth (không gọi mock là thật)

`LIVE` · `LIVE SHELL / MOCK DATA` · `FLAG OFF (dark)` · `SPEC (chưa tồn tại)`.
Cờ đọc trực tiếp `featureFlags.ts` @ base: `accountingControl`/`fnbModule`/`fnbCounter`/`fnbKitchen`/
`trackerHandInputConsole`/`chipOps`/`floorTableOps`/`floorOutConfirm` = **ON**;
`clubFinanceDashboard`/`closeReport`/`shiftPlannerV2`/`fnbGuestOrder` = **OFF**.

## 4. Ma trận verdict (10 khu vực)

| # | Khu vực | Route | Live-truth | iPhone verdict | Sóng redesign |
|---|---------|-------|-----------|----------------|----------------|
| 1 | Nav shell / lối vào vận hành | `/` + VẬN HÀNH | LIVE | **HOLD** (consumer GO, operator entry bị chôn) | Wave 1 |
| 2 | Quản lý giải (Floor) | `/floor` | LIVE | **NO-GO** (form nặng, icon xoá nhỏ, live-state inline) | Wave 1 (tách cockpit) |
| 3 | Thao tác bàn (table ops) | `/floor` → map/sheets | LIVE | **HOLD** (grid-cols-3 tap-accuracy; sheet đáy tốt) | Wave 1 |
| 4 | Xếp ghế / assign / redraw | dialogs | LIVE | **HOLD** (input h-9, dialog stack ổn nhưng dày) | Wave 2 |
| 5 | Dealer Swing / payroll | `/dealer-swing` | LIVE | **NO-GO** (bảng payroll rộng, cuộn ngang) | Wave 2 (card hoá) |
| 6a | Tracker operator (hand-input) | `/tracker/hand-input` | LIVE (CODE-ONLY audit) | **NO-GO** (console 2 cột desktop) | Desktop-only |
| 6b | Public live viewer | `/live/:id` | LIVE | **GO** (đã responsive: `liveViewerFeltV2`/`liveFeltCompact`) | Không cần |
| 7 | F&B counter / kitchen | `/fnb`, `/fnb/kitchen` | LIVE | **HOLD** (order entry chật; kitchen chrome-less ổn) | Wave 2 |
| 8 | Cashier / payment | `/cashier` | LIVE | **HOLD** (7 tab full; overview ổn; bảng đăng ký dày) | Wave 2 |
| 9 | Tài chính & Đối soát | `/club/admin/accounting-control` | **LIVE SHELL / MOCK DATA** | **NO-GO** (11-tab strip cuộn ngang) | Mobile = thẻ cảnh báo read-only |
| 10 | Series Intelligence | `/club/admin/series-intelligence` | LIVE (mixed CSV/live) | **NO-GO** (nhiều input/chart, stepper desktop) | Desktop-only |

## 5. Chi tiết từng khu vực

### 4.1 Nav shell — HOLD · `[390-real]`
Consumer bottom nav ở 390px = 5 mục gọn (Lịch giải/Đối tác/·logo·/Coach/Feed), target ~44px, theme Midnight
Sakura đúng. **Vấn đề vận hành**: VẬN HÀNH (Floor/Cashier/Tracker/Swing…) **không có trong bottom nav** →
chôn sau ☰. Floor không có đường một-tay tới vận hành. **P1**. (Lưu ý: lo ngại "grid-cols-7 vỡ 360px" trong
roadmap thuộc bản logged-in nhiều mục — không quan sát vỡ ở landing 390 logged-out.)

### 4.2 Quản lý giải (Floor) — NO-GO · `[desktop-obs]`
`/floor` là **màn quản lý giải** (Chọn giải · Làm mới · toggle Giải thưởng/Multi-day · tạo/sửa giải thưởng ·
khối Live state PLAYERS/LEVEL/BLIND/STATUS nhập inline), không phải view "đi sàn". Vấn đề:
- **P0/P1 mis-tap xoá**: card giải thưởng có cụm 4 icon ~20px sát nhau, kết bằng **thùng rác đỏ (xoá)** —
  xoá cơ cấu tiền cạnh nút sửa, không giãn cách, không thấy xác nhận. Ở 390px rất dễ bấm nhầm.
- **P1 sửa inline money-ish**: BLIND/LEVEL/STATUS sửa tại chỗ — điện thoại cần tách + xác nhận.
- Form hình-desktop → 390px kéo dài dọc, whitespace thừa.

### 4.3 Thao tác bàn — HOLD · `[code]`
`FloorTableMapPanel`: grid `grid-cols-3 sm:grid-cols-6 lg:grid-cols-10` → ở 390px **3 cột**, ô ~h-14,
tap-accuracy kém (dễ chạm nhầm bàn kề). **Điểm tốt (prior art)**: chuỗi `FloorTableDetailSheet` (sheet) →
`PlayerActionSheet` (sheet đáy, 4 hành động Chuyển/Sửa chip/Phiếu/Loại) → `BustConfirmDialog` (đã có, restate
hạng+tiền) — đúng hướng mobile. **P1**: mật độ lưới; nút sticky header h-9 hơi nhỏ.

### 4.4 Xếp ghế / redraw — HOLD · `[code]`
Dialog `AddPlayerDialog`/`MovePlayerDialog`/`EditChipsDialog`/`RedrawLauncherDialog`: input/select `h-9`
(36px < 44px), dialog `max-w-sm` stack ổn. **P1** target 36px; **P2** dày chữ. Xác nhận tiền/chip có cảnh báo
(tốt) nhưng chưa nhất quán restate amount trên mobile.

### 4.5 Dealer Swing / payroll — NO-GO · `[code]`
`DealerSwingDashboard` (tabs swing/payroll/planner). `DealerPayrollTab` = **bảng 8–10 cột** (tên/base/ca/BHXH/
thuế/thưởng/net/trạng thái/actions) → 390px **buộc cuộn ngang** để thấy net/trạng thái/nút. **P1**. Cần card
hoá (1 dealer = 1 card, net + trạng thái nổi, action trong sheet).

### 4.6a Tracker operator (hand-input) — NO-GO · `[code, CODE-ONLY]`
`StandaloneHandInputConsole` 2 cột (felt trái / action phải) — không biến thể mobile rõ; ở 390px stack dọc,
felt bị nén, panel hành động chiếm nguyên màn. Route có heartbeat/lock (audit code-only). **NO-GO** — giữ
desktop; mobile chỉ nên có "mở trên máy tính". Racetrack (`trackerRacetrackUi` ON) có portrait pods nhưng vẫn
là surface thao-tác-nặng.

### 4.6b Public live viewer — GO · `[code]`
`/live/:id` (LiveHub) đã responsive: `liveViewerFeltV2` + `liveFeltCompact` ON, event tabs, hand feed.
Là chuẩn "đã làm đúng mobile". Không thuộc scope redesign.

### 4.7 F&B — HOLD · `[code]`
`FnbCounter` (order entry: category/item/qty/notes) chật ở 390px; `FnbKitchenDisplay` chrome-less full-screen
tap-to-done ổn hơn. **P1** order entry; kitchen gần GO. Guest QR (`fnbGuestOrder`) OFF → không audit.

### 4.8 Cashier — HOLD · `[code]`
`CashierDashboard` 7 tab (overview mặc định read-only, ổn); `RegistrationQueuePanel` danh sách đăng ký dày;
`OfflineBuyInPanel` form buy-in nhiều input. **P1** mật độ + tab strip; nút hành động tiền cần restate amount.

### 4.9 Tài chính & Đối soát — NO-GO · `[code]` · **LIVE SHELL / MOCK DATA**
`AccountingControl` **11 tab cuộn ngang** (`overflow-x-auto`, ~35–40px/tab) → phải cuộn mới thấy tab sau =
gánh nặng khám phá. **DỮ LIỆU MẪU** (pure client state, không network). Trên iPhone **không** nên bê nguyên
cockpit: chỉ nên có **thẻ cảnh báo read-only** (Tạm tính/Đã chốt, "Còn lại sau lương" — không "Lãi ròng";
"Tiền chuyển hộ" không phải doanh thu; Biên đóng góp ≠ Lợi nhuận). **Floor không thao tác tiền.** **P1**.

### 4.10 Series Intelligence — NO-GO · `[code]`
`SeriesIntelligence` stepper nhiều panel (CSV/Monte Carlo/forecast/decision log) với nhiều input + chart →
390px chật, cuộn dọc dài. Là công cụ phân tích owner → **desktop-only**, mobile chỉ link "mở trên máy tính".

## 6. Top 10 vấn đề iPhone (xuyên suốt)

1. **Lối vào vận hành bị chôn** sau ☰ trên mobile — không có shell/bottom-nav cho floor. `P1` (lõi IA).
2. **Icon xoá/sửa cơ cấu tiền ~20px sát nhau** (Floor prize card) — mis-tap xoá. `P0/P1`.
3. **11-tab cuộn ngang** (Tài chính & Đối soát) — khó khám phá, không hợp một tay. `P1`.
4. **Lưới bàn 3 cột ở 390px** — chạm nhầm bàn kề. `P1`.
5. **Console hand-input 2 cột desktop** — không dùng được khi đi sàn. `P1/NO-GO`.
6. **Bảng payroll 8–10 cột cuộn ngang** — không thấy net/trạng thái/nút. `P1`.
7. **Sửa inline Live-state (blind/level/status)** không tách/không xác nhận trên mobile. `P1`.
8. **Không có shared primitives mobile** (StatusPill/EmptyState/BottomDock/StaleBanner) → trạng thái/empty/
   loading không nhất quán khắp các màn vận hành. `P1` (hệ thống).
9. **Target < 44px phổ biến** (nút h-9 = 36px, input select) khắp cashier/floor/dialog. `P1` (dẫn §8).
10. **PWA manifest `theme_color: #3b82f6` (xanh)** ≠ Midnight Sakura vàng #C9A86A → status-bar/splash lệch
    brand ở chế độ standalone. `P2` (sửa 1 dòng, thuộc PR-IOS1).

Phụ: chưa có **bottom action dock** an toàn (safe-area) cho hành động chính của floor; xác nhận nguy hiểm
chưa luôn **restate số tiền** trên mobile (§15).

## 7. Ưu tiên redesign

- **Wave 1 (mobileOpsV2 lõi)**: shell `/ops/*` + bottom nav (Hôm nay/Giải đấu/Bàn/Cảnh báo/Thêm) + màn
  **Floor hôm nay** + table ops (map→sheet) + lối vào vận hành. Sửa top-vấn-đề 1,2,4,7.
- **Wave 2**: cashier lite (đọc + đăng ký), dealer status (card), F&B status, thẻ Tài chính read-only. Sửa 3,6,8,9.
- **Desktop-only (không mobile hoá)**: hand-input console, Series Intelligence, cockpit Tài chính đầy đủ,
  payroll chỉnh sửa. Mobile chỉ "Mở trên máy tính".

## 8. Điều KHÔNG audit live (và vì sao)
- `/tracker/hand-input` — CODE-ONLY (heartbeat/lock surface): đọc từ code.
- Màn login khác — audit code + `[desktop-obs]`; thiếu ảnh 390px vì lý do công cụ ở §1. Không suy diễn số
  liệu; mọi verdict mobile dựa trên breakpoint/grid/target đọc được ở base SHA.
- Không tạo/sửa dữ liệu prod để "giả lập" trạng thái; empty state ghi khi gặp thật hoặc suy từ code.
