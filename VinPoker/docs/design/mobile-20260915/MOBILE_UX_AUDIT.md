# MOBILE_UX_AUDIT — 15/09/2026

## Kết luận và phạm vi

Audit + đề xuất, chưa phải bản sửa đã chạy. Baseline source: `0e4b7636039fab7cba04b3c3b6f6da5d526990c5`. Một worktree sạch, không sửa app, DB, Edge, quyền, flag hay dữ liệu. Không deploy. Ảnh owner là bằng chứng thiết bị thật; source main không chứng minh SHA đang phục vụ thiết bị.

**P0 = 1; P1 = 4; P2 = 1.** P0 ở đây là luồng mobile không sử dụng được theo tiêu chí owner, không phải bằng chứng mất tiền/corruption. Chưa tái hiện backend bust/close; không kết luận thiếu player ID chỉ từ ảnh.

## Bằng chứng

Ảnh gốc trong `C:/Users/Lenovo/Downloads/Telegram Desktop/`:

- `photo_2026-09-15_18-47-56.jpg`: toast “Loại thất bại”, Tom dwan/Phil Ivei vẫn trên roster.
- `photo_2026-09-15_18-47-52.jpg`: hai Bàn 1, **cả hai Đã đóng**; player bottom navigation trong Floor.
- `photo_2026-09-15_18-47-46.jpg`: nhập tên tự do, không có danh sách; bàn phím mở trên modal lồng sheet.
- `photo_2026-09-15_18-47-43.jpg`: nút X và tiêu đề sát/đè vùng status bar.

Không đưa ảnh chứa danh tính người chơi vào GitHub. Các wireframe dùng placeholder, không phải dữ liệu thật.

## Danh mục lỗi

| ID / mức | Màn, hành vi hiện tại và vấn đề | iOS / Android | Hành vi chung đề xuất và phạm vi |
|---|---|---|---|
| UX01 / P0 | `ui/sheet.tsx`, `FloorTableDetailSheet.tsx`, `FloorTableMapPanelV3.tsx`: X sticky top-0; Floor có bottom inset nhưng thiếu top inset. Ảnh cho thấy X trùng pin, header trùng giờ. | iOS: tránh notch/status bar cả PWA và Safari. Android: tránh cutout, status/nav bars; không hard-code chiều cao iPhone. | Header riêng bên trong safe area, nút “Đóng” 48×48 CSS px tối thiểu, body cuộn độc lập; không dùng vị trí zero-height che title. Sửa scoped Floor trước; sửa primitive chung chỉ khi có regression coverage. |
| UX02 / P1 | `FloorTableMapPanel.tsx` gọi legacy Edge `update_seats`; lỗi được chuyển qua `floorOpsErrorMessage`. Ảnh chỉ có “Loại thất bại”. `CloseTableDialog.tsx` đã có inline error/guard ghế thiếu entry, nhưng chưa biết thiết bị nhận response nào. | Hai nền tảng cần lỗi tồn tại đủ lâu, VoiceOver/TalkBack đọc được; không chỉ toast mất nhanh. | Hiển thị lý do server đã chuẩn hóa, player/entry/bàn đang chọn và đường phục hồi. Lỗi lạ: thông báo trung tính + mã đối chiếu an toàn, không raw payload. Không báo thành công trước server; không force-bust hay xóa người để né lỗi. Diagnostics/backend là slice riêng nếu thiếu contract. |
| UX03 / P1 | `FloorTableMapPanel.tsx` tải mọi tournament assignment; mặc định lọc all. Hai Bàn 1 trong ảnh là closed, không chứng minh hai active physical sessions. | iOS/Android: danh sách chính chỉ công việc hiện tại, lịch sử truy cập rõ ràng. | Mặc định “Đang sử dụng”; “Đã đóng” là history đọc-only với thời gian/session khi contract có. Không dedupe theo số bàn, không delete. Hai active leases thật phải fail-closed và báo xung đột, không giấu một row. |
| UX04 / P1 | `AddPlayerDialog.tsx` có free-name `floor_assign_player_to_seat`; input/select h-9. V3 có seatable/restorable entry lists nhưng native select, chưa có search và restore nằm xa roster. | iOS: không tự mở keyboard khi chỉ muốn xem list; input tối thiểu 16px. Android: cùng list/search, Back đóng lớp con trước. | Search + scroll ngay khi mở; “Chưa có ghế” trước, “Đã loại” riêng. Chỉ chọn entry thật. Đã loại dùng **Khôi phục**, không gọi Add trá hình. Người đã có ghế chỉ hiện bàn hiện tại và dẫn đến Chuyển. Không tạo registration bằng gõ tên. |
| UX05 / P1 | `Layout.tsx` có player bottom nav khi không phải viewer-focus route; ảnh Floor còn nav người chơi và badge đăng ký. Sheet/modal chồng context, tăng nhầm tác vụ. | iOS: một bottom region, giữ home indicator. Android: Back theo lớp tác vụ; không đưa về trang chủ bất ngờ. | Floor giữ login hiện có nhưng tập trung vào CLB → giải → bàn; ẩn player bottom nav trong workspace đã xác định, không tạo Ops login lại. Cần kiểm route chính xác trước sửa. Không rollout thay shell tất cả module cùng lúc. |
| UX06 / P2 | `FloorTableControlMode.tsx`/`FloorTableModePicker.tsx`: hai khối mode lớn và lời kỹ thuật chiếm chiều cao; V3 đã có badge nhưng còn revision/epoch và copy Preview. Global/Tailwind font defaults khác operations override. | iOS/Android: thông tin vận hành đọc trước giải thích kỹ thuật; cỡ chữ tăng không clip. | Tái sử dụng mode badge V3; mở phần đổi có giải thích ngắn. Đưa revision/epoch vào diagnostics. Dùng operations typography/semantic tokens, không font mới hoặc skin Apple. |

## Khoanh vùng kiến trúc, không audit cả repo

| Khu vực | Source đã kiểm | Kết luận giới hạn |
|---|---|---|
| Floor | Map legacy/V3, detail, add/close, roster/mode | Hai consumer paths tồn tại. Flag `floorTableControlV3` là kết quả preview/production enable helpers, không literal proof production ON. Không chuyển backend chỉ bằng sửa UI. |
| Shell/Owner | `Layout.tsx` capability menu, `OpsBottomNav.tsx` | Menu quyền có nhiều module; Ops nav dùng bottom safe area. Chưa authenticated UAT Owner; không đổi authority. |
| Tracker | `TrackerDashboard.tsx` | Có entry history và control min-h-11. Cần kiểm sub-screen table/action pad, landscape và keyboard riêng; chưa PASS tablet. |
| Dealer Swing | `DealerSwingTab.tsx` | Nhiều vùng cuộn max-height/modal, rủi ro lồng scroll; chưa đo trên thiết bị. Không kết luận clock/break/payroll đã đồng bộ. |
| Cashier | `CashierDashboard.tsx` | Tabs responsive grid và bảng overflow-auto; cần horizontal-scroll affordance và kiểm form dài. Không thực hiện buy-in/receipt/money test. |
| Design tokens | `src/index.css`, `tailwind.config.ts`, `ui/sheet.tsx`, `ui/dialog.tsx` | Có tokens và local Space Grotesk. Sheet close 44px nhưng vị trí sai; dialog close icon 16px không explicit target expansion. Generic dialog centered, thiếu giới hạn visual viewport trong primitive. |

Không có graph index và skill repo `.agents/skills/design-taste-frontend/SKILL.md` tại worktree/root được kiểm; dùng source thật và 5 skill đã cài, không giả vờ chạy graph/taste tool.

## Những gì cần xác minh trước sửa bust/close

1. Xác nhận URL, frontend receipt/SHA và resolved flag của đúng màn owner dùng; ảnh khớp legacy không đồng nghĩa toàn bộ production V3 OFF.
2. Ghi exact read-only identity của TEST tournament, assignment/session và entry linkage; không suy từ tên/Entry 1.
3. Tái hiện response bust/close trong TEST cô lập, lưu error code đã redact; không bấm mutation production trong audit.
4. So sánh Manual chip>0, Tracker chip=0, active-hand block, stale revision và missing linkage theo contract hiện hành.
5. Không đổi mode hoặc chip nhằm làm thao tác pass; data repair nếu cần phải exact-ID, owner-gated riêng.

## Verification receipt

| Kiểm tra | Trạng thái |
|---|---|
| 4 ảnh owner + source boundary/tokens | REVIEWED |
| Installed skill entrypoints đọc được | PASS |
| Backend cause của Phil/Tom và close | NOT MEASURED |
| Đồng bộ Floor/Dealer/Tracker thực tế | NOT MEASURED |
| Browser screenshot matrix, keyboard, VoiceOver/TalkBack | NOT RUN — chưa implement |
| DB/Edge/flag/production writes | NONE |

Bước tiếp: triển khai slice UI trong tài liệu kèm theo; tách mọi thay đổi RPC/identity khỏi redesign. Không gọi báo cáo này là sửa xong Floor hoặc App Store ready.
