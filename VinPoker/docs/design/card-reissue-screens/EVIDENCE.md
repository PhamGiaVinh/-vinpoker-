# Cấp lại thẻ (Card Reissue) — evidence

Ported từ bản Lovable của owner + phát triển thêm. Vị trí: Cashier → **Thành viên → Cấp lại thẻ**.

- `member-card-front-back.png` — thiết kế thẻ CR80 (85.6×54mm) đã nâng cấp: **mặt trước dark-plum + gold**
  (Midnight Sakura brand) thay cho slate/black của bản cũ; **mặt sau** light + gold rule + nội quy/hotline/địa chỉ.
  Chụp thật qua route DEV `/__dev/card` (fixture, không Supabase; route bị strip khỏi bản production).

## Cải tiến so với bản Lovable
1. **Thẻ đẹp hơn, đúng brand** (dark-plum + aged gold), print-safe (màu hex cố định + mm, không theo theme).
2. **In luôn hoạt động dù chưa áp migration**: log ghi nhật ký là *best-effort* (không chặn in). Bản cũ
   `throw` khi ghi log lỗi → không in được. Bản mới: in xong vẫn in, chỉ cảnh báo "lịch sử chưa bật".
3. **Degrade gọn** khi thiếu bảng `card_reissue_log` (banner + notice, không crash).
4. Tái dùng hạ tầng có sẵn: `Html5Qrcode` (như ClubQrScanDialog), `club_members` live, RPC cashier scope.

## Phụ thuộc DB
- Bảng `card_reissue_log` (audit log) — migration `20261218000000_card_reissue_log.sql` **SOURCE-ONLY**,
  owner áp dụng trong phiên gated. Trước khi áp: scan/enroll/edit/**in** đều chạy (dùng `club_members` live);
  chỉ lịch sử + ghi log cần bảng này.
- `club_members` (đã live, đủ cột), RPC `is_club_cashier`/`has_role`/`cashier_club_ids` (đã live).
