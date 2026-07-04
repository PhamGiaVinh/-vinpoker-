# iPhone Operations UX Audit — Evidence Log (2026-07-03)

Nhật ký bằng chứng cho `docs/design/iphone-operations-ux-audit.md` (PR-IOS0, docs-only).
Base SHA: `e194571d` (origin/main). Trạng thái: **đang thu thập**.

## Phương pháp

- Audit trên **production** qua Chrome đã đăng nhập của owner (claude-in-chrome), trong **một tab riêng**
  do phiên audit tạo — không đụng tab làm việc của owner.
- Kích thước quét: **390×844** (iPhone 14/15, chính) → re-sweep điểm lỗi ở 360×780 / 430×932; 768×1024
  cho 2 màn cockpit. Cuối phiên: đóng tab audit, trả lại kích thước cửa sổ gốc, KHÔNG logout,
  KHÔNG xoá cookie, không dừng ở route nguy hiểm.
- **Không commit ảnh chụp màn hình** (tiền lệ `accounting-control-screens/EVIDENCE.md`): màn vận hành
  prod hiển thị tên/SĐT/tiền thật của người chơi. Mọi bằng chứng ghi dạng text đo đạc
  (vị trí phần tử, overflow, kích thước target). **Không PII**: chỉ dùng nhãn ẩn danh —
  "Player A", "Bàn 3", "số tiền đã che", "giá trị thật đã quan sát nhưng không ghi lại".

## Luật an toàn (P0 — đã tuân thủ từng stop)

1. **Pre-flight write-on-mount**: trước khi mở bất kỳ route rủi ro nào trên prod, code của route đã được
   kiểm tra mount-time writes (lock/heartbeat/presence/claim/auto-save/realtime ghi). Route có thể ghi
   khi mount → KHÔNG mở trên prod, audit từ code, đánh dấu **"CODE-ONLY due write-on-mount risk"**.
   Kết quả pre-flight: bảng ở mục dưới.
2. **Tương tác cho phép**: điều hướng URL, resize, chụp/cuộn, đọc accessibility tree; click CHỈ vào
   tab/nav-link/sheet chi tiết read-only/nút đóng. **Cấm**: mọi nút Xác nhận/Lưu/Chuyển/Sửa chip/Loại/
   Thanh toán/Chốt/Mở bàn/Đóng bàn/Xóa/Trả/Duyệt/Gửi hoặc submit form; không nhập liệu; không chạy JS.
   `BustConfirmDialog` + mọi đường tiền: audit từ code.
3. **Tripwire mạng**: sau mỗi stop có tương tác, đọc network requests và **phân loại mọi non-GET**:
   auth/session-refresh · read-only RPC/query · mutation · unknown. Gặp mutation/unknown → dừng đụng
   surface đó, ghi rủi ro vào đây. Không bao giờ dán header/cookie/token/auth payload vào docs.

## Thang điểm (cố định trước khi chấm)

- **GO** — floor làm được việc chính của màn đó MỘT TAY ở 390px hôm nay; không P0, ≤1 P1.
- **HOLD** — làm được nhưng ≥2 P1 (hai tay, cuộn ngang, target <40px, hành động chính bị chôn) →
  vào scope `mobileOpsV2`.
- **NO-GO** — cấu trúc desktop ở 390px (cockpit nhiều tab, console 2 cột, bảng rộng) → desktop-only
  trong IA hoặc redesign hẳn, không bao giờ "bóp cho vừa".
- **P0** = nguy cơ bấm nhầm/đọc nhầm hành động tiền/bust trên điện thoại (dẫn master-map §15/§8) ·
  **P1** = ma sát lớn cho việc floor hằng ngày · **P2** = polish.

## Nhãn live-truth (4 mức, gắn cho từng surface)

`LIVE` · `LIVE SHELL / MOCK DATA` · `FLAG OFF (dark)` · `SPEC (chưa tồn tại)`

## Kết quả pre-flight write-on-mount (P0-1) — đã reconcile với `featureFlags.ts` @ e194571d

Một agent pre-flight đọc SAI trạng thái cờ (tưởng nhiều cờ OFF). Đã **đọc lại trực tiếp** nguồn sự thật
`src/lib/featureFlags.ts`: `accountingControl` / `fnbModule` / `fnbCounter` / `fnbKitchen` /
`trackerHandInputConsole` / `chipOps` / `floorTableOps` / `floorOutConfirm` = **ON**;
`clubFinanceDashboard` / `closeReport` = **OFF**. Bảng dưới dùng sự thật cờ đã xác minh.

**Phát hiện ghi-khi-mount thật sự (chỉ 1, vô hại với owner)**: `send-welcome-email`
(EmailVerificationGate.tsx:37) chỉ bắn 1 lần khi xác nhận email lần đầu — owner đã xác nhận từ lâu →
không bắn. `heartbeat_lock` (useStandaloneHandInput.ts:271) là keepalive định kỳ 120s, chỉ khi có ván
đang chạy, KHÔNG chạy lúc mount. Mọi realtime subscription là listener **read-only**.

| # | Route | Verdict | Ghi chú an toàn |
|---|-------|---------|-----------------|
| 1 | `/dealer/*` | **SAFE-TO-OPEN** | reads only; mẫu tham chiếu mobile shell |
| 2 | `/` (landing) | **SAFE-TO-OPEN** | reads only (owner đã xác nhận email → send-welcome không bắn); không submit form |
| 3 | `/floor` | **SAFE-WITH-RULES** | default tab table_map read-only; mở 1 FloorTableDetailSheet + PlayerActionSheet để xem (KHÔNG tap Chuyển/Sửa chip/Phiếu/Loại) |
| 4 | `/live/:id` | **SAFE-TO-OPEN** | viewer read-only |
| 5 | `/cashier` | **SAFE-TO-OPEN** | default overview read-only; nút ghi là button-driven |
| 6 | `/tracker` | **SAFE-TO-OPEN** | default live_view read-only |
| 7 | `/tracker/hand-input` | **CODE-ONLY** | console thao tác ván (engine/lock surface); NO-GO 390px hiển nhiên từ code (2 cột) — không cần mở live |
| 8 | `/dealer-swing` | **SAFE-WITH-RULES** | default swing read-only; không tap tên dealer / ô hành động |
| 9 | `/club/admin` | **SAFE-TO-OPEN** | reads + realtime read-only |
| 10 | `/club/admin/accounting-control` | **SAFE-TO-OPEN** | cờ ON nhưng **DỮ LIỆU MẪU / pure client state, KHÔNG network** → an toàn nhất; label `LIVE SHELL / MOCK DATA` |
| 11 | `/club/admin/series-intelligence` | **SAFE-TO-OPEN** | browser-local; CSV local; không ghi khi mount |
| 12 | `/fnb`, `/fnb/admin`, `/fnb/kitchen` | **SAFE-WITH-RULES** | cờ ON; reads khi mount, ghi là button-driven; KHÔNG tap tạo order / đánh dấu xong; kitchen có realtime read-only |
| 13 | `/chip-ops` | **SAFE-TO-OPEN** | RPC read-only |
| 14 | `/club/admin/finance` | **SAFE-TO-OPEN** (label `FLAG OFF (dark)`) | `clubFinanceDashboard`=false → ẩn với người thường; owner super_admin xem được; reads only |

Route CODE-ONLY: **`/tracker/hand-input`** (audit từ code). Mọi route khác: mở được trên prod theo luật trên.

## Thực tế công cụ (cập nhật 2026-07-04)

`claude-in-chrome` **không cài được** trên máy owner → không thể tự lái Chrome-đã-đăng-nhập về 390px.
Ba nguồn bằng chứng thực dụng thay thế, mỗi nguồn ghi rõ:
- **PLAYWRIGHT @390px** cho **trang công khai** (không cần login): landing, live viewer công khai. Ảnh 390px thật.
- **COMPUTER-USE (read-only) trên Chrome owner**: owner tự đăng nhập + điều hướng; tôi chỉ chụp. Owner
  không rành DevTools → chụp ở **desktop width** → xác nhận cấu trúc/nhãn/theme/số-tab, KHÔNG phản ánh layout 390px.
- **CODE** (nguồn chính cho hành vi mobile của màn login): breakpoint, grid-cols, overflow, target size, safe-area.
Mỗi finding gắn nguồn: `[390-real]` · `[desktop-obs]` · `[code]`.

## Per-stop evidence

### Stop 1 — `/` landing (nav shell) · `[390-real]` Playwright 390×844, logged-OUT · LIVE
- **Theme**: Midnight Sakura render đúng ở mobile — nền dark plum #07050A, accent vàng #C9A86A (tiêu đề
  "Tournament Schedule", nút WEEKLY/Login, vòng logo). Xác nhận vault decree đã live trên mobile. `[390-real]`
- **Top bar (fits)**: ☰ trái · logo · chọn ngôn ngữ · Login · chuông. Không overflow ngang.
- **Bottom nav công khai = 5 mục gọn** (Schedule/Partner/·logo·/Coach/Feed) — vừa 390px, target ổn (~44px/ô,
  icon + label 10px). KHÔNG vỡ ở 390 (khác lo ngại "grid-cols-7 vỡ" — lo ngại đó thuộc bản logged-in nhiều mục).
- **🔴 Operator entry (VẬN HÀNH) KHÔNG có trong bottom nav mobile** → bị chôn sau ☰. Floor không có đường
  nhanh một-tay tới vận hành. → **P1 (bản consumer)**; là lý do lõi cho IA `mobileOpsV2` (shell riêng `/ops/*`).
- **PWA**: nút "INSTALL APP" (vàng) nổi trên bottom nav → khớp manifest `display: standalone`.
- Ngôn ngữ hiện EN (phiên playwright mặc định US ENG; phiên owner là VN) — không phải lỗi app.
- **Verdict nav shell (consumer): GO** cho người chơi; **HOLD** cho vai trò vận hành (không có lối vào nhanh).
- Prod URL xác nhận: `vinpoker.vercel.app`.

### Stop 2 — `/floor` (Floor tournament management) · `[desktop-obs]` owner-driven, logged-in real club (ẩn danh "Club X") · LIVE
- Màn thực tế KHÁC mô tả "table_map mặc định": `/floor` mở ra **màn quản lý giải nặng form**, không phải
  view "đi lại trên sàn" gọn. Cấu trúc quan sát: back "← Lịch giải" · badge **FLOOR** (vàng) · tên CLB ·
  select **"Chọn giải"** + **"Làm mới"** · toggle **Giải thưởng / Multi-day** · nhóm **Giải thưởng (3)** với
  nút "Tạo từ ảnh lịch" + "Tạo giải thưởng" · card giải ("Main", giờ, **số tiền/stack đã che**, trạng thái
  "Đang chơi") · khối **Live state** (PLAYERS / LEVEL / BLIND / STATUS) là **ô nhập inline**.
- **🔴 P0-adjacent (mis-tap delete)**: card giải có cụm **4 icon ~20px sát nhau** — bút (sửa) · đồng hồ
  (lịch sử) · list · **thùng rác ĐỎ (xoá)**. Xoá nằm ngay cạnh sửa, không giãn cách, ở 390px = nguy cơ
  bấm nhầm xoá cơ cấu giải (tiền). Master-map §8 target + §15 confirm. → **P1 target-size + P0 mis-tap**.
- **P1 inline money-ish editing**: Live state (BLIND/LEVEL/STATUS) sửa trực tiếp tại chỗ — trên điện thoại
  cần tách/khoá + xác nhận, không để sửa nhầm khi cầm một tay.
- **[code] hành vi 390px**: layout stack 1 cột (whitespace desktop nhiều → dọc dài), grid table-map là
  `grid-cols-3` ở mobile (tap-accuracy kém — xem inventory). Không quan sát trực tiếp ở 390px (owner ở desktop).
- **Verdict: NO-GO cho mobile as-is** — màn quản lý hình-desktop; cần cockpit "Floor hôm nay" riêng
  (đọc nhanh trạng thái, hành động lớn, xoá/tiền phải sau xác nhận). Đây là màn prototype sẽ dựng.

### Các stop còn lại — `[code]` (không làm phiền owner thêm)
`/cashier` · `/tracker` · `/dealer-swing` · `/club/admin` · `/club/admin/accounting-control` (11-tab strip) ·
`/club/admin/series-intelligence` · `/fnb*` · `/chip-ops` · `/tracker/hand-input` (CODE-ONLY): đánh giá mobile
từ bằng chứng code đã thu (grid-cols, tab overflow, target size, safe-area) — chi tiết trong
`iphone-operations-ux-audit.md`. Landing 390px (real) + Floor (desktop real) neo lại độ tin của phân tích code.
