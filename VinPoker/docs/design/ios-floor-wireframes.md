# iOS Floor Wireframes (PR-IOS0, docs-only)

> **Trạng thái: SPEC — chưa triển khai.** Cờ `mobileOpsV2` (OFF). Theme Midnight Sakura. Khung 390pt.
> Tên người chơi/CLB là **hư cấu** (Nguyễn Văn A…), số tiền là ví dụ. Ghi đè master-map §20.1.
> Đi kèm `ios-floor-ux-spec.md` (spec) + `ios-operations-components.md` (component).

## Ký hiệu
`[ ]` nút · `( )` chip/badge · `▸` điều hướng · `≡` sheet handle · `�auto` số realtime · `§` safe-area ·
`══` bottom dock · nền = dark plum, chữ vàng = nhấn, xanh/hổ phách/đỏ = trạng thái.

---

## WF1 — Floor hôm nay (cockpit, `/ops`)
```
§ notch ─────────────────────────────
 Floor hôm nay            (VN) (🔔3)     ← sticky header, safe-area top
──────────────────────────────────────
 GIẢI ĐANG CHẠY
 ┌──────────────────────────────────┐
 │ HSOP Main Event      (Đang chạy) │
 │ Level 12 · 5.000/10.000          │
 │ Còn 84/210  ·  ⏱ 14:32           │▸
 └──────────────────────────────────┘
 BÀN     [12 chạy][3 mở][1 dừng][0 đóng]  ← SegmentedControl lớn
 ┌── Việc kế tiếp ──────────────────┐
 │ ⚠ Bàn 7 cần bốc lại (final table)│
 │ [ Xử lý ngay ]                   │
 └──────────────────────────────────┘
 CẦN XỬ LÝ (4)                    ▸ tất cả
 • Bàn 12 · thiếu dealer      (Trễ giờ)
 • Ghế 3/Bàn 5 · late reg     (Cần xử lý)
 • Lệch đối soát quầy         (Tạm tính)
──────────────────────────────────────
 ══ [ Xem việc cần làm (4) ]  [Sơ đồ bàn] ══  ← BottomActionDock, thumb-zone
 [Hôm nay][Giải đấu][Bàn][Cảnh báo•4][Thêm]   § safe-area bottom
```
- Hành động chính (vàng): "Xem việc cần làm". Empty: "Chưa có giải đang chạy hôm nay ▸ Lịch giải".
- Stale: dải "Cập nhật 14:30 · kéo để làm mới" khi realtime trễ.

## WF2 — Thẻ giải đang chạy (TournamentStatusCard)
```
┌────────────────────────────────────┐
│ HSOP Main Event         (Đang chạy)│  ← chip success
│ Level 12 · 5.000/10.000 · ante 10k │
│ Còn ▸84/210   Trung bình 42.000    │
│ ⏱ 14:32 tới nghỉ   Prize (đọc)     │
│ ─────────────────────────────────  │
│ [Sơ đồ bàn]  [Live tracker]        │  ← không nút sửa tiền/level ở đây
└────────────────────────────────────┘
```
- Sửa level/blind: **không có nút** — "Sửa trên máy tính" (RoleLockedAction) → tránh mis-tap (P0 audit §4.2).

## WF3 — Thẻ bàn (TableStatusCard, lưới 2 cột @390)
```
 ┌── Bàn 7 ──────────┐  ┌── Bàn 8 ──────────┐
 │ (Đang chạy)  ●    │  │ (Cần xử lý) ⚠     │
 │ 9/9 ghế           │  │ 6/9 ghế           │
 │ Dealer: Minh      │  │ Dealer: —  (Thiếu)│
 └───────────────────┘  └───────────────────┘
```
- Card ≥44px, KHÔNG lưới 3 cột chật (sửa P1 §4.3). Tap → WF sheet chi tiết bàn.
- Cần xử lý nổi màu hổ phách; thiếu dealer = viền đỏ. Occ/max mono.

## WF4 — Sheet hành động người chơi (tái dùng PlayerActionSheet)
```
 ──────────── ≡ ────────────
 Bàn 7 · Ghế 4 — Nguyễn Văn A
 ┌─────────────┬─────────────┐
 │ ↔ Chuyển    │ ◎ Sửa chip  │   ← lưới lớn, ô ≥64px
 │ bàn/ghế     │ điều chỉnh  │
 ├─────────────┼─────────────┤
 │ 🧾 Phiếu    │ ⛔ Loại     │   ← Loại = đỏ, mở modal xác nhận
 │ xem/in      │ bust out    │
 └─────────────┴─────────────┘
 ▸ Thông tin người chơi
```
- "Loại" → **WF9-style modal** (BustConfirmDialog đã có) restate hạng + tiền. Swipe KHÔNG dùng cho Loại.

## WF5 — Luồng redraw (RedrawLauncherDialog)
```
 Bốc lại bàn — HSOP Main
 Kiểu:  (Final table)  ( ITM )  ( Ngưỡng )  ( Thủ công )
 ┌── Xem trước ─────────────────────┐
 │ Bàn 1: A, B, C, D …              │
 │ Bàn 2: E, F, G …                 │  ← preview bắt buộc
 │ → 9 bàn · 84 người               │
 └──────────────────────────────────┘
 ══ [ Huỷ ]     [ Xác nhận bốc lại ] ══   ← nút chính destructive-tint
```
- Nếu số bàn đổi giữa preview→confirm → buộc xem lại. Điều kiện chưa đủ → disable + lý do.

## WF6 — Kết quả tra cứu người chơi (PlayerLookupCard)
```
 🔎 [ Tìm tên / SĐT …           ]
 ┌────────────────────────────────────┐
 │ Nguyễn Văn A     090•••••23  (masked)│
 │ (Đang chơi) · Bàn 7 · Ghế 4         │
 │ Lượt vào #1 · vào 13:20             │
 │ [ Tới bàn ]   [ Phiếu ]             │
 └────────────────────────────────────┘
```
- SĐT masked (như `lookup_member_for_buyin`). Full money history chỉ owner/admin/self. Empty: "Không tìm thấy — kiểm tra SĐT".

## WF7 — Thẻ trạng thái dealer (DealerStatusCard)
```
 ┌────────────────────────────────────┐
 │ Bàn 7 · Dealer Minh      (Đang bàn)│  ← --ds-active xanh
 │ Vào 13:00 · 1h20m                  │
 ├────────────────────────────────────┤
 │ Bàn 12 · —               (Thiếu)   │  ← đỏ
 │ Chờ phân dealer                    │
 ├────────────────────────────────────┤
 │ Nghỉ: Lan (14:05, còn 8m)  (Nghỉ)  │  ← --ds-rest mauve
 └────────────────────────────────────┘
 ══ [ Mở Dealer Swing ] ══  (thao tác nặng = luồng hiện có)
```

## WF8 — Hàng đợi sự cố (AlertQueueItem, `/ops/alerts`)
```
 CẦN XỬ LÝ (4)                 (mới nhất)
 ┌────────────────────────────────────┐
 │ ⚠ Bàn 7 cần bốc lại   (Cần xử lý)  │▸
 │ Bàn 12 thiếu dealer   (Trễ giờ)    │▸
 │ Ghế 3/Bàn 5 late reg  (Cần xử lý)  │▸
 │ Lệch đối soát quầy    (Tạm tính)   │▸  ← tài chính = read-only
 └────────────────────────────────────┘
 ══ [ Xử lý mục đầu ] ══
```
- Empty tích cực: "Không có sự cố — mọi thứ ổn". Mục người khác xử lý rồi → gạch + "đã xử lý".

## WF9 — Sheet chi tiết cảnh báo (khi tap 1 mục sự cố)
```
 ──────────── ≡ ────────────
 ⚠ Bàn 7 cần bốc lại
 Lý do: đã vào final table (9→8 người)
 Ảnh hưởng: đảo ghế 9 bàn · 84 người
 ┌── gợi ý ──────────────────────────┐
 │ Mở luồng "Bốc lại" (final table)  │
 └────────────────────────────────────┘
 ══ [ Để sau ]   [ Mở bốc lại ▸ ] ══
```
- "Để sau" = đánh dấu (không xoá). "Mở bốc lại" → WF5 (có preview + xác nhận).

## WF10 — Xem trước cảnh báo Tài chính (FinancialWarningCard, read-only)
```
 TÀI CHÍNH & ĐỐI SOÁT           (DỮ LIỆU MẪU)
 ┌────────────────────────────────────┐
 │ Còn lại sau lương     (Tạm tính)   │  ← KHÔNG "Lãi ròng"
 │ 12.400.000 đ  *chưa trừ CP vận hành│
 ├────────────────────────────────────┤
 │ Tiền chuyển hộ (prize/ký quỹ)      │
 │ 210.000.000 đ  · Nợ phải trả       │  ← KHÔNG phải doanh thu
 ├────────────────────────────────────┤
 │ Lệch đối soát quầy    (Lỗi đối soát)│
 │ −350.000 đ  · cần giải trình       │
 └────────────────────────────────────┘
 ▸ Mở Tài chính & Đối soát trên máy tính   (owner)
```
- Floor: KHÔNG nút sửa tiền (RoleLockedAction). Mọi số gắn Tạm tính/Đã chốt + thời điểm. "Biên đóng góp ≠ Lợi nhuận".

## WF11 — Xem trước F&B (link trạng thái, `/ops/more`)
```
 F&B                       (5 đơn chờ)
 ┌────────────────────────────────────┐
 │ Quầy: 3 đơn chưa thanh toán        │
 │ Bếp: 2 đơn đang làm                │
 │ Doanh thu ca (toàn CLB, không chia │
 │ theo giải): xem trên máy tính      │
 └────────────────────────────────────┘
 [ Mở quầy F&B ]  [ Màn bếp ]
```
- F&B luôn "toàn CLB, không chia theo giải" (doctrine). Wave 2.

## WF12 — Lối vào xem ván trực tiếp (Tracker/live preview)
```
 ┌────────────────────────────────────┐
 │ ▶ Bàn đang chơi — HSOP Main        │
 │ Ván #142 · pot 45.000 · 3 người    │
 │ [ Xem trực tiếp ]                  │  ← mở /live/:id (đã responsive, GO)
 └────────────────────────────────────┘
 Nhập hand (thao tác) → "Mở trên máy tính"   ← console 2 cột = desktop-only
```
- Xem = viewer mobile (đã ổn). Nhập hand (ghi ván) = desktop-only (NO-GO §4.6a).

## Bảng thuật ngữ (copy chuẩn — dùng verbatim)
| Sai (cấm) | Đúng |
|-----------|------|
| Kế toán | **Tài chính & Đối soát** |
| Lãi ròng (cho doanh thu−lương) | **Còn lại sau lương** (*chưa phải lãi ròng cuối cùng*) |
| Lợi nhuận (cho biên đóng góp) | **Biên đóng góp** (≠ Lợi nhuận) |
| Doanh thu (cho prize/escrow) | **Tiền chuyển hộ** · **Nợ phải trả** |
| số tài chính trần | luôn kèm **(Tạm tính)** / **(Đã chốt)** + thời điểm |
| F&B theo giải | **F&B toàn CLB, không chia theo giải** |
| dữ liệu demo hiện như thật | nhãn **(DỮ LIỆU MẪU)** |
