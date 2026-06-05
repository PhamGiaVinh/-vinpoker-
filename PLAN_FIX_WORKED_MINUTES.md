# PLAN: Fix worked_minutes hiển thị sai (1018–2264 phút)

## 1. Bug

Dealer hiển thị "Đã làm 1018 / 2264 / 1460 / 1507 phút" — quá cao so với thực tế.

## 2. Root cause

`calculateLiveWorkedMinutes()` (file: `src/lib/dealerWorkedMinutes.ts`):

```ts
if (assignment?.assigned_at) {
  // Dealer đang assigned → tính từ assigned_at (đúng)
  map[d.id] = (nowMs - assigned_at) / 60000
} else {
  // Dealer KHÔNG assigned (available, on_break, checked_out)
  // → lấy worked_minutes_since_last_break từ DB
  map[d.id] = d.worked_minutes_since_last_break ?? 0
}
```

Vấn đề ở nhánh `else`:
- Cột `worked_minutes_since_last_break` trước đây được tăng mỗi phút bởi cron job
- Migration `20260713000001_reset_worked_minutes_non_working_states.sql` chỉ reset khi dealer **transition** sang `available/on_break/checked_out` — không chạy UPDATE cho các row đã ở state đó trước migration
- Dữ liệu cũ vẫn còn: 2264 phút = 37+ giờ (không thể cho 1 ca)

## 3. Code liên quan

| File | Vai trò |
|------|---------|
| `src/lib/dealerWorkedMinutes.ts` | Tính live worked minutes |
| `src/components/cashier/DealerSwingTab.tsx` | Hiển thị badge "Cần nghỉ", FatigueDot, PriorityBreakIndicator |
| `src/hooks/useDealerSwing.ts` | Fetch dealer_attendance (gồm `worked_minutes_since_last_break`) |
| `supabase/migrations/20260713000001_reset_worked_minutes_non_working_states.sql` | Migration reset column khi transition |

## 4. Fix

### 4a. Frontend — safety cap cho data cũ

File: `src/lib/dealerWorkedMinutes.ts`

Thêm cap: nếu dealer không assigned mà `worked_minutes_since_last_break > 180` (3 giờ là mức tối đa hợp lý cho 1 session), treat as 0.

```ts
} else {
  const stored = d.worked_minutes_since_last_break ?? 0;
  // Data từ cron cũ có thể > 1000 phút → treat as 0
  map[d.id] = stored > 180 ? 0 : stored;
}
```

### 4b. Backend — cleanup dữ liệu cũ

File migration mới: reset `worked_minutes_since_last_break = 0` cho tất cả dealer không ở state `assigned` hoặc `pre_assigned`.

```sql
UPDATE dealer_attendance
SET worked_minutes_since_last_break = 0
WHERE current_state NOT IN ('assigned', 'pre_assigned');
```

## 5. Kết quả mong đợi

- Dealer không assigned hiển thị 0 phút (hoặc số hợp lý từ session gần nhất)
- Dealer đang assigned hiển thị đúng thời gian từ `assigned_at`
- Badge "Cần nghỉ" chỉ hiện cho dealer thực sự đã làm >= 90 phút

## 6. Lưu ý

- Không thay đổi logic tính cho dealer đang assigned (vẫn dùng `assigned_at`)
- `worked_minutes_since_last_break` giờ chỉ là fallback cho non-assigned; với compute-on-read, cột này sẽ dần bị loại bỏ
- Cap 180 phút là safety net cho data corrupt từ cron cũ
