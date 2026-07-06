# Bản đồ nút bấm → màn mobile (toàn app) — mobileOpsV2

> Nguồn: quét code thật 9 module (workflow 9 agent, 2026-07-07, base origin/main) → ~340 nút.
> Mỗi nút được gán vào 1 màn mock đã duyệt với owner trong chat 2026-07-07, hoặc đánh dấu **máy tính**
> (desktop-only, mobile chỉ có lối "mở trên máy tính").
> Đây là CHECKLIST BUILD: khi dựng thật, mọi nút trong bảng phải có chỗ đứng đúng như cột "Màn mobile".
> Mức: 💰 = đường tiền (xác nhận phải nhắc lại số) · ⚠️ = ghi dữ liệu (cần confirm) · "·" = an toàn.

## Catalog màn đã vẽ (56 màn mock, owner đã duyệt)

- **Cockpit giải (Kholdem-style):** S1 Trạng thái · S2 Bàn(giải) · S3 Người chơi · S4 Levels · S5 Trả thưởng · S6 Lịch sử · S7 sheet thao tác người chơi · S8 thẻ thông tin người chơi · S9 chuyển bàn/ghế · S10 xác nhận Loại
- **Bản gọn:** A1 danh sách giải · A2 sheet thao tác giải · B1 sơ đồ bàn tổng thể · B2 sheet bàn (ghế + người + thao tác)
- **Dealer Swing:** D1 bàn + đếm ngược · D2 sheet bàn swing · D3 pool dealer · D4 sheet dealer · D5 nhân sự ca · D6 kết ca + đóng tour
- **Module:** C1/C2 Chip Ops · F1/F2 F&B đơn · M1/M2 Marketing · T1/T2 Tài chính · AC1/AC2 Tài chính & Đối soát · SI1/SI2 Trí tuệ Series
- **Nhập liệu:** N1 tạo giải · N2 từ ảnh lịch · N3 cập nhật live · N4 thêm người · N5 sửa chip · N6 phiếu
- **Dealer/F&B/MKT:** P1 chọn dealer · P2 check-in · P3 tạo đơn · P4 bếp · P5 chốt ca · P6 tạo tin
- **Cashier:** Q1 hàng chờ · Q2 sheet đăng ký · Q3 buy-in/re-entry quầy · Q4 SePay khớp tiền · Q5 staking · Q6 xác minh + cấp lại thẻ
- **Chuyên sâu:** R1 đóng bàn · R2 color-up · R3 đóng bao chip · R4 QR bàn F&B · R5 kiểm kho · R6 màn TV

Nguyên tắc chung (owner chốt): chuỗi danh sách → ấn vào ra sheet thao tác → nút nguy hiểm nằm cuối sheet,
xác nhận nhắc lại số tiền/hậu quả; ấn vào người chơi ở BẤT KỲ đâu đều ra sheet thao tác (S7); việc
cấu hình/phân tích nặng để máy tính; mọi số tài chính kèm nhãn Dự báo/Tạm tính/Đã đối soát/Đã chốt.

## floor-tournament (43 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Refresh tournament list | TournamentLivePanel overview | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Select tournament | Tournament grid / select dropdown | · | A1 |
| Back to all tournaments | Operational tabs header | · | A1 |
| Switch tabs: Sơ đồ bàn | TournamentLivePanel | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Người chơi | TournamentLivePanel | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Hàng chờ | TournamentLivePanel | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Cấu trúc blind | TournamentLivePanel | ⚠️ | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Cơ cấu giải thưởng | TournamentLivePanel | 💰 | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: TV/Display | TournamentLivePanel | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Làm mới (refresh) | Table map header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Tạo thêm bàn | Table map sticky header | ⚠️ | B2 → form tạo bàn (2 ô, kiểu N1) |
| Bốc lại (redraw) | Table map sticky header | ⚠️ | B1 → luồng xem trước → xác nhận (mẫu R1) |
| Toggle density (compact/list view) | Table map sticky header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Filter by table status | Table map filter buttons (All/Mở/Chạy/Tạm dừng/Đóng) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Search tables by number or player name | Table map search input | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Clear filters | Table map search area | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Click table to view seats | Table map grid cells | · | B1→B2 |
| Chuyển (move player) | Player action sheet (table map detail) | ⚠️ | S9 |
| Sửa chip (edit chips) | Player action sheet (table map detail) | 💰 | N5 |
| Phiếu (show receipt) | Player action sheet (table map detail) | · | N6 |
| Loại (bust out) | Player action sheet (table map detail) | ⚠️ | S10 |
| Thông tin (player info sheet) | Player action sheet | · | S8 |
| Chuyển (move) from players tab | Playing players list row tap | ⚠️ | S3 |
| Loại (bust) from players tab | Playing players list row tap | ⚠️ | S3 |
| Search players | Players panel search input | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch player group | Player group buttons (Đang chơi/Chờ xếp/Bust) | · | S3 |
| Refresh players | Players panel header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Xếp chỗ (draw seats) | Registration queue panel | ⚠️ | Q1/Q2 |
| Huỷ đăng ký (cancel registration) | Registration queue row | ⚠️ | Q1/Q2 |
| Huỷ entry (void registration) | Registration queue row | ⚠️ | Q1/Q2 |
| Phiếu (print receipt) | Registration queue row | · | Q1/Q2 |
| Add blind level | Blind structure panel | ⚠️ | S4 xem + chọn mẫu · thêm/sửa/lưu = máy tính |
| Add break | Blind structure panel | ⚠️ | S4 xem + chọn mẫu · thêm/sửa/lưu = máy tính |
| Lưu (save blind structure) | Blind structure panel | ⚠️ | S4 xem + chọn mẫu · thêm/sửa/lưu = máy tính |
| Load blind template | Blind template dropdown | ⚠️ | S4 xem + chọn mẫu · thêm/sửa/lưu = máy tính |
| Lưu thành mẫu (save template) | Blind structure panel | ⚠️ | S4 xem + chọn mẫu · thêm/sửa/lưu = máy tính |
| Remove blind level | Blind level row (trash icon) | ⚠️ | S4 xem + chọn mẫu · thêm/sửa/lưu = máy tính |
| Add prize rank | Prize structure panel | ⚠️ | S5 xem · thêm/sửa/lưu = máy tính (money) |
| Lưu (save prizes) | Prize structure panel | 💰 | S5 xem · thêm/sửa/lưu = máy tính (money) |
| Remove prize row | Prize row (trash icon) | ⚠️ | S5 xem · thêm/sửa/lưu = máy tính (money) |
| Tạo giải | Daily tournaments board | · | N1 |
| Tạo từ ảnh lịch | Daily tournaments board | · | N2 |
| Chốt giải | TournamentLivePanel header | 💰 | A2 (Chốt giải trong sheet giải) |

## floor-tables-players (44 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Tạo thêm bàn | Floor Table Map panel | ⚠️ | B2 → form tạo bàn (2 ô, kiểu N1) |
| Bốc lại | Floor Table Map panel | ⚠️ | B1 → luồng xem trước → xác nhận (mẫu R1) |
| Toggle density (grid/list) | Floor Table Map panel | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Làm mới | Floor Table Map panel | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch status filter | Floor Table Map status tabs | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Search tables/players | Floor Table Map search input | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Clear filters | Floor Table Map search bar | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Tap table card | Floor Table Map grid | · | B1→B2 |
| Mở bàn | Table Detail Sheet actions | ⚠️ | B2 → form tạo bàn (2 ô, kiểu N1) |
| Thêm người | Table Detail Sheet actions | ⚠️ | N4 |
| Đóng bàn | Table Detail Sheet actions | ⚠️ | R1 |
| Tap occupied seat | Table Detail Sheet seat grid | · | B2→S7 |
| Chuyển | Player Action Sheet primary actions | ⚠️ | S9 |
| Sửa chip | Player Action Sheet primary actions | 💰 | N5 |
| Phiếu | Player Action Sheet primary actions | · | N6 |
| Loại | Player Action Sheet primary actions | 💰 | S10 |
| Thông tin người chơi | Player Action Sheet secondary row | · | S8 |
| Chuyển | Player Info Sheet action buttons | ⚠️ | S9 |
| Phiếu | Player Info Sheet action buttons | · | N6 |
| Loại | Player Info Sheet action buttons | 💰 | S10 |
| Xác nhận loại | Bust Confirm Dialog confirm button | 💰 | S10 |
| Huỷ | Bust Confirm Dialog cancel button | · | S10 |
| Mở bàn (submit) | Open Table Dialog | ⚠️ | B2 → form tạo bàn (2 ô, kiểu N1) |
| Đóng bàn (submit) | Close Table Dialog | ⚠️ | R1 |
| Phiếu (reprint) | Close Table Dialog moved player rows | · | N6 |
| Xem trước | Redraw Launcher Dialog config phase | · | B1 → luồng xem trước → xác nhận (mẫu R1) |
| Xác nhận bốc lại | Redraw Launcher Dialog preview phase | ⚠️ | B1 → luồng xem trước → xác nhận (mẫu R1) |
| Sửa lại | Redraw Launcher Dialog preview phase | · | B1 → luồng xem trước → xác nhận (mẫu R1) |
| Select redraw mode | Redraw Launcher Dialog config | · | B1 → luồng xem trước → xác nhận (mẫu R1) |
| Select draw placement mode | Redraw & Close Table dialogs | · | R1 |
| Toggle player checkbox | Redraw Launcher manual custom mode | · | B1 → luồng xem trước → xác nhận (mẫu R1) |
| Thêm người (submit) | Add Player Dialog | ⚠️ | N4 |
| Chuyển ghế (step tables up/down) | Move Player Dialog seat picker | · | S9 |
| Chuyển ghế (step seat up/down) | Move Player Dialog seat picker | · | S9 |
| Select move reason | Move Player Dialog reason dropdown | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Tiếp tục | Move Player Dialog pick phase | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Xác nhận chuyển | Move Player Dialog confirm phase | ⚠️ | S9 |
| Sửa lại | Move Player Dialog confirm phase | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Xem phiếu mới | Move Player Dialog done phase | · | N6 |
| Lưu chip | Edit Chips Dialog submit | 💰 | N5 |
| Bốc thăm | Seat Draw Dialog preview phase | ⚠️ | Q1/Q2 |
| Xem phiếu | Seat Draw Dialog done phase | · | N6 |
| Print receipt | Seat Receipt Dialog | · | N6 |
| Download PDF | Seat Receipt Dialog | · | N6 |

## dealer-swing (45 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Switch tabs: Dealer Swing / Bảng lương / Xếp lịch | DealerSwingDashboard header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Làm mới | Control panel header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Danh sách Dealer | Control panel | · | D3 |
| Chọn CLB | Club selector dropdown | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Cấu hình Swing | Control panel | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Tổng thể / Tour filter chips | Tour selector | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Tạo tour mới | Tour controls | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Xoá tour (× button) | Tour controls | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Lưu trữ & Đóng tour | CloseTourDialog (final step) | 💰 | D6 |
| Gán dealer | Empty table card popover | · | B1→B2 |
| Suggestion chip (dealer name) | Assign modal suggestions | ⚠️ | P1 |
| Gán nhanh (force picker) | Assign modal manual picker | ⚠️ | P1 |
| Chốt đổi dealer / Chốt khẩn cấp | Table card popover (primary action) | ⚠️ | B1→B2 |
| Nghỉ (break button) | Table card popover | ⚠️ | B1→B2 |
| Break preset buttons (15p/30p/45p/60p) | BreakDurationDialog | · | D2/D4 + chọn 15·30·45·60p trong sheet |
| Custom break minutes input + confirm | BreakDurationDialog | ⚠️ | D2/D4 + chọn 15·30·45·60p trong sheet |
| Đổi dự kiến | Table card correction section | · | B1→B2 |
| Sửa nhầm bàn | Table card correction section | ⚠️ | B1→B2 |
| Đóng bàn (trash icon) | Table card popover footer | · | R1 |
| Xác nhận đóng (confirm close) | Table card close confirm | 💰 | B1→B2 |
| Giới hạn nghỉ dealer (staff optimizer) | StaffingOptimizerCard | · | D2/D4 + chọn 15·30·45·60p trong sheet |
| Cho N người về (check-out) | StaffingOptimizerCard footer | 💰 | D4 / D6 (hàng loạt) |
| Gọi thêm / Check-in dealer | StaffingOptimizerCard button | ⚠️ | P2 |
| Check-in: Select all / Bỏ chọn | Check-in dialog | · | P2 |
| Đã check-in N dealer | Check-in dialog confirm | ⚠️ | P2 |
| Check-out (single) | Roster footer / menu | 💰 | D4 / D6 (hàng loạt) |
| Check-in thủ công | Roster footer | ⚠️ | P2 |
| Check-in lại (re-checkin) | Checked-out section rows | ⚠️ | P2 |
| Batch checkout: Check-out (selected) | Roster batch mode footer | 💰 | D4 / D6 (hàng loạt) |
| Batch checkout: Huỷ  | Roster batch mode footer | · | D3 |
| Thêm bàn từ pool | Control area button | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Pool table checkbox select | Create table dialog | · | máy tính (cấu hình) — mobile chỉ xem D1 |
| Chọn tất cả / Bỏ chọn (pool) | Create table dialog | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Xác nhận (activate tables) | Create table dialog confirm | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Cài đặt Telegram | Control panel | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Lưu Telegram Chat ID | Telegram dialog | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Tạo tour mới (dialog) | Create tour modal | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Xoá tour (alert confirm) | Delete tour dialog | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Ngày đặc biệt: + Thêm | Special dates dialog | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Xóa ngày đặc biệt (trash) | Special dates list | ⚠️ | máy tính (cấu hình) — mobile chỉ xem D1 |
| Chọn nhiều (batch toggle) | Roster panel header | · | D3 |
| Nghỉ ăn cơm (coffee icon) | Roster available dealer row | ⚠️ | D2/D4 + chọn 15·30·45·60p trong sheet |
| Gửi nghỉ (clock icon) | Roster available dealer row | ⚠️ | D2/D4 + chọn 15·30·45·60p trong sheet |
| Kết thúc nghỉ (end break) | Break pool dealer row | ⚠️ | D2/D4 + chọn 15·30·45·60p trong sheet |
| Nghỉ thêm (extend rest) | Break pool rest entry row | ⚠️ | D2/D4 + chọn 15·30·45·60p trong sheet |

## cashier-registration (41 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Làm mới | OfflineBuyInPanel header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Select tournament row | OfflineBuyInPanel tournament picker | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Chọn giải khác | OfflineBuyInPanel form | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Buy-in | OfflineBuyInPanel form submit | 💰 | Q3 |
| Xác nhận đã nhận tiền (in ConfirmPaymentDialog) | ConfirmPaymentDialog action | 💰 | Q3 |
| Chế độ xếp chỗ selector | ConfirmPaymentDialog | · | Q3 |
| Làm mới | ReentryPanel header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Select tournament row | ReentryPanel tournament picker | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Refresh busted list button | ReentryPanel busted players section | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Chọn giải khác | ReentryPanel busted list | · | S10 |
| Re-entry (per busted player row) | ReentryPanel busted players list | · | S10 |
| Chọn người khác | ReentryPanel form | · | Q3 (chế độ re-entry) |
| Re-entry (form submit) | ReentryPanel form submit | 💰 | Q3 (chế độ re-entry) |
| Bốc thăm tất cả | RegistrationQueuePanel header | · | Q1/Q2 |
| Làm mới | RegistrationQueuePanel header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Copy reference code (per row) | RegistrationQueuePanel queue row | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Bốc thăm chỗ (per waiting row) | RegistrationQueuePanel row action | · | Q1/Q2 |
| Huỷ (per waiting row) | RegistrationQueuePanel row action | ⚠️ | Q2 |
| Xem phiếu (per seated row) | RegistrationQueuePanel row action | · | N6 |
| Chuyển ghế (per seated row) | RegistrationQueuePanel row action | ⚠️ | S9 |
| Huỷ & hoàn (per confirmed row) | RegistrationQueuePanel row action | 💰 | Q2 (bắt lý do) |
| Huỷ đăng ký (in CancelRegistrationDialog) | CancelRegistrationDialog confirm button | ⚠️ | Q2 |
| Reason preset buttons | CancelRegistrationDialog | · | Q2 |
| Huỷ & hoàn (in VoidRegistrationDialog) | VoidRegistrationDialog confirm button | 💰 | Q2 (bắt lý do) |
| Reason preset buttons | VoidRegistrationDialog | · | Q2 (bắt lý do) |
| Bốc thăm | SeatDrawDialog preview phase | 💰 | Q1/Q2 |
| Chế độ xếp chỗ selector | SeatDrawDialog preview | · | Q3 |
| Xem phiếu (single draw) | SeatDrawDialog done phase | · | N6 |
| Bàn up/down buttons | MovePlayerDialog pick phase | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Ghế up/down buttons | MovePlayerDialog pick phase | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Lý do chuyển selector | MovePlayerDialog pick phase | · | S9 |
| Tiếp tục | MovePlayerDialog pick phase | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Sửa lại | MovePlayerDialog confirm phase | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Xác nhận chuyển | MovePlayerDialog confirm phase | ⚠️ | S9 |
| Xem phiếu mới | MovePlayerDialog done phase | · | N6 |
| Cần xử lý / Đã xử lý tabs | SePaySettlementTab header | · | Q4 |
| Làm mới | SePaySettlementTab header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Xác nhận (per settlement row) | SePaySettlementTab row action | · | Q4 |
| Bỏ qua (per settlement row) | SePaySettlementTab row action | · | Q4 |
| Xác nhận & xếp ghế (in ConfirmDialog) | SePaySettlementTab confirm dialog | 💰 | Q4 |
| Xác nhận bỏ qua (in IgnoreDialog) | SePaySettlementTab ignore dialog | ⚠️ | Q4 |

## cashier-members (43 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Switch tabs: Tra cứu / Đồng bộ / QR thẻ CLB / Xác minh / Cấp lại thẻ | Members section header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Search member by name/phone/card ID | Unified Lookup input | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| View staking deals linked to member | Deal card in lookup result | · | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Check-in / Nhập kết quả (from lookup) | Quick action buttons on deal card | · | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Download CSV template | SyncMembersTab | · | máy tính |
| Select club for sync | Club dropdown | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Upload CSV members file | Drag-drop zone in Sync tab | · | máy tính |
| Đồng bộ members | Sync tab action button | ⚠️ | máy tính |
| Lưu URL đồng bộ tự động | Auto sync URL section | ⚠️ | máy tính |
| Download club QR codes | ClubCardQrTab | · | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Phê duyệt member verification | VerificationRequestsTab row action | ⚠️ | Q6 |
| Từ chối verification + reason | VerificationRequestsTab row action | ⚠️ | Q6 |
| Select club for card reissue | CardReissueTab dropdown | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Tra cứu member / Scan QR | CardReissueTab input | ⚠️ | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Open camera scanner | Camera button in CardReissueTab | · | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Save member edits (name/card ID) | CardReissueTab edit form | ⚠️ | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Upload card design (front) | CardReissueTab upload button | ⚠️ | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Upload card design (back) | CardReissueTab upload button | ⚠️ | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Clear / Reset card design | CardReissueTab clear buttons | ⚠️ | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Lưu mẫu mặt sau | CardReissueTab backend config | ⚠️ | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Lưu, ghi log & In 2 mặt | CardReissueTab print button | ⚠️ | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Reset card reissue form | Reset button in CardReissueTab | · | Q6 + tab Cấp lại thẻ (đã build PR #725) |
| Xác nhận FUNDED | Staking Pending Confirm tab | 💰 | Q5 · chi tiết/lịch sử = máy tính |
| Scan club filter (Staking) | Result & Payout tab | · | Q5 · chi tiết/lịch sử = máy tính |
| Clear club filter (Staking) | Result tab filter badge | · | Q5 · chi tiết/lịch sử = máy tính |
| Mở detail | Result tab open button | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Search staking history | History tab search input | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Export staking history Excel | History tab download button | · | Q5 · chi tiết/lịch sử = máy tính |
| Hoàn tiền (Initiate refund) | Refund tab deal row | · | Q5 · chi tiết/lịch sử = máy tính |
| Xác nhận hoàn tiền | Refund confirmation dialog | 💰 | Q5 · chi tiết/lịch sử = máy tính |
| Search refund history | Refund History tab input | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Export refund history Excel | Refund History tab download button | · | Q5 · chi tiết/lịch sử = máy tính |
| Switch tabs: Chờ xác nhận / Check-in / Kết quả / Lịch sử / Hoàn tiền / Lịch sử hoàn tiền | Staking section | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Set date range (Revenue report) | RevenueReportTab date inputs | · | máy tính |
| Filter by club (Revenue report) | RevenueReportTab club dropdown | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Refresh staking deals list | Tab refresh buttons | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Export revenue data Excel | RevenueReportTab download button | · | máy tính |
| Refresh sync history | SyncMembersTab history section | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Refresh reissue history | CardReissueTab history section | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Refresh verification queue | VerificationRequestsTab header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Cancel rejection dialog | Rejection confirmation dialog | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Cancel refund dialog | Refund confirmation dialog | · | Q5 · chi tiết/lịch sử = máy tính |
| Huỷ (General cancel buttons) | Dialog footer buttons | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |

## fnb (43 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Switch tabs | FnbCounter, FnbAdmin, ShiftReconciliationPanel | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Select club | FnbCounter, FnbKitchenDisplay, FnbAdmin, FnbServe | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Add item to cart (tap menu tile) | OrderEntryPanel | · | P3 |
| Category filter chips | OrderEntryPanel | · | P3 |
| Adjust qty (+/-) | OrderEntryPanel cart | · | P3 |
| Set table & customer info | OrderEntryPanel | · | P3 |
| Tạo đơn & thu tiền | OrderEntryPanel | 💰 | P3 |
| Comp / Miễn phí | OrderEntryPanel | 💰 | F2 |
| Huỷ (pending order) | FnbCounter Chờ thanh toán | ⚠️ | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Thu tiền (pending order) | FnbCounter Chờ thanh toán | 💰 | F2 |
| Huỷ / Hoàn (paid order) | FnbCounter Đã thu | ⚠️ | F2 |
| Thu tiền (payment dialog) | FnbConfirmPaymentDialog | 💰 | F2 |
| Xác nhận COMP | Comp dialog | 💰 | F2 |
| Mở ca (open shift) | ShiftReconciliationPanel | ⚠️ | P5 |
| Chốt ca (close shift) | ShiftReconciliationPanel | 💰 | P5 |
| Xong (mark line shipped) | KitchenTicket | ⚠️ | P4 |
| Tất cả xong (all shipped) | KitchenTicket | ⚠️ | P4 |
| Đã thu tiền mặt (serve payment) | FnbServe queue | 💰 | F2 |
| Thêm món | MenuManager | ⚠️ | máy tính (quản trị) |
| Edit menu item | MenuManager | ⚠️ | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Thêm danh mục | CategoryManager | ⚠️ | P3 |
| Edit category | CategoryManager | ⚠️ | P3 |
| Thêm nguyên liệu | IngredientManager | ⚠️ | máy tính (quản trị) |
| Edit ingredient | IngredientManager | ⚠️ | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Chọn món (recipe editor) | RecipeEditor | · | máy tính (quản trị) |
| Thêm nguyên liệu (recipe line) | RecipeEditor | · | máy tính (quản trị) |
| Lưu công thức | RecipeEditor | ⚠️ | máy tính (quản trị) |
| Nhập kho (stock in) | StockInForm | 💰 | máy tính (quản trị) |
| Tạo phiên kiểm kho | StocktakeBoard | ⚠️ | R5 |
| Count qty (on blur save) | StocktakeBoard ingredient rows | ⚠️ | P3 |
| Chốt kiểm kho | StocktakeBoard | 💰 | R5 |
| Search staff | FnbStaffManager | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Toggle role (Thu ngân/Phục vụ/Bếp) | FnbStaffManager | ⚠️ | máy tính (quản trị) |
| Tạo mã QR (table guest order) | FnbTableQrManager | ⚠️ | R4 |
| Copy link | FnbTableQrManager QR card | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| In (print QR) | FnbTableQrManager QR card | · | R4 |
| Đổi mã (rotate QR token) | FnbTableQrManager QR card | ⚠️ | R4 |
| Thu hồi (revoke QR) | FnbTableQrManager QR card | ⚠️ | R4 |
| Save F&B settings | FnbSettingsPanel | ⚠️ | máy tính (quản trị) |
| Toggle restock on cancel | FnbSettingsPanel | ⚠️ | máy tính (quản trị) |
| Toggle F&B in club net | FnbSettingsPanel | ⚠️ | máy tính (quản trị) |
| Select date range (report) | FnbReportPanel | · | máy tính (quản trị) |
| Quick date shortcuts | FnbReportPanel | · | máy tính (quản trị) |

## marketing (36 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Chọn câu lạc bộ | Club selector dropdown | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Soạn bài | Tab navigation | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Bài viết | Tab navigation | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Tự động | Tab navigation (owner only) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Kênh | Tab navigation (owner only) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Switch tabs: Nhân sự | Tab navigation (owner only) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Thêm ảnh | Post Composer, Image section | · | P6 |
| Xoá ảnh | Post Composer, Image thumbnails | · | P6 |
| Select channel (Telegram) | Post Composer, Channels section | · | P6 |
| Select channel (Facebook) | Post Composer, Channels section | · | P6 |
| Select channel (Zalo OA) | Post Composer, Channels section | · | P6 |
| Đăng ngay (radio) | Post Composer, Schedule section | · | P6 |
| Lên lịch (radio) | Post Composer, Schedule section | · | P6 |
| Chọn thời gian đăng | Post Composer, Schedule datetime picker | · | P6 |
| Lưu nháp | Post Composer, Action buttons | ⚠️ | P6 |
| Đăng ngay / Lên lịch | Post Composer, Action buttons | ⚠️ | P6 |
| Làm mới | Post List, refresh button | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Đăng ngay | Post List, Post row actions (draft) | ⚠️ | M2 |
| Lên lịch | Post List, Post row actions (draft) | ⚠️ | M2 |
| Chọn thời gian đăng | Post List, Schedule picker (if expanded) | · | P6 |
| Xác nhận | Post List, Schedule confirmation | ⚠️ | M2 |
| Huỷ | Post List, Post row actions | ⚠️ | M2 |
| Bật tự động tạo nội dung | MarketingAutomation, Enable toggle | ⚠️ | máy tính (cấu hình) |
| Lịch giải ngày mai | MarketingAutomation, Kinds checkboxes | · | máy tính (cấu hình) |
| Đang livestream | MarketingAutomation, Kinds checkboxes | · | máy tính (cấu hình) |
| Cảnh báo overlay | MarketingAutomation, Kinds checkboxes | · | máy tính (cấu hình) |
| Select channel (Telegram) | MarketingAutomation, Channels checkboxes | · | P6 |
| Select channel (Facebook) | MarketingAutomation, Channels checkboxes | · | P6 |
| Lưu | MarketingAutomation, Save button | ⚠️ | máy tính (cấu hình) |
| Lưu | ChannelSettings Telegram, Save button | ⚠️ | máy tính (cấu hình) |
| Dùng bot chung (xoá token) | ChannelSettings Telegram, Clear token | ⚠️ | máy tính (cấu hình) |
| Toggle Facebook guide | ChannelSettings Facebook, Collapsible | · | máy tính (cấu hình) |
| Lưu | ChannelSettings Facebook, Save button | ⚠️ | máy tính (cấu hình) |
| Xoá token (tắt Facebook) | ChannelSettings Facebook, Clear token | ⚠️ | máy tính (cấu hình) |
| Tìm theo tên hoặc SĐT | MarketingStaffManager, Search input | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Cấp quyền / Thu hồi | MarketingStaffManager, Member row button | ⚠️ | máy tính (cấu hình) |

## chip-ops (35 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Switch tabs | Chip Ops main interface | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Choose tournament | Topbar tournament dropdown | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Create & bind new chip set | Setup stack tab, Chip set card | ⚠️ | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Bind existing chip set | Setup stack tab, Chip set card | ⚠️ | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Delete denomination | Setup stack tab, Denominations table row | ⚠️ | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Add denomination | Setup stack tab, Chip set card | 💰 | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Save stack template | Setup stack tab, Stack template card | ⚠️ | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Set issuance / Lưu & xuất / Lưu & thu | Setup stack tab, Issuance card per template row | 💰 | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Select denomination to remove | Color-Up tab, Rút mệnh giá dropdown | · | R2 |
| Select target denomination | Color-Up tab, Race lên dropdown | · | R2 |
| Confirm color-up | Color-Up tab, Color-up card | 💰 | R2 |
| Reverse color-up | Color-Up tab, Color-up history table row | 💰 | R2 |
| Choose bag day | Bag & Tag tab, Day selector dropdown | · | R3 |
| Add new day | Bag & Tag tab, New day button | · | R3 |
| Enter bag total for player | Bag & Tag tab, Chip đóng bao table cell | ⚠️ | R3 |
| Enter bag code | Bag & Tag tab, Mã bao table cell | ⚠️ | R3 |
| Seal bag | Bag & Tag tab, Bao table row action button | ⚠️ | R3 |
| Unseal bag | Bag & Tag tab, Bao table row action button | ⚠️ | R3 |
| Lock day | Bag & Tag tab, Chốt ngày card | ⚠️ | R3 |
| Lock with sign-off | Bag & Tag tab, Force lock button | ⚠️ | R3 |
| Reopen day | Bag & Tag tab, Reopen day button | ⚠️ | R3 |
| Enter sign-off reason | Bag & Tag tab, Sign-off dialog textarea | ⚠️ | R3 |
| Toggle auto-coupling | Kho / Audit tab, Model A switch | 💰 | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Choose denomination to adjust | Kho / Audit tab, Manual adjustment dropdown | · | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Choose adjustment direction | Kho / Audit tab, Direction dropdown | · | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Enter adjustment chip count | Kho / Audit tab, Manual adjustment count field | 💰 | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Submit manual bank adjustment | Kho / Audit tab, Thu/Xuất button | 💰 | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Open bank sync dialog | Kho / Audit tab, Đồng bộ kho két button | · | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Enter total owned per denomination | Kho / Audit tab, Sync dialog denomination field | 💰 | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Run bank sync | Kho / Audit tab, Sync dialog confirm button | 💰 | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Close sync dialog | Kho / Audit tab, Sync dialog close button | · | máy tính (kho két, money) · C2 chỉ xem + cảnh báo lệch |
| Refresh color-up view | Color-Up tab (implicit on tab open) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Refresh bag/tag state | Bag & Tag tab (implicit on day change) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Refresh bank inventory | Kho / Audit tab (implicit on tab open) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| View dashboard | Tổng quan tab (Overview) | · | C1 |

## finance-accounting-series (44 nút)

| Nút | Ở đâu (bản cũ) | Mức | Màn mobile |
|---|---|---|---|
| Set date range (7/30/This month buttons) — ClubFinanceDashboard | Finance Dashboard header | · | T1/T2 xem · lọc sâu + xuất = máy tính |
| Set custom from/to dates — ClubFinanceDashboard | Finance Dashboard filter card | · | T1/T2 xem · lọc sâu + xuất = máy tính |
| Select club (dropdown) — ClubFinanceDashboard | Finance Dashboard filter (admin only) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Làm mới (Refresh button) — ClubFinanceDashboard | Finance Dashboard header | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Xuất Excel (Export button) — ClubFinanceDashboard | Finance Dashboard header | · | T1/T2 xem · lọc sâu + xuất = máy tính |
| Click club row — ClubFinanceDashboard | Per-club table (admin only) | · | T1/T2 xem · lọc sâu + xuất = máy tính |
| Xem Cảnh báo lệch số (View alerts button) — OverviewTab | Overview tab (bottom) | · | AC1/AC2 cảnh báo · cockpit 11 tab = máy tính |
| Switch tabs: Tổng quan / Chốt sổ / Event P&L / Series P&L / etc. (11 tabs) | Accounting Control tab navigation | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Xem báo cáo (View Report button) — SeriesIntelligence | Series Intelligence header | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Quay lại (Back button) — SeriesIntelligence | Series Intelligence header / Report | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Tải mẫu CSV (Download template button) — CsvImportPanel | Series Intelligence Step 1 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Tải lên CSV (Upload button) — CsvImportPanel | Series Intelligence Step 1 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Dùng dữ liệu mẫu (Use sample data button) — SeriesIntelligence | Series Intelligence empty state | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Chọn series (Select active series) — SeriesLibraryPanel | Series Library panel (Step 1) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Đổi tên series (Rename button) — SeriesLibraryPanel | Series Library panel card | ⚠️ | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Xóa series (Delete button) — SeriesLibraryPanel | Series Library panel card | ⚠️ | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Xóa tất cả (Clear all button) — SeriesLibraryPanel | Series Library panel header | ⚠️ | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Sinh lịch (Generate schedule button) — ScheduleGeneratorPanel | Series Intelligence Step 3 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Edit festival parameters (form fields) — ScheduleGeneratorPanel | Series Intelligence Step 3 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Edit TD-rule defaults (table inputs) — ScheduleGeneratorPanel | Series Intelligence Step 3 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Mùa vụ toggle (Seasonality checkbox) — ScheduleGeneratorPanel | Series Intelligence Step 3 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Thêm tour (Add custom event button) — ScheduleGeneratorPanel | Series Intelligence Step 3 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Xóa tour (Delete custom event button) — ScheduleGeneratorPanel | Series Intelligence Step 3 (custom event row) | ⚠️ | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Edit custom event fields — ScheduleGeneratorPanel | Series Intelligence Step 3 (custom event card) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Enter forecast parameters (date/time/buy-in/GTD) — TurnoutForecastPanel | Series Intelligence Step 4 (left column form) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Lịch sử nhóm toggle — MonteCarloPanel | Series Intelligence Step 4 (center source buttons) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Dự báo toggle — MonteCarloPanel | Series Intelligence Step 4 (center source buttons) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Select event group (group buttons) — MonteCarloPanel | Series Intelligence Step 4 (history mode) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Adjust GTD slider — MonteCarloPanel | Series Intelligence Step 4 (risk panel) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Thật vs giả lập n toggle — MonteCarloPanel | Series Intelligence Step 4 (n-mode buttons) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Adjust SD slider — MonteCarloPanel | Series Intelligence Step 4 (history mode SD control) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Đổi seed (Resimulate button) — MonteCarloPanel | Series Intelligence Step 4 (risk panel) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Xem rủi ro overlay với dự đoán này (CTA button) — TurnoutForecastPanel | Series Intelligence Step 4 (forecast card) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Sửa đè con số (Manual override input) — TurnoutForecastPanel | Series Intelligence Step 4 (forecast forecast card) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Dùng dự đoán (Reset override button) — TurnoutForecastPanel | Series Intelligence Step 4 (forecast card) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Nhập tiêu đề/phụ đề/địa điểm/ngày (Poster metadata) — ScheduleExportPanel | Series Intelligence Step 5 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Đã TD review toggle — ScheduleExportPanel | Series Intelligence Step 5 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Tải PNG (poster download button) — ScheduleExportPanel | Series Intelligence Step 5 | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Tải Excel (Excel download button) — ScheduleExportPanel | Series Intelligence Step 5 | · | T1/T2 xem · lọc sâu + xuất = máy tính |
| Chọn CLB (Club dropdown) — SeriesCaptureConsole | Series Intelligence Step 6 (Capture console) | · | điều khiển phụ — nằm ngay trong màn chứa nó |
| Chọn giải (Event dropdown) — SeriesCaptureConsole | Series Intelligence Step 6 (Capture console) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Sync ngay (Manual sync button) — SeriesCaptureConsole | Series Intelligence Step 6 (Capture console) | · | SI1/SI2 đọc + ghi quyết định · phân tích/sinh lịch/xuất = máy tính |
| Event P&L event button selector | Event P&L tab | · | bước con trong luồng đã gán ở nút cha — không cần màn riêng |
| Xem tab (Navigate to tab link) — VarianceAlertsTab | Variance Alerts tab (alert row) | · | AC1/AC2 cảnh báo · cockpit 11 tab = máy tính |
