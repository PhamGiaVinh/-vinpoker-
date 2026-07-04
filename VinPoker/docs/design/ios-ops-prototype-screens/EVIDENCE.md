# mobileOpsV2 prototype — "Floor hôm nay" screens

Ảnh preview **thật** của màn prototype (không phải mock HTML). Chụp bằng Playwright trên local dev server
(`npm run dev`, port 8096) tại route `/ops`, cờ `FEATURES.mobileOpsV2` bật tạm để render (đã trả về `false`
trong commit). **Dữ liệu là DỮ LIỆU MẪU** (fictional — `src/components/ops/mock/floorToday.ts`), không có PII
prod → an toàn để commit (khác evidence audit prod ở `iphone-operations-screens/` — nơi không commit ảnh).

| File | Kích thước | Ghi chú |
|------|-----------|---------|
| `floor-today-390.png` | iPhone 14/15 (390×844) | khung chính; đủ cockpit trong 1 màn |
| `floor-today-430.png` | iPhone Pro Max (430×932) | rộng hơn, cùng bố cục |
| `floor-today-768.png` | tablet (768×1024) | nội dung `max-w-md` canh giữa, không giãn/vỡ |

Xác nhận: theme Midnight Sakura đúng (nền dark plum, accent vàng, chip trạng thái emerald/amber/rose),
nhãn "DỮ LIỆU MẪU", "Sửa blind/level — mở trên máy tính" (floor không sửa tiền), hành động chính ở thumb-zone,
bottom nav 5 tab (Cảnh báo badge 4). Console 0 error khi render. tsc -b 0 lỗi mới.
