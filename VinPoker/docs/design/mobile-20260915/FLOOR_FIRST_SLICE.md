# Floor mobile — first bounded redesign slice

Status: SOURCE IMPLEMENTED / LOCAL UI E2E PASS. Không sửa RPC, Edge, mode rules, permission, flag, chip hoặc payout.

Implementation receipt (2026-09-15):

- Floor V3 sheet dùng safe-area theo bốn cạnh; nút đóng 48×48 và nhãn screen-reader tiếng Việt.
- Danh sách chính chỉ hiển thị session đang hoạt động; không gộp hoặc giấu hai assignment lịch sử bằng số bàn.
- Ghế trống mở danh sách entry ngay, không autofocus; tìm theo tên/số entry và tách `Chưa có ghế` / `Đã loại`.
- Bust, đóng bàn trống và đóng/chuyển người đều có bước xác nhận; bust nêu người, entry, bàn, ghế, chip và mode.
- Tracker còn chip bị chặn ngay tại UI với lý do; server vẫn là authority cuối.
- Load/mutation bị mất mạng luôn nhả trạng thái busy, báo chưa xác nhận thay đổi và refetch fail-closed.
- Player bottom navigation và nút cài PWA không còn che route `/floor` trên mobile.
- Local Chromium fixture PASS tại 360×800, 390×844, 430×932, 768×1024, 1024×768, 1280×900 và 1920×1080. Đây không phải Safari iPhone thật và không chứng minh RPC/DB live.

## Wireframe phone (placeholder, không dữ liệu live)

```text
[safe top]
< Danh sách bàn       Bàn 5     Đóng     [sticky header]
Tên giải · CLB             3/9 ghế
Manual · Đổi chế độ                      [disclosure]
──────────────────────────────────────
1  Người chơi A              30.000      [scroll roster]
2  Người chơi B              25.000
3  Ghế trống             + Thêm người
4–9 ... luôn đủ hàng theo contract
──────────────────────────────────────
Thao tác bàn…                            [safe footer]
[safe bottom]
```

```text
< Bàn 5             Chọn người          [single task layer]
Giải … · Ghế 3                          [sticky context]
[ Tìm tên hoặc mã entry… ]              [search, no autofocus]
Chưa có ghế (N) | Đã loại (M)           [explicit status groups]
○ Người chơi A · Entry …                [scroll list]
○ Người chơi B · Entry …
Không thấy người? Kiểm tra đăng ký giải.
──────────────────────────────────────
Đã chọn … → Bàn 5 · Ghế 3
[ Xếp vào ghế ]                         [48px safe footer]
```

Tab Đã loại thay CTA bằng “Khôi phục vào ghế”, mở confirmation đúng existing restore contract. Không gọi Add để tự tạo lại player. Không có danh sách chờ giả: chỉ gọi “Chưa có ghế” cho tập entry server xác nhận đủ điều kiện.

## Desktop / tablet

```text
CLB → Giải → Bàn                         [sticky context]
Danh sách + tìm bàn | Roster bàn đã chọn | Thao tác theo selection
Đang dùng / Lịch sử | 9 hàng              | mode / player / close
```

Phone một pane. Tablet portrait list-detail khi đủ chỗ, nếu không giữ một pane; landscape/desktop mở2pane, action pane thứ3 chỉ khi không làm roster hẹp. Giữ selected assignment/entry qua resize, không map bằng số bàn/tên.

## Tám interaction contracts

1. Mở bàn: giữ giải/CLB, load snapshot; lỗi không mount actionable roster cũ.
2. Nhấn ghế trống: nhớ đúng ghế, mở list đủ điều kiện; nếu hết ghế sau refresh, giải thích và yêu cầu chọn lại.
3. Search/list: match tên/mã entry trong dữ liệu được phép, không tìm toàn auth users; chọn bằng entryID. Không có kết quả không đồng nghĩa lỗi mạng.
4. Khôi phục: chỉ từ busted list server; tách khỏi add/re-entry/buy-in. Server kiểm lại điều kiện tại submit.
5. Người đang ngồi nhầm bàn: mở Chuyển theo source/destination thật; không hiển thị như người chưa có ghế. Nếu read contract chưa cho nguồn này, giữ thao tác Chuyển ở roster, không query rộng.
6. Loại: confirmation nêu đúng người/entry/bàn/mode/chip và ảnh hưởng; giữ active-hand/Tracker rules. Server reject giữ lựa chọn và lỗi; không sửa chip để vượt guard.
7. Đóng: bàn trống là Close, bàn có người là Đóng & chuyển người; history không có Close. Confirm trước server call, chỉ đóng UI khi response hợp lệ và refresh.
8. Back/Đóng: lớp chọn người → roster → table list; giữ vị trí cuộn. Không browser-back tùy ý về app chính; Android Back/Escape không gây mutation.

## State matrix (10)

Loading; ready roster; empty table; entry-list empty; search no matches; selected entry; submitting; server rejected/stale; offline/load failed; history closed read-only. Mode unavailable có lý do ngay trong ready state. Request failure không blank dữ liệu rồi nói thành công.

## File allowlist dự kiến khi implement

- `src/components/cashier/tournament-live/FloorTableDetailSheet.tsx`
- `src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx`
- `src/components/cashier/tournament-live/FloorTableMapPanel.tsx` (chỉ filter/history/presentation; không đổi writer)
- `src/components/ops/shared/FloorSeatRoster.tsx`
- `src/components/cashier/tournament-live/AddPlayerDialog.tsx` chỉ sau chọn đúng consumer/data seam; không lén chuyển legacy RPC.
- `src/components/ui/sheet.tsx` chỉ nếu scoped composition không đủ, cần shared-consumer tests.
- Relevant tests/locales; `Layout.tsx` route-specific shell là follow-up nhỏ, không redesign global nav toàn app.

Cấm trong slice: migrations, Edge, production flag, auth/RLS, shared authority adapters, chip arithmetic, cleanup TEST live. Không tạo infrastructure cho tất cả module.

## Verification cần chạy sau implement

390×844,430×932,360×800,412×915,768×1024,1024×768,1280 desktop; thêm200%text/landscape/long names/large chips. Browser screenshots trước-sau; rects không overflow, targets>=48; close/footer trong viewport; keyboard không che CTA; focus và reduced-motion. Emulation không được gọi là Safari iPhone thật.

Local TEST: entry search/select/restore disjoint; wrong-club denied; stale seat refresh; no implicit free-name creation; no money RPC. UI-only fixture không chứng minh backend đồng bộ. Phil/Tom failure phải được tái hiện và xác định riêng, không đánh dấu fixed sau thay giao diện.

## Review kết thúc specification

iOS: safe controls + keyboard-first layout; Android: IME/Back/touch; accessibility: labels/focus/text/noncolor; anti-slop: dense roster và một CTA thay nested cards. Tất cả là design review, chưa runtime PASS.
