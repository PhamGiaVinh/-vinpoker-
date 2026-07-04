# iPhone Operations — Information Architecture (PR-IOS0, docs-only)

> **Trạng thái: SPEC — chưa triển khai.** Cờ đề xuất `mobileOpsV2` (mặc định OFF, chưa tồn tại).
> Base SHA `e194571d`. **Ghi đè `uiux-master-map.md` §20.1** → chuẩn màu = **Midnight Sakura**
> (`src/index.css:8–113`, PR #665). Xem `iphone-operations-ux-audit.md` cho verdict từng màn.

## 1. Nguyên tắc

- **Thumb-zone**: hành động chính nằm ⅓ dưới màn (bottom dock / bottom sheet), không phải góc trên.
- **Target ≥ 44pt** (master-map §8). **Một tay, đứng, ồn, nhiều gián đoạn** = thiết kế cho lỗi hồi phục được.
- **PWA standalone**: tôn trọng `env(safe-area-inset-*)` (notch + home indicator) — như `DealerAppShell`.
- **Midnight Sakura** tokens có sẵn (`--background/--card/--primary/--accent/--foreground` + semantic green/amber/red).
  KHÔNG chế token mới.
- **Floor không thao tác tiền/kế toán**: tiền chỉ hiển thị **read-only cảnh báo**; hành động tiền vẫn ở luồng
  hiện có (cashier/owner, có xác nhận restate amount).
- **Sự thật > trang trí**: không giấu cảnh báo tài chính/trạng thái sau hiệu ứng; mock luôn dán nhãn.

## 2. Bản đồ 13 surface hiện có → IA mobile

| Surface hiện có | Route | Vai trò | Verdict (audit) | Vị trí IA mobile |
|-----------------|-------|---------|-----------------|------------------|
| Landing/nav | `/` | mọi người | HOLD | Ngoài `/ops` (consumer) |
| Quản lý giải Floor | `/floor` | floor/cashier/admin | NO-GO | **Bàn** + **Giải đấu** (tách cockpit) |
| Table map + sheets | `/floor` | floor | HOLD | **Bàn** (map → sheet) |
| Xếp ghế/redraw | dialogs | floor/cashier | HOLD | **Bàn** (sheet/modal) |
| Cashier | `/cashier` | cashier/admin | HOLD | **Thêm → Cashier (lite)** (Wave 2) |
| Tracker operator | `/tracker/hand-input` | tracker | NO-GO | Desktop-only ("Mở trên máy tính") |
| Public viewer | `/live/:id` | public/operator | GO | Link từ **Giải đấu** (đã ổn) |
| Dealer Swing | `/dealer-swing` | floor/admin | NO-GO(payroll) | **Dealer** (card, Wave 2) |
| Dealer app | `/dealer/*` | dealer | (đã mobile) | Riêng — KHÔNG đụng |
| Club admin | `/club/admin` | owner/admin | — | **Thêm** (đa số desktop) |
| Tài chính & Đối soát | `/club/admin/accounting-control` | owner/admin | NO-GO | **Cảnh báo** + **Thêm** (thẻ read-only) |
| Series Intelligence | `/club/admin/series-intelligence` | owner/admin | NO-GO | Desktop-only |
| F&B | `/fnb*` | fnb/admin | HOLD | **Thêm → F&B status** (Wave 2) |
| Chip Ops | `/chip-ops` | chip-master | — | **Thêm** (read-only) |

## 3. Bottom-tab / sheet / modal / desktop-only

**Quy tắc quyết định (một câu)**: *sheet (Vaul, đáy) cho DUYỆT/HÀNH-ĐỘNG-trên-danh-sách; modal dialog CHỈ
cho xác nhận nguy hiểm (phải restate số tiền); màn thao-tác-nặng hình-desktop → desktop-only.*

| Loại | Dùng cho | Ví dụ |
|------|----------|-------|
| **Bottom tab** (5, cố định) | điều hướng gốc | Hôm nay · Giải đấu · Bàn · Cảnh báo · Thêm |
| **Bottom sheet** (Vaul, `max-h-85vh`) | chi tiết + hành động thường | chi tiết bàn, hành động người chơi, tra cứu người chơi |
| **Modal dialog** (AlertDialog) | xác nhận nguy hiểm | Loại (BustConfirm đã có), xoá giải thưởng, redraw |
| **Desktop-only** | thao-tác-nặng/phân-tích | hand-input console, Series Intelligence, cockpit Tài chính đầy đủ, sửa payroll |

## 4. IA mobile — 5 bottom tab (chốt với owner)

> Owner chốt: **KHÔNG để "Tài chính" thành bottom tab của floor.** Tài chính chỉ là **cảnh báo read-only**
> dưới **Cảnh báo** / **Thêm**, không cho thao tác tiền.

```
┌───────── mobileOpsV2 · /ops/* (SafeAreaPageShell) ─────────┐
│  [Hôm nay]  [Giải đấu]  [Bàn]  [Cảnh báo•]  [Thêm]         │  ← bottom nav (safe-area)
└────────────────────────────────────────────────────────────┘
```

1. **Hôm nay** (`/ops`) — cockpit mở đầu. Trả lời 5 giây: giải nào chạy · bàn nào cần floor · dealer bất
   thường · việc tiếp theo · có cảnh báo tiền/redraw/late-reg không. (Chi tiết: `ios-floor-ux-spec.md`.)
2. **Giải đấu** (`/ops/tournaments`) — danh sách giải đang chạy/sắp tới; tap → điều khiển nhanh giải + link
   Tracker/viewer + cơ cấu giải thưởng (đọc; sửa = mở máy tính hoặc luồng hiện có có xác nhận).
3. **Bàn** (`/ops/tables`) — table map (card ≥44px, KHÔNG lưới 3 cột chật) → tap bàn = sheet chi tiết →
   tap người = `PlayerActionSheet` (Chuyển/Sửa chip/Phiếu/Loại) → xác nhận nguy hiểm = modal restate.
4. **Cảnh báo** (`/ops/alerts`) — hàng đợi việc-cần-xử-lý: redraw, ghế/late-reg, dealer thiếu/quá giờ,
   **cảnh báo Tài chính read-only** (Tạm tính/Đã chốt, "Còn lại sau lương", lệch đối soát). Badge số trên tab.
5. **Thêm** (`/ops/more`) — Người chơi (tra cứu = sheet), Dealer status, Cashier (lite, Wave 2), F&B status,
   Chip Ops (read-only), và **link desktop-only** ("Mở trên máy tính": hand-input, Series, cockpit Tài chính đầy đủ).

**Người chơi** = **search sheet** gọi từ Hôm nay + Bàn (không tốn 1 tab). **Dealer** = tab chỉ hiện cho vai
trò quản-lý-dealer; vai trò khác → nằm trong Thêm.

## 5. Role map (mirror MODE_TABS precedent)

Theo tiền lệ `TournamentLivePanel.tsx` MODE_TABS (floor/full/tracker đã chứng minh tab-set theo vai trò chạy được).

| Vai trò (`useAuth`) | Bottom tabs thấy | Ghi chú |
|---------------------|------------------|---------|
| **floor** (`isFloor`) | Hôm nay · Giải đấu · Bàn · Cảnh báo · Thêm | full ops |
| **cashier** (`isCashier`) | Hôm nay · Giải đấu · Bàn · Cảnh báo · Thêm(+Cashier) | Cashier-lite trong Thêm |
| **tracker** (`isTracker`) | Hôm nay · Giải đấu · (Bàn read) · Thêm | thao tác hand-input = desktop |
| **dealer-manager** (floor+dealer) | + **Dealer** thay vị trí phù hợp | tab Dealer chỉ vai trò này |
| **owner/admin** (`isClubOwner/isClubAdmin`) | tất cả + **Cảnh báo** (gồm thẻ Tài chính) | link cockpit đầy đủ = desktop |
| **dealer** (chỉ `isDealer`) | — dùng `/dealer/*` sẵn có | KHÔNG vào `/ops` |

Gate: **component-level** (`isFloor && …`) như tiền lệ, không chỉ route guard. Route `/ops/*` bọc trong
guard vai-trò-vận-hành + `mobileOpsV2`.

## 6. Flag map

| Surface trong `/ops` | Cờ gate | Trạng thái backend |
|----------------------|---------|--------------------|
| Toàn bộ `/ops/*` shell | `mobileOpsV2` (mới, OFF) | UI-only, mock trước |
| Bàn (table ops) | `floorTableOps` (ON) | RPC live — chỉ tái dùng, không thêm |
| Loại (out-confirm) | `floorOutConfirm` (ON) | đã live (#671/#676) |
| Thẻ Tài chính read-only | `accountingControl` (ON, **MOCK**) | dán nhãn DỮ LIỆU MẪU |
| Cashier-lite | `cashierRegistrations`/`offlineBuyIn` (ON) | Wave 2 |
| F&B status | `fnbModule`/`fnbCounter` (ON) | Wave 2 |
| Link desktop-only | — | chỉ điều hướng |

`mobileOpsV2` OFF ⇒ `/ops/*` redirect, không mount gì → prod không đổi 1 byte.

## 7. Route plan

```
/ops                     → Hôm nay (cockpit)
/ops/tournaments         → Giải đấu (list) → /ops/tournaments/:id (điều khiển nhanh)
/ops/tables              → Bàn (map) → sheet chi tiết bàn / người chơi
/ops/alerts              → Cảnh báo (queue, gồm thẻ Tài chính read-only)
/ops/more                → Thêm (Người chơi sheet · Dealer · Cashier-lite · F&B · Chip · link desktop)
```
Tất cả dưới `SafeAreaPageShell` (max-w-md, sticky safe-area header, fixed bottom nav). Deep-link vào route
cũ khi Wave chưa dựng lại, dùng `BackButton.tsx` (deep-link-safe) để quay về.

## 8. Chung sống với app hiện tại (KHÔNG phá)

- `mobileOpsV2` tạo **subtree `/ops/*` mới** + `SafeAreaPageShell` **nhân bản** từ `DealerAppShell` pattern
  (max-w-md · sticky `pt-[env(safe-area-inset-top)]` header · fixed bottom nav `pb-[env(safe-area-inset-bottom)]`).
- **KHÔNG sửa** `Layout.tsx`, **KHÔNG đụng** `/dealer/*`. Route cũ vẫn canonical; `/ops` deep-link vào chúng
  ở chỗ chưa dựng lại. Bottom-nav consumer (P1 vỡ 360px) vẫn thuộc `uiux-roadmap.md` — **tham chiếu, không
  trùng lặp** ở đây.
- Lối vào `/ops`: một entry **flag-gated** ở nơi floor đã đứng (thẻ/link trong VẬN HÀNH) — không đổi nav consumer.

## 9. Câu hỏi mở (owner quyết ở PR sau)
- Tab thứ 5 "Thêm" gom nhiều thứ — có cần tách "Dealer" thành tab cố định cho CLB nhiều dealer không?
- "Cảnh báo" có gộp cả thông báo Telegram/hệ thống hay chỉ ops? (đề xuất: chỉ ops + tài chính read-only).
- Ngưỡng vai trò cho `/ops` (chỉ floor+ hay cả dealer-manager) — mirror `useAuth` cờ nào chính xác.
