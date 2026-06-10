# Dealer Swing — UAT Checklist (12-Hour MVP)

> **Mục đích**: Checklist kiểm thử thủ công cho cashier / admin trước khi go-live.
> Mỗi test case có expected result và câu SQL verify nếu cần.
> Xem kiến trúc tổng quan tại [`DEALER_SWING_ARCHITECTURE.md`](./DEALER_SWING_ARCHITECTURE.md).

**Legend**: ✅ Pass · ❌ Fail · ⚠️ Partial · — Not applicable

---

## 1. Pre-test Setup

| # | Bước chuẩn bị | Expected | Status |
|---|---------------|----------|--------|
| 1.1 | Tối thiểu 4 dealer đã check-in (current_state = available) | `count >= 4` trong query bên dưới | — |
| 1.2 | Tối thiểu 2 bàn đang active (status = assigned, released_at IS NULL) | `count >= 2` | — |
| 1.3 | `club_settings.telegram_chat_id` đã được set cho club | Không null/empty | — |
| 1.4 | `TELEGRAM_BOT_TOKEN` env var đã được set trên Supabase Edge Function | Bot token hợp lệ | — |
| 1.5 | `process-swing` function đã deploy version mới nhất (Patches 1–4) | Deno deploy thành công | — |
| 1.6 | Cashier UI đang mở, đang ở tab Dealer Swing | Tab hiển thị danh sách bàn | — |
| 1.7 | Telegram group đang mở và bot có quyền gửi tin | Bot không bị muted/blocked | — |

```sql
-- 1.1 Verify available dealers
SELECT count(*) FROM dealer_attendance
WHERE club_id = '<your_club_id>'
  AND current_state = 'available'
  AND status = 'checked_in';

-- 1.2 Verify active assignments
SELECT count(*) FROM dealer_assignments
WHERE club_id = '<your_club_id>'
  AND status = 'assigned'
  AND released_at IS NULL
  AND swing_processed_at IS NULL;
```

---

## 2. Dealer Check-in

| # | Test | Expected | Status |
|---|------|----------|--------|
| 2.1 | Dealer A check-in qua UI hoặc thủ công | `current_state = 'available'`, `status = 'checked_in'` | — |
| 2.2 | Dealer A xuất hiện trong danh sách available của cashier UI | Tên dealer thấy được trong pool | — |

```sql
-- 2.1 Verify check-in
SELECT d.full_name, da.current_state, da.status, da.checked_in_at
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'checked_in'
ORDER BY da.checked_in_at DESC
LIMIT 10;
```

---

## 3. Assign Dealer to Empty Table

| # | Test | Expected | Status |
|---|------|----------|--------|
| 3.1 | Gán thủ công Dealer A vào Bàn 1 (đang trống) qua nút "Gán dealer" | Bàn 1 hiển thị tên Dealer A, trạng thái "Đang làm" | — |
| 3.2 | `dealer_assignments` có row mới: `status='assigned'`, `released_at IS NULL` | Row tồn tại với đúng `attendance_id` | — |
| 3.3 | `dealer_attendance.current_state` của Dealer A = `assigned` | State đổi thành công | — |

```sql
-- 3.2 Verify assignment
SELECT da.id, da.table_id, da.status, da.swing_due_at,
       d.full_name AS dealer, gt.table_name
FROM dealer_assignments da
JOIN dealer_attendance att ON att.id = da.attendance_id
JOIN dealers d ON d.id = att.dealer_id
JOIN game_tables gt ON gt.id = da.table_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'assigned'
  AND da.released_at IS NULL
ORDER BY da.created_at DESC
LIMIT 5;
```

---

## 4. Pre-assign Next Dealer (Pass 2)

| # | Test | Expected | Status |
|---|------|----------|--------|
| 4.1 | Đợi hoặc set `swing_due_at` của Bàn 1 về T+5min | `swing_due_at` nằm trong cửa sổ Pass 2 | — |
| 4.2 | `process-swing` chạy (cron 30s) — Pass 2 phát hiện Bàn 1 | Log: `[Pass 2] ✅ Bàn 1: Dealer B pre-assigned` | — |
| 4.3 | Log structured xuất hiện: `[process-swing][pass2][preassign-created]` | `assignment_id`, `incoming_dealer_name`, `minutes_left` đúng | — |
| 4.4 | `dealer_assignments.pre_assigned_attendance_id` được set | FK trỏ đúng tới `dealer_attendance.id` của Dealer B | — |
| 4.5 | Dealer B `current_state = 'pre_assigned'` | State đổi thành công | — |
| 4.6 | Cashier UI — "Tiếp:" block của Bàn 1 hiển thị `✓ Dealer B` | Không còn hiển thị `~ prediction` nữa (Patch 1 fix) | — |
| 4.7 | Nếu pre-assign trễ/stale: status label `· Đang chuyển` hoặc `· Quá hạn (chờ vào)` xuất hiện | Label có màu đúng (purple/amber) | — |
| 4.8 | Telegram group nhận được pre-announce | `📋 Tiếp theo Bàn 1: A ra, B vào (HH:MM, còn N phút)` | — |
| 4.9 | Log: `[process-swing][pass2][telegram-preannounce-sent]` hoặc `-queued` | Một trong hai xuất hiện, không phải `-failed` | — |

```sql
-- 4.4 Verify pre-assignment
SELECT da.id, da.table_id, gt.table_name,
       da.pre_assigned_attendance_id,
       d_in.full_name AS incoming_dealer,
       att_in.current_state AS incoming_state,
       da.swing_due_at
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
JOIN dealer_attendance att_in ON att_in.id = da.pre_assigned_attendance_id
JOIN dealers d_in ON d_in.id = att_in.dealer_id
WHERE da.club_id = '<your_club_id>'
  AND da.pre_assigned_attendance_id IS NOT NULL
  AND da.status = 'assigned'
  AND da.released_at IS NULL;
```

---

## 5. Execute Pre-assigned Swing (Pass 3)

| # | Test | Expected | Status |
|---|------|----------|--------|
| 5.1 | `swing_due_at` của Bàn 1 đã qua (T-0) | Bàn 1 nằm trong query `dueAssignments` của Pass 3 | — |
| 5.2 | Pass 3 chạy — guard Patch 4 KHÔNG fire (Dealer B vẫn `pre_assigned`) | Không có log `[guard-stale-preassign]` | — |
| 5.3 | `execute_pre_assigned_swing_rpc` trả về `status: "success"` | Không có log `execute-failed` | — |
| 5.4 | Log structured: `[process-swing][pass3][execute-success]` | `incoming_dealer_name`, `outgoing_dealer_name`, `new_assignment_id` đúng | — |
| 5.5 | Dealer A `current_state = 'on_break'` hoặc `available` (tùy `breakDecision`) | State released đúng | — |
| 5.6 | Dealer B `current_state = 'assigned'` | Incoming dealer đã được gán vào bàn | — |
| 5.7 | `dealer_assignments` cũ của Bàn 1: `status = 'completed'`, `swing_processed_at IS NOT NULL` | Assignment hoàn thành | — |
| 5.8 | Bàn 1 trên UI hiển thị Dealer B, không còn "Tiếp:" block | UI realtime update đúng | — |
| 5.9 | **Telegram confirmation** nhận được (Patch 2) | `🔵 B vừa vào bàn Bàn 1\nThay thế: A` | — |
| 5.10 | Log: `[process-swing][pass3][telegram-confirmation-dispatched]` | Xuất hiện trước hoặc cùng với message Telegram | — |

```sql
-- 5.7 Verify completed swing
SELECT da.id, gt.table_name, da.status, da.swing_processed_at,
       d_out.full_name AS outgoing, d_in.full_name AS incoming,
       da.created_at
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
LEFT JOIN dealer_attendance att_out ON att_out.id = da.attendance_id
LEFT JOIN dealers d_out ON d_out.id = att_out.dealer_id
LEFT JOIN dealer_attendance att_in ON att_in.id = da.pre_assigned_attendance_id
LEFT JOIN dealers d_in ON d_in.id = att_in.dealer_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'completed'
ORDER BY da.swing_processed_at DESC
LIMIT 5;
```

---

## 6. Empty-table Handoff (Bàn trống)

| # | Test | Expected | Status |
|---|------|----------|--------|
| 6.1 | Tạo assignment cho bàn trống với `pre_assigned_attendance_id` set nhưng không có outgoing dealer rõ ràng | `outgoing_dealer.full_name` = "Unknown" hoặc null | — |
| 6.2 | Pass 3 thực thi swing thành công | `status: "success"` | — |
| 6.3 | Telegram: `🔵 B vừa vào bàn X (Bàn trống)` (không có "Thay thế:") | Message format đúng theo Patch 2 | — |

---

## 7. Stale Pre-assign Guard (Patch 4)

| # | Test | Expected | Status |
|---|------|----------|--------|
| 7.1 | Chuẩn bị: có assignment với `pre_assigned_attendance_id = Dealer C` | Dealer C `current_state = 'pre_assigned'` | — |
| 7.2 | Thủ công đổi Dealer C về `current_state = 'available'` trong DB | `UPDATE dealer_attendance SET current_state='available' WHERE id=...` | — |
| 7.3 | Chạy `process-swing` (hoặc đợi cron) | Pass 3 trigger cho assignment này | — |
| 7.4 | Guard fires: `process-swing` KHÔNG gọi `execute_pre_assigned_swing_rpc` | Không có log `[pass3][execute-success]` hoặc `execute-failed` cho assignment này | — |
| 7.5 | Log xuất hiện: `[process-swing][pass3][guard-stale-preassign]` | `reason: "dealer_released_to_available"`, `current_state: "available"` | — |
| 7.6 | `metrics.skipped` tăng 1 | Thấy trong summary log của Pass 3 | — |
| 7.7 | Swing không crash, các bàn khác vẫn xử lý bình thường | Không có lỗi unhandled | — |

```sql
-- 7.2 Set up stale guard test (run manually)
-- CAUTION: chỉ test trên dealer đang pre_assigned, không test trên dealer đang assigned
UPDATE dealer_attendance
SET current_state = 'available'
WHERE id = '<pre_assigned_attendance_id>'
  AND current_state = 'pre_assigned';
```

---

## 8. Duplicate Prevention Smoke Test

| # | Test | Expected | Status |
|---|------|----------|--------|
| 8.1 | Invoke `process-swing` 2 lần liên tiếp (hoặc 2 cron tick sát nhau) | Club lock ngăn tick thứ 2 chạy khi tick 1 đang xử lý | — |
| 8.2 | Không có 2 `dealer_assignments` active (`status='assigned'`, `released_at IS NULL`) cùng `table_id` | Query bên dưới trả về 0 rows | — |
| 8.3 | Telegram group không nhận duplicate message `🔵 B vừa vào bàn X` cho cùng 1 swing | Chỉ 1 message per swing | — |
| 8.4 | `swing_processed_at` chỉ được set 1 lần | Không có 2 assignments `completed` cùng `table_id` trong cùng thời điểm | — |

```sql
-- 8.2 Detect duplicate active assignments per table
SELECT table_id, count(*) AS active_count
FROM dealer_assignments
WHERE club_id = '<your_club_id>'
  AND status = 'assigned'
  AND released_at IS NULL
  AND swing_processed_at IS NULL
GROUP BY table_id
HAVING count(*) > 1;
-- Expected: 0 rows
```

---

## 9. Telegram Failure Safety

| # | Test | Expected | Status |
|---|------|----------|--------|
| 9.1 | Đặt `club_settings.telegram_chat_id = NULL` hoặc set `TELEGRAM_BOT_TOKEN` sai | Telegram call sẽ fail | — |
| 9.2 | Chạy `process-swing` — swing vẫn xảy ra | `status: "success"`, `swing_processed_at IS NOT NULL` | — |
| 9.3 | Log xuất hiện: `[process-swing][pass3][telegram-confirmation-failed]` hoặc `[pass2][telegram-preannounce-failed]` | Error được log, không throw | — |
| 9.4 | Không có crash / unhandled exception | Function trả về 200 OK | — |
| 9.5 | Khôi phục `telegram_chat_id` và `TELEGRAM_BOT_TOKEN` đúng | Telegram hoạt động lại ở tick tiếp theo | — |

---

## 10. Break / Meal Break Smoke Test

| # | Test | Expected | Status |
|---|------|----------|--------|
| 10.1 | Dealer A đang assigned → cho break sau khi swing (breakDecision = shouldBreak) | Dealer A `current_state = 'on_break'` | — |
| 10.2 | Telegram: break_start notification gửi qua TelegramNotifier | Tin nhắn về break trong group | — |
| 10.3 | Sau khi break hết hạn, Pass 4 kết thúc break | Dealer A `current_state = 'available'` | — |
| 10.4 | Dealer A xuất hiện lại trong dealer pool (sẵn sàng nhận bàn) | Không bị stuck `on_break` vô hạn | — |
| 10.5 | Không có bàn nào bị stuck không có dealer sau khi toàn bộ flow chạy | `count(*) = 0` cho query "tables without dealer" | — |

```sql
-- 10.5 Tables with no active dealer (should be 0 for all active tables)
SELECT gt.table_name, da.status, da.attendance_id
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'assigned'
  AND da.released_at IS NULL
  AND da.attendance_id IS NULL;
-- Expected: 0 rows
```

---

## 11. Regression Checks

| # | Test | Expected | Status |
|---|------|----------|--------|
| 11.1 | Normal `perform_swing` path (không pre-assigned) vẫn gửi Telegram | `🔵 B vào bàn X - Thay A` (format cũ, không phải Patch 2 format) | — |
| 11.2 | "Tiếp:" block cho prediction-only (không có `preAssignedMap` entry) vẫn hiển thị `~ predicted` | Prediction fallback không bị ảnh hưởng (Patch 1 không đổi pred behavior) | — |
| 11.3 | Nút "Gán dealer" trên bàn trống vẫn hoạt động | Bàn nhận dealer thủ công như trước | — |
| 11.4 | Các pass 0a–0e, Pass 1, Pass 1b không bị ảnh hưởng | Không có log error từ các pass này liên quan đến patches | — |
| 11.5 | `breakDecision`, `evaluateBreakNeed` vẫn đúng | Dealer có đủ work time vẫn nhận break đúng chu kỳ | — |

---

## 12. Final Acceptance Checklist

| # | Hạng mục | Expected | Status |
|---|----------|----------|--------|
| 12.1 | `cd VinPoker && npm run build` | `✓ built` — 0 TS errors mới | — |
| 12.2 | `deno check supabase/functions/process-swing/index.ts` | `Check` — clean | — |
| 12.3 | `deno check supabase/functions/process-swing/passes/pass2-pre-assign.ts` | `Check` — clean | — |
| 12.4 | `git status` — chỉ `.gitignore`, `version.json` modified; không có unintended changes | 0 unexpected modified app files | — |
| 12.5 | Tests 2–11 đã pass (hoặc được ghi chú rõ lý do skip) | Tất cả ✅ hoặc documented ⚠️ | — |
| 12.6 | Không có file migration nào bị sửa | `git diff supabase/migrations/` = empty | — |
| 12.7 | Không có RPC signature nào bị thay đổi | Verify bằng cách check `git diff` trên migration files | — |

```sql
-- 12.4 Final state: overview of active assignments
SELECT gt.table_name,
       d.full_name AS current_dealer,
       att.current_state,
       da.swing_due_at,
       d_in.full_name AS incoming_dealer,
       att_in.current_state AS incoming_state
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
JOIN dealer_attendance att ON att.id = da.attendance_id
JOIN dealers d ON d.id = att.dealer_id
LEFT JOIN dealer_attendance att_in ON att_in.id = da.pre_assigned_attendance_id
LEFT JOIN dealers d_in ON d_in.id = att_in.dealer_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'assigned'
  AND da.released_at IS NULL
ORDER BY gt.table_name;
```

---

## SQL Reference nhanh

```sql
-- All active assignments
SELECT da.id, gt.table_name, d.full_name, da.status,
       da.swing_due_at, da.swing_in_progress,
       da.pre_assigned_attendance_id
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
JOIN dealer_attendance att ON att.id = da.attendance_id
JOIN dealers d ON d.id = att.dealer_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'assigned'
  AND da.released_at IS NULL
ORDER BY gt.table_name;

-- All dealer states
SELECT d.full_name, da.current_state, da.status,
       da.checked_in_at, da.last_swing_at
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'checked_in'
ORDER BY da.current_state, d.full_name;

-- Recent completed swings (last 10)
SELECT gt.table_name, d.full_name AS outgoing,
       da.swing_processed_at, da.status
FROM dealer_assignments da
JOIN game_tables gt ON gt.id = da.table_id
JOIN dealer_attendance att ON att.id = da.attendance_id
JOIN dealers d ON d.id = att.dealer_id
WHERE da.club_id = '<your_club_id>'
  AND da.status = 'completed'
ORDER BY da.swing_processed_at DESC
LIMIT 10;

-- diagnostic_logs (structured event log)
SELECT diagnostic_type, result, created_at
FROM diagnostic_logs
WHERE club_id = '<your_club_id>'
ORDER BY created_at DESC
LIMIT 20;
```
