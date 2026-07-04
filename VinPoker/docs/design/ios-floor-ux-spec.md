# iOS Floor UX Spec — "Floor hôm nay" cockpit (PR-IOS0, docs-only)

> **Trạng thái: SPEC — chưa triển khai.** Cờ `mobileOpsV2` (mới, OFF). Base SHA `e194571d`.
> Theme: **Midnight Sakura** có sẵn (`src/index.css:8–113`) — không chế token mới. Ghi đè master-map §20.1.
> Đây là deliverable LÕI. Wireframe copy ở `ios-floor-wireframes.md`; component ở `ios-operations-components.md`.

## 1. Mục tiêu — "Floor hôm nay" trả lời 6 câu trong 5 giây

Người vận hành mở app (PWA, một tay, đang đi) và trong 5 giây phải thấy:

1. **Giải nào đang chạy?** — thẻ giải active (tên, level, còn lại, đồng hồ).
2. **Bàn nào đang mở?** — đếm bàn theo trạng thái (mở/đang chạy/tạm dừng/đóng).
3. **Bàn nào cần floor?** — danh sách bàn "cần xử lý" nổi lên đầu.
4. **Dealer nào bất thường?** — dealer thiếu / quá giờ / chưa check-in.
5. **Có cảnh báo không?** — redraw / ghế / late-reg / lệch đối soát (read-only) / cashier chờ.
6. **Việc tiếp theo là gì?** — 1 thẻ "việc kế tiếp" (TodayTaskCard) với hành động lớn.

Nguyên tắc: **một màn = một việc chính**; số quan trọng to, đọc-liếc; hành động nguy hiểm phải xác nhận;
mọi thứ hồi phục được hoặc có dấu vết. Dữ liệu realtime → có nhãn "cũ" khi mất đồng bộ.

## 2. Design tokens tiêu thụ (không tạo mới)

`--background` #07050A · `--card` #120C18 · `--primary` (vàng) #C9A86A · `--accent` (sakura) #E2718F ·
`--foreground` #F2ECE6 · `--muted-foreground` #9B8E97 · semantic `--success`/`--warning`/`--destructive`.
Poker: `--poker-felt` (burgundy) chỉ trong component bàn. Safe-area: `env(safe-area-inset-*)`.
Status chip (§13) map: Đang chạy=success · Cần xử lý=warning · Trễ giờ=destructive · Thiếu dealer=destructive ·
Chờ cashier=accent · Đã chốt=primary · Tạm tính=muted · Lỗi đối soát=destructive.

## 3–12. 10 màn Floor (mỗi màn 12 trường bắt buộc)

> Template mỗi màn: **Mục đích · Hành động chính · Hành động phụ · Dữ liệu · Bottom bar · Hành động nguy hiểm ·
> Mẫu xác nhận · Empty · Loading · Conflict/stale · Offline/retry · Role gate · Ghi chú audit.**

### 3. Floor hôm nay (`/ops`)
- **Mục đích**: cockpit trả lời 6 câu ở §1.
- **Hành động chính**: mở "việc kế tiếp" (TodayTaskCard) → điều tới màn xử lý.
- **Hành động phụ**: đổi giải đang xem; mở Bàn cần xử lý; mở Cảnh báo.
- **Dữ liệu**: thẻ giải active (level/còn lại/clock) · đếm bàn theo trạng thái · N bàn cần floor · N dealer bất
  thường · N cảnh báo (badge) · 1 TodayTaskCard.
- **Bottom bar**: BottomActionDock — nút chính "Xem việc cần làm" (nhảy Cảnh báo) + phụ "Sơ đồ bàn".
- **Hành động nguy hiểm**: không (màn tổng hợp, chỉ điều hướng).
- **Mẫu xác nhận**: n/a.
- **Empty**: chưa có giải chạy → "Chưa có giải nào đang chạy hôm nay" + CTA "Xem lịch giải".
- **Loading**: skeleton cho từng thẻ (không spinner toàn màn).
- **Conflict/stale**: RealtimeStaleBanner "Số liệu cập nhật HH:MM · kéo để làm mới" khi realtime trễ.
- **Offline/retry**: banner "Mất mạng — đang thử lại" + nút "Thử lại"; số liệu giữ giá trị cũ có nhãn.
- **Role gate**: floor/cashier/tracker/admin (component-level) + `mobileOpsV2`.
- **Ghi chú audit**: chỉ đọc; không ghi. Nguồn realtime = channel read-only (như `/floor` hiện tại).

### 4. Điều khiển giải nhanh (`/ops/tournaments/:id`)
- **Mục đích**: xem + điều hướng 1 giải đang chạy (KHÔNG phải form quản lý nặng).
- **Hành động chính**: "Mở Sơ đồ bàn" của giải.
- **Hành động phụ**: mở Tracker/viewer (link); xem cơ cấu giải thưởng (đọc); xem cấu trúc blind (đọc).
- **Dữ liệu**: tên giải · trạng thái · level/blind hiện tại · người còn lại · số bàn · prize pool (đọc).
- **Bottom bar**: "Sơ đồ bàn" (chính) + "Live tracker".
- **Hành động nguy hiểm**: sửa blind/level/status, xoá giải thưởng — **KHÔNG làm ở mobile**; hiển thị đọc +
  nút "Sửa trên máy tính" (RoleLockedAction) → tránh mis-tap (đây là P0 §4.2 audit).
- **Mẫu xác nhận**: nếu về sau cho sửa level → ConfirmActionSheet restate "Level N → M · blind X/Y" (§15).
- **Empty**: giải chưa bắt đầu → hiện lịch + "Chưa có live state".
- **Loading**: skeleton thẻ.
- **Conflict/stale**: StaleBanner; nếu người khác vừa đổi level → toast "Level vừa được cập nhật".
- **Offline/retry**: đọc từ cache cuối + nhãn cũ; hành động chặn tới khi online.
- **Role gate**: floor/cashier/tracker/admin.
- **Ghi chú audit**: chỉ đọc; mọi sửa đổi tiền/level giữ ở luồng desktop/hiện có có dấu vết.

### 5. Sơ đồ bàn / thẻ bàn (`/ops/tables`)
- **Mục đích**: thấy nhanh bàn nào cần gì; vào chi tiết bàn.
- **Hành động chính**: tap 1 bàn → sheet chi tiết bàn.
- **Hành động phụ**: lọc trạng thái (SegmentedControl lớn); tìm số bàn/tên; đổi mật độ.
- **Dữ liệu**: TableStatusCard mỗi bàn (số bàn · trạng thái màu · occ/max · cờ "cần xử lý"). **KHÔNG lưới 3
  cột chật** (sửa P1 §4.3): card ≥44px, 2 cột ở 390px, hoặc list card 1 cột khi bật "chi tiết".
- **Bottom bar**: "Bàn cần xử lý (N)" nhảy tới bàn cần floor.
- **Hành động nguy hiểm**: không ở cấp map (nằm trong sheet).
- **Mẫu xác nhận**: n/a ở đây.
- **Empty**: chưa có bàn → "Chưa mở bàn nào" + (nếu quyền) "Mở bàn" (luồng floorTableOps hiện có).
- **Loading**: skeleton lưới card.
- **Conflict/stale**: StaleBanner; seat move của người khác → refresh mềm.
- **Offline/retry**: giữ map cũ + nhãn cũ; chặn hành động.
- **Role gate**: floor/cashier/admin (canMove theo `cashier_club_ids` như hiện tại).
- **Ghi chú audit**: đọc `get_seats`/tournament_tables read-only; hành động = trong sheet (mục 6/7).

### 6. Xếp ghế / hành động người chơi (sheet trong Bàn)
- **Mục đích**: thao tác 1 người tại bàn (Chuyển / Sửa chip / Phiếu / Loại) — **tái dùng `PlayerActionSheet`**.
- **Hành động chính**: theo ngữ cảnh (thường "Chuyển" hoặc "Loại").
- **Hành động phụ**: Sửa chip · Phiếu (xem/in) · Thông tin.
- **Dữ liệu**: tên (ẩn danh khi chụp) · bàn/ghế · chip · lượt vào.
- **Bottom bar**: n/a (đây là sheet); 4 hành động là lưới lớn trong sheet.
- **Hành động nguy hiểm**: **Loại (bust)** — dùng `BustConfirmDialog` đã có (restate hạng + tiền, non-ITM
  "ngoài cơ cấu giải"). Sửa chip = cảnh báo bảo toàn chip.
- **Mẫu xác nhận**: modal AlertDialog restate; **swipe KHÔNG dùng cho Loại/tiền** (chỉ tap có xác nhận).
- **Empty**: ghế trống → nút "Thêm người" (nếu quyền).
- **Loading**: nút hành động hiện spinner khi đang gọi Edge.
- **Conflict/stale**: nếu người chơi vừa bị move → sheet đóng + toast "Ghế đã thay đổi".
- **Offline/retry**: hành động chặn khi offline; báo lỗi rõ, không nuốt lỗi.
- **Role gate**: canMove (owner/cashier) cho Chuyển/Sửa chip; Loại theo quyền floor hiện có.
- **Ghi chú audit**: mọi hành động = Edge `update_seats`/`move_player_seat` hiện có (actor = auth.uid()).

### 7. Luồng redraw (`/ops/tables` → RedrawLauncher)
- **Mục đích**: bốc lại bàn (final_table/itm/threshold/manual) — **tái dùng `RedrawLauncherDialog`**.
- **Hành động chính**: chọn kiểu redraw → **xem trước** → xác nhận.
- **Hành động phụ**: đổi kiểu; huỷ.
- **Dữ liệu**: kiểu redraw · preview bàn/ghế mới.
- **Bottom bar**: trong dialog: "Xem trước" rồi "Xác nhận bốc lại".
- **Hành động nguy hiểm**: redraw (đảo ghế toàn giải) — **modal xác nhận có preview bắt buộc**.
- **Mẫu xác nhận**: ConfirmActionSheet/modal: "Bốc lại N bàn · X người" + preview; nút chính destructive-tint.
- **Empty**: chưa đủ điều kiện → disable + lý do ("Chưa tới final table").
- **Loading**: preview có skeleton; xác nhận có spinner.
- **Conflict/stale**: nếu số bàn đổi giữa preview→confirm → buộc xem lại preview.
- **Offline/retry**: chặn; không cho confirm khi offline.
- **Role gate**: floorTableOps + quyền floor.
- **Ghi chú audit**: RPC `redraw_tournament` hiện có (SECURITY DEFINER). Không thêm write path.

### 8. Tra cứu người chơi / check-in (sheet từ Hôm nay + Bàn)
- **Mục đích**: tìm 1 người → thấy trạng thái (đã ngồi/đang chờ/đã loại) + phiếu.
- **Hành động chính**: tìm theo tên/SĐT → chọn → xem PlayerLookupCard.
- **Hành động phụ**: mở phiếu; nhảy tới bàn của họ.
- **Dữ liệu**: tên (masked SĐT như `lookup_member_for_buyin`) · bàn/ghế · trạng thái · lượt vào.
- **Bottom bar**: n/a (sheet).
- **Hành động nguy hiểm**: không (chỉ đọc + điều hướng). Buy-in/re-entry = luồng cashier có xác nhận.
- **Mẫu xác nhận**: n/a.
- **Empty**: không thấy → "Không tìm thấy — kiểm tra SĐT" + gợi ý.
- **Loading**: debounce + skeleton dòng.
- **Conflict/stale**: kết quả có thời điểm; tap → tải chi tiết mới.
- **Offline/retry**: chặn tìm; báo offline.
- **Role gate**: PII đầy đủ chỉ owner/admin/self; cashier thấy masked (theo split RPC hiện có).
- **Ghi chú audit**: đọc `lookup_member_for_buyin` (masked) — không lộ full money history cho floor.

### 9. Trạng thái dealer (`/ops/more` → Dealer, hoặc tab Dealer)
- **Mục đích**: thấy dealer nào đang bàn / nghỉ / thiếu / quá giờ.
- **Hành động chính**: xem DealerStatusCard theo bàn/khu.
- **Hành động phụ**: mở Dealer Swing đầy đủ (link); nếu quyền → hành động swing ở luồng hiện có.
- **Dữ liệu**: dealer · bàn · trạng thái (active/rest/preassign — token `--ds-*` có sẵn) · quá giờ?
- **Bottom bar**: "Mở Dealer Swing" (chi tiết/hành động nặng).
- **Hành động nguy hiểm**: reassign/close-tour = **luồng hiện có** ("Đóng tour" gõ "DONG TOUR"); mobile chỉ xem.
- **Mẫu xác nhận**: kế thừa dialog hiện có.
- **Empty**: "Chưa có dealer trong ca".
- **Loading**: skeleton card.
- **Conflict/stale**: StaleBanner; realtime read-only.
- **Offline/retry**: giữ cũ + nhãn.
- **Role gate**: floor/dealer-manager/admin; đọc `dealer_shift_assignments` read-only (không đụng payroll).
- **Ghi chú audit**: read-only; KHÔNG mobile-hoá payroll (NO-GO §4.5).

### 10. Hàng đợi sự cố / sửa lỗi (`/ops/alerts` phần thao tác)
- **Mục đích**: gom việc-cần-xử-lý thao tác (sửa nhầm bàn, ghế lỗi, orphan) thành hàng đợi.
- **Hành động chính**: tap 1 mục → mở luồng sửa tương ứng (hiện có: reconcile/move).
- **Hành động phụ**: bỏ qua/để sau (đánh dấu, không xoá).
- **Dữ liệu**: AlertQueueItem (loại · bàn/người · mức độ · thời điểm).
- **Bottom bar**: "Xử lý mục đầu" (mục nghiêm trọng nhất).
- **Hành động nguy hiểm**: theo từng luồng sửa (có xác nhận riêng).
- **Mẫu xác nhận**: dùng modal của luồng đích.
- **Empty**: "Không có sự cố — mọi thứ ổn" (empty state tích cực).
- **Loading**: skeleton list.
- **Conflict/stale**: mục đã xử lý bởi người khác → gạch + "đã xử lý".
- **Offline/retry**: chặn mở luồng ghi khi offline.
- **Role gate**: floor/admin.
- **Ghi chú audit**: chỉ tổng hợp + điều hướng; hành động sửa = RPC reconcile hiện có.

### 11. Cảnh báo / Tài chính read-only (`/ops/alerts`)
- **Mục đích**: hiển thị cảnh báo **tài chính đọc-thôi** cho floor/owner — KHÔNG thao tác tiền.
- **Hành động chính**: đọc; owner tap → "Mở Tài chính & Đối soát trên máy tính".
- **Hành động phụ**: lọc theo loại.
- **Dữ liệu**: FinancialWarningCard — "Còn lại sau lương" (KHÔNG "Lãi ròng"), lệch đối soát, chờ cashier;
  mỗi số gắn badge **Tạm tính / Đã chốt**; "Tiền chuyển hộ" (prize/escrow) ghi rõ **không phải doanh thu**;
  nếu là DỮ LIỆU MẪU → nhãn "DỮ LIỆU MẪU". Biên đóng góp ≠ Lợi nhuận.
- **Bottom bar**: n/a (đọc).
- **Hành động nguy hiểm**: KHÔNG (floor không sửa tiền). RoleLockedAction cho mọi nút tiền.
- **Mẫu xác nhận**: n/a.
- **Empty**: "Không có cảnh báo tài chính".
- **Loading**: skeleton.
- **Conflict/stale**: số tài chính LUÔN gắn thời điểm + trạng thái (Tạm tính/Đã chốt) — không hiển thị số trần.
- **Offline/retry**: hiện số cuối + nhãn thời điểm.
- **Role gate**: owner/admin thấy chi tiết; floor thấy cảnh báo mức cao (không số nhạy cảm) tuỳ chính sách.
- **Ghi chú audit**: đọc từ nguồn tài chính hiện có; hiện tại cockpit là MOCK → dán nhãn; không tính toán lại
  giá trị đã lưu (payroll/ledger).

### 12. Liên kết nhanh Tracker / F&B / Cashier / Tài chính (`/ops/more`)
- **Mục đích**: một chỗ nhảy sang các surface khác đúng quyền.
- **Hành động chính**: tap link → surface đích (mobile nếu có, "mở máy tính" nếu desktop-only).
- **Hành động phụ**: n/a.
- **Dữ liệu**: danh sách link + badge trạng thái (vd F&B: N đơn chờ).
- **Bottom bar**: n/a.
- **Hành động nguy hiểm**: không.
- **Mẫu xác nhận**: n/a.
- **Empty**: ẩn link vai trò không có quyền.
- **Loading**: badge lazy.
- **Conflict/stale**: badge có thời điểm.
- **Offline/retry**: link vẫn hiện; đích tự xử lý offline.
- **Role gate**: mỗi link theo cờ + vai trò (Cashier-lite=cashier; F&B=fnb; Tài chính=owner).
- **Ghi chú audit**: chỉ điều hướng.

## 13. Luật xuyên màn

- **Xác nhận nguy hiểm restate số tiền** (master-map §15): "Loại Player A · hạng 3 · 3.000.000 đ" — không chỉ
  "Bạn có chắc?". Đã có tiền lệ `BustConfirmDialog`.
- **Thuật ngữ tiền (bắt buộc, đúng doctrine)**: "Tài chính & Đối soát" (không "Kế toán") · "Tạm tính"/"Đã chốt"
  · "Còn lại sau lương" (không "Lãi ròng") · "Tiền chuyển hộ" (prize/escrow, không doanh thu) · "Biên đóng
  góp ≠ Lợi nhuận" · "Nợ phải trả" · F&B "toàn CLB, không chia theo giải". Mock → nhãn "DỮ LIỆU MẪU".
- **Status chip** (OperationStatusChip): 8 trạng thái ở §2, màu semantic, chữ ≥11px.
- **Target ≥44pt**; **swipe chỉ cho hành động nhẹ** (đánh dấu đã xem), không bao giờ cho Loại/xoá/tiền/finalize.
- **Realtime/stale**: mọi số realtime gắn thời điểm; mất đồng bộ → RealtimeStaleBanner + kéo-làm-mới.

## 14. Chính sách realtime & stale
Poll/subscribe read-only như hiện tại (`tournament-live:{id}` UPDATE listener). Ngưỡng "cũ": nếu >30s không có
event khi đang xem live → banner. Không tự ghi khi mount (pre-flight §EVIDENCE). Người khác đổi state → refresh
mềm + toast, không mất thao tác dở.

## 15. Spec này KHÔNG làm
- Không dựng lại hand-input console / Series Intelligence / cockpit Tài chính đầy đủ / sửa payroll cho mobile
  (desktop-only).
- Không thêm write path / RPC / Edge / migration. Không cho floor thao tác tiền.
- Không đổi `Layout.tsx` / `/dealer/*`. Không flip cờ. Prototype = mock, cờ OFF (xem implementation plan).
