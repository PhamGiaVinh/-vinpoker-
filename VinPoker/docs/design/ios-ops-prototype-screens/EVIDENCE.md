# mobileOpsV2 prototype — "Floor hôm nay" screens

Ảnh preview **thật** của màn prototype (không phải mock HTML). Chụp bằng Playwright trên local dev server
(`npm run dev`, port 8096) tại route `/ops`, cờ `FEATURES.mobileOpsV2` bật tạm để render (đã trả về `false`
trong commit). **Dữ liệu là DỮ LIỆU MẪU** (fictional — `src/components/ops/mock/floorToday.ts`), không có PII
prod → an toàn để commit (khác evidence audit prod ở `iphone-operations-screens/` — nơi không commit ảnh).

**5 tab đã dựng đầy đủ** (không còn placeholder) — tất cả DỮ LIỆU MẪU, read-only, chụp thật 390px:

| File | Màn | Ghi chú |
|------|-----|---------|
| `floor-today-390.png` | Hôm nay | cockpit; 6-câu-trong-5-giây; thumb-zone actions |
| `floor-today-430.png` / `-768.png` | Hôm nay | Pro Max + tablet (nội dung `max-w-md` canh giữa, không vỡ) |
| `tables-390.png` | Bàn | lưới card 2 cột (Đang chạy/Cần xử lý/Trống/Tạm dừng); tap → sheet ghế → sheet hành động → xác nhận Loại |
| `alerts-390.png` | Cảnh báo | hàng đợi sự cố + FinancialWarningCard read-only ("Còn lại sau lương"/"Tiền chuyển hộ · Nợ phải trả"/"Biên đóng góp ≠ Lợi nhuận", DỮ LIỆU MẪU) |
| `tournaments-390.png` | Giải đấu | list giải + chip trạng thái |
| `more-390.png` | Thêm | tìm người chơi (sheet) · Dealer status · link Cashier/F&B/Chip · desktop-only (Nhập hand/Series/Tài chính) |

Xác nhận: theme Midnight Sakura đúng (nền dark plum, accent vàng, chip emerald/amber/rose/sky), nhãn
"DỮ LIỆU MẪU" khắp nơi, floor KHÔNG thao tác tiền (RoleLockedAction + FinancialWarningCard read-only),
hành động chính ở thumb-zone, bottom nav 5 tab (Cảnh báo badge 4), safe-area shell. **Console 0 error** mọi
route; **tsc -b 0 lỗi mới** (baseline 75). Manifest `theme_color` sửa #3b82f6→#120C18 (dark plum khớp header,
hết xanh SaaS). Cờ `mobileOpsV2` trả về **OFF** trong commit → prod byte-identical.
