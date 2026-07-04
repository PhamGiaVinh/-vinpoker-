# iOS Operations — Component Pattern Library (PR-IOS0, docs-only)

> **Trạng thái: SPEC — chưa triển khai.** Cờ `mobileOpsV2` (OFF). Theme Midnight Sakura (token có sẵn).
> Base SHA `e194571d`. Ghi đè master-map §20.1. Props = **ý niệm**, không phải TS thật (chưa viết code).

## 0. Nguyên tắc chung
- Nền shadcn có sẵn (`ui/*`): `Sheet` side="bottom", `Drawer` (Vaul), `AlertDialog`, `Badge`, `Card`, `Button`.
  **Tái dùng**, không dựng lại. Bottom nav/shell **nhân bản** `DealerAppShell`/`DealerBottomNav` pattern.
- **Mọi component có 5 state**: default · loading (skeleton) · empty · error · **stale** (realtime cũ). Bắt buộc.
- Target ≥44pt · chữ ≥11px · safe-area `env(safe-area-inset-*)` · không hover-only · không màu hardcode (dùng token).
- **An toàn**: component tiền/nguy hiểm phải gate vai trò + xác nhận restate (§15 master-map). Mock → nhãn.

## 1. SafeAreaPageShell
- **Mục đích**: khung trang `/ops/*` — header sticky + nội dung + bottom nav, safe-area mọi cạnh.
- **Props**: `title`, `headerRight?`, `children`, `bottomNav` (MobileTabScroller/BottomNav), `back?`.
- **Visual**: `max-w-md mx-auto`; header `sticky top-0 pt-[env(safe-area-inset-top)] bg-background/85 backdrop-blur-xl`;
  main `pb-[calc(5.5rem+env(safe-area-inset-bottom))]`. Nền `--background`.
- **Role/safety**: bọc guard vai-trò-vận-hành + `mobileOpsV2` (redirect nếu OFF).
- **Copy**: back = "Quay lại" (BackButton hiện có).
- **iPhone**: notch/home-indicator an toàn; một tay; không body h-scroll.
- **Từ**: `DealerAppShell.tsx`.

## 2. MobileTabScroller (+ bottom nav)
- **Mục đích**: bottom nav 5 tab cố định (Hôm nay/Giải đấu/Bàn/Cảnh báo/Thêm); cũng dùng cho tab-strip cuộn ngang
  khi cần (thay 11-tab squeeze của Tài chính).
- **Props**: `items[{key,label,icon,badge?,to}]`, `active`, `variant: "bottomFixed"|"scrollPills"`.
- **Visual**: bottomFixed = `fixed bottom-0 grid-cols-5 h-[64px] pb-[env(safe-area-inset-bottom)]`, icon 5px + label
  10px, active có glow vàng. scrollPills = `overflow-x-auto` pill ≥44px, `[scrollbar-width:none]`.
- **Role/safety**: item ẩn theo vai trò (role map IA §5).
- **Copy**: "Hôm nay", "Giải đấu", "Bàn", "Cảnh báo", "Thêm".
- **iPhone**: 5 tab max (chuẩn iOS); badge số trên "Cảnh báo".
- **Từ**: `DealerBottomNav.tsx` (bottomFixed) · MediaCenter scroll-pills (scrollPills).

## 3. OperationStatusChip
- **Mục đích**: 1 chip trạng thái vận hành, màu semantic.
- **Props**: `status: 'running'|'todo'|'late'|'noDealer'|'waitCashier'|'settled'|'provisional'|'reconcileError'`.
- **Visual**: map màu — Đang chạy=success · Cần xử lý=warning · Trễ giờ=destructive · Thiếu dealer=destructive ·
  Chờ cashier=accent · Đã chốt=primary · Tạm tính=muted · Lỗi đối soát=destructive. Nền = màu/12%, chữ = màu-đậm.
- **Role/safety**: thuần hiển thị.
- **Copy**: "Đang chạy" · "Cần xử lý" · "Trễ giờ" · "Thiếu dealer" · "Chờ cashier" · "Đã chốt" · "Tạm tính" · "Lỗi đối soát".
- **iPhone**: chữ ≥11px; không chỉ dựa màu (kèm chữ) cho accessibility.
- **Từ**: `ui/badge.tsx` + token semantic.

## 4. TodayTaskCard
- **Mục đích**: 1 "việc kế tiếp" nổi bật trên Hôm nay.
- **Props**: `severity`, `title`, `context`, `primaryAction{label,to}`.
- **Visual**: card `--card`, viền trái màu severity, hành động vàng lớn (thumb-zone).
- **Role/safety**: hành động dẫn tới luồng có xác nhận riêng.
- **Copy**: "⚠ Bàn 7 cần bốc lại (final table)" · [ "Xử lý ngay" ].
- **iPhone**: 1 card/màn; empty → ẩn.
- **Từ**: `ui/card.tsx`.

## 5. TournamentStatusCard
- **Mục đích**: tóm tắt 1 giải đang chạy.
- **Props**: `name,status,level,blinds,ante,remaining,total,avgStack,timeToBreak,prizePool(read)`.
- **Visual**: số quan trọng mono to; chip status; 2 nút "Sơ đồ bàn"/"Live tracker"; **không nút sửa tiền/level**.
- **Role/safety**: sửa level/blind = RoleLockedAction "Sửa trên máy tính" (tránh P0 mis-tap §4.2).
- **Copy**: "Level 12 · 5.000/10.000", "Còn 84/210", "⏱ 14:32 tới nghỉ".
- **iPhone**: một tay đọc-liếc; prize = đọc.
- **Từ**: `TournamentLivePanel` header data (players_remaining sẵn).

## 6. TableStatusCard
- **Mục đích**: 1 bàn trong Bàn (lưới 2 cột @390).
- **Props**: `tableNo,status,occ,max,dealerName?,needsFloor?`.
- **Visual**: card ≥44px; occ/max mono; needsFloor = hổ phách; thiếu dealer = viền đỏ. KHÔNG lưới 3 cột (sửa P1 §4.3).
- **Role/safety**: tap = mở sheet (đọc); hành động trong sheet.
- **Copy**: "Bàn 7 · (Đang chạy) · 9/9 · Dealer: Minh".
- **iPhone**: 2 cột/390; list 1 cột khi bật "chi tiết".
- **Từ**: `FloorTableMapPanel` (grid → card).

## 7. PlayerLookupCard
- **Mục đích**: kết quả tra cứu 1 người chơi.
- **Props**: `name,maskedPhone,status,table?,seat?,entryNo,fullHistory?(gated)`.
- **Visual**: tên + SĐT masked; chip trạng thái; 2 nút "Tới bàn"/"Phiếu".
- **Role/safety**: **PII** — full money history chỉ owner/admin/self; cashier/floor thấy masked (split RPC hiện có).
- **Copy**: "Nguyễn Văn A · 090•••••23 · (Đang chơi) · Bàn 7/Ghế 4".
- **iPhone**: sheet từ search; debounce.
- **Từ**: `lookup_member_for_buyin` (masked) / `get_member_history` (gated).

## 8. DealerStatusCard
- **Mục đích**: trạng thái 1 dealer/bàn.
- **Props**: `dealerName?,tableNo,state:'active'|'rest'|'preassign'|'missing',since?,overtime?`.
- **Visual**: token `--ds-active/--ds-rest/--ds-preassign`; missing = đỏ; overtime badge.
- **Role/safety**: read-only ở mobile; hành động swing = luồng hiện có.
- **Copy**: "Bàn 7 · Dealer Minh · (Đang bàn) · 1h20m", "(Thiếu)".
- **iPhone**: KHÔNG mobile-hoá payroll.
- **Từ**: `dealer_shift_assignments` read-only + `--ds-*` token.

## 9. AlertQueueItem
- **Mục đích**: 1 dòng trong hàng đợi Cảnh báo/sự cố.
- **Props**: `type,severity,subject,time,to`.
- **Visual**: icon + subject + chip severity; tap = ▸ chi tiết/luồng.
- **Role/safety**: tài chính = read-only; hành động sửa mở luồng có xác nhận.
- **Copy**: "⚠ Bàn 7 cần bốc lại (Cần xử lý)".
- **iPhone**: swipe CHỈ "để sau" (đánh dấu), không xoá.
- **Từ**: tổng hợp client (reconcile/redraw/late-reg nguồn hiện có).

## 10. BottomActionDock
- **Mục đích**: thanh hành động chính cố định đáy (thumb-zone), safe-area.
- **Props**: `primary{label,onPress,tone}`, `secondary?{label,onPress}`.
- **Visual**: `fixed bottom-[env(safe-area-inset-bottom)]` phía trên bottom nav; nút chính vàng lớn; destructive-tint khi nguy hiểm.
- **Role/safety**: nút nguy hiểm → mở ConfirmActionSheet (không hành động trực tiếp).
- **Copy**: "Xem việc cần làm (4)", "Xác nhận bốc lại".
- **iPhone**: không che nội dung (main có padding); 1 primary/màn.
- **Từ**: mới (mẫu từ InstallPWAButton fixed + sonner safe-area offset).

## 11. ConfirmActionSheet
- **Mục đích**: xác nhận hành động nguy hiểm, **restate số tiền/hậu quả**.
- **Props**: `title,restateLines[],confirmLabel,tone:'danger',onConfirm`.
- **Visual**: AlertDialog/Drawer; dòng restate rõ; nút xác nhận destructive; huỷ outline.
- **Role/safety**: BẮT BUỘC cho Loại/xoá/redraw/tiền (§15). Không auto-close khi đang gọi (spinner).
- **Copy**: "Loại Nguyễn Văn A · hạng 3 · 3.000.000 đ" · [Huỷ][Xác nhận].
- **iPhone**: nút to; không nhầm; không swipe-to-confirm.
- **Từ**: `BustConfirmDialog.tsx` (tiền lệ) + `ui/alert-dialog.tsx`.

## 12. RoleLockedAction
- **Mục đích**: hiện hành động nhưng **khoá theo vai trò** hoặc **desktop-only**, nêu lý do.
- **Props**: `label,reason,mode:'roleLocked'|'desktopOnly',to?`.
- **Visual**: nút mờ + khoá; tap → tooltip/sheet lý do; desktopOnly → "Mở trên máy tính".
- **Role/safety**: cốt lõi để floor **không thao tác tiền**; thay vì ẩn hẳn → giải thích (đỡ hoang mang).
- **Copy**: "Sửa trên máy tính", "Cần quyền chủ CLB / thu ngân".
- **iPhone**: không phải nút disabled câm — có lý do khi chạm.
- **Từ**: tiền lệ tooltip "Cần quyền…" trong `PlayerActionSheet`.

## 13. RealtimeStaleBanner
- **Mục đích**: báo số liệu realtime đã cũ / mất mạng.
- **Props**: `lastUpdated,online,onRefresh`.
- **Visual**: dải mảnh trên nội dung; hổ phách khi stale, đỏ khi offline; nút "Thử lại".
- **Role/safety**: không bao giờ giả vờ số mới; giữ số cũ + nhãn thời điểm.
- **Copy**: "Cập nhật 14:30 · kéo để làm mới", "Mất mạng — đang thử lại".
- **iPhone**: pull-to-refresh; ngưỡng stale 30s khi xem live.
- **Từ**: mới (dựa poll pattern `LIVE_ACTION_POLL_MS`).

## 14. FinancialWarningCard
- **Mục đích**: hiển thị cảnh báo tài chính **read-only**, đúng doctrine.
- **Props**: `metricLabel,value,state:'provisional'|'final',note?,isPassThrough?,isMock?`.
- **Visual**: nhãn + số; badge **Tạm tính/Đã chốt**; passThrough → "Nợ phải trả/Tiền chuyển hộ"; mock → "DỮ LIỆU MẪU".
- **Role/safety**: **KHÔNG nút sửa tiền** cho floor (RoleLockedAction). Không hiện số trần không có trạng thái.
- **Copy**: "Còn lại sau lương (Tạm tính) · *chưa trừ CP vận hành*", "Tiền chuyển hộ · Nợ phải trả", "Biên đóng góp ≠ Lợi nhuận".
- **iPhone**: chỉ đọc; owner → "Mở Tài chính & Đối soát trên máy tính".
- **Từ**: doctrine `09-ACCOUNTING-CONTROL` + tiền lệ `accounting-control-ui.md`.

## 15. CompactMetricCard
- **Mục đích**: ô số tóm tắt (còn lại, số bàn, cảnh báo…).
- **Props**: `label,value,unit?,tone?`.
- **Visual**: label 13px muted trên, số 24px/500 dưới; nền `--muted`/nhẹ; không viền; grid 2–4 ô gap-12.
- **Role/safety**: round số (không leak float); tiền qua formatVND; số đếm không có "đ".
- **Copy**: "Còn lại 84/210", "Bàn chạy 12".
- **iPhone**: grid `repeat(auto-fit,minmax(0,1fr))` không tràn.
- **Từ**: tiền lệ MoneyCard/metric ở `accounting-control` (unit "count" vs "đ").

## Ma trận component × màn

| Component | Hôm nay | Giải | Bàn | Xếp/redraw | Người chơi | Dealer | Cảnh báo | Tài chính |
|-----------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| SafeAreaPageShell | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MobileTabScroller | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| OperationStatusChip | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ |
| TodayTaskCard | ✓ | | | | | | | |
| TournamentStatusCard | ✓ | ✓ | | | | | | |
| TableStatusCard | ✓ | | ✓ | | | | | |
| PlayerLookupCard | ✓ | | ✓ | | ✓ | | | |
| DealerStatusCard | ✓ | | | | | ✓ | ✓ | |
| AlertQueueItem | ✓ | | | | | | ✓ | |
| BottomActionDock | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | |
| ConfirmActionSheet | | ✓ | ✓ | ✓ | | | ✓ | |
| RoleLockedAction | | ✓ | ✓ | | ✓ | ✓ | | ✓ |
| RealtimeStaleBanner | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| FinancialWarningCard | | | | | | | ✓ | ✓ |
| CompactMetricCard | ✓ | ✓ | ✓ | | | | ✓ | ✓ |
