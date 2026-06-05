# Phân tích Bug Dealer Swing — VinPoker

> Dựa trên dữ liệu user report + đọc toàn bộ codebase swing (edge functions, RPC, hooks, UI).

---

## Tóm tắt 3 Bug

| # | Bug | Biểu hiện | Mức độ |
|---|-----|-----------|--------|
| 1 | **Double-assignment** — Cùng 1 dealer được gán đồng thời 2–3 bàn | `dl 7` vừa là "Tiếp" bàn 16, vừa là dealer chính bàn 11, vừa ở bàn 15 | 🔴 Critical |
| 2 | **OT sai** — Bàn đã có dealer "Tiếp" nhưng dealer hiện tại vẫn bị đánh dấu OT | `dl 8` bàn 16 OT 01:56 dù đã có `Tiếp: ✓ dl 7` | 🟡 High |
| 3 | **Auto-checkout để bàn trống** — Hệ thống tự động cho dealer rời bàn nhưng không đảm bảo có người thay | `dl 8` bị break_overdue_0m → auto-fixed → bàn trống | 🟡 High |

---

## Bug 1: Double-Assignment (dl 7 trên nhiều bàn)

### Root Cause

File: `supabase/functions/_shared/pickNextDealer.ts` — hàm `buildDealerCandidates`

**Luồng lỗi:**

1. `buildDealerCandidates` query `dealer_attendance` với filter `current_state = 'available'` (dòng 130–132).
2. Sau đó nó query `busyDealerIds` để loại dealer đang bận:
   ```sql
   SELECT dealer_id FROM dealer_attendance
   WHERE id IN (attendanceIds)           -- ← CHỈ các record vừa query ở bước 1
     AND current_state IN ('assigned', 'pre_assigned')
   ```
3. **Vấn đề**: `attendanceIds` chỉ chứa các record có `current_state = 'available'`. Nếu dealer có **2 record attendance** (ví dụ: re-check-in, hoặc record cũ chưa bị xóa):
   - Record A: `current_state = 'assigned'` → KHÔNG nằm trong `attendanceIds`
   - Record B: `current_state = 'available'` → Nằm trong `attendanceIds`
4. `busyDealerIds` KHÔNG tìm thấy record A (vì A không trong `attendanceIds`), nên KHÔNG đánh dấu dealer này là bận.
5. Dealer được pick, gán vào bàn mới → **double-assignment**.

**Cơ chế race condition:**
- `pre_assign_next_dealer_for_table` lock dealer row bằng `FOR UPDATE` theo `attendance_id` (dòng 79–83 migration `20260705000003_fix_pre_assign_rpc.sql`).
- Nhưng lock chỉ lock record B (`available`), không biết record A (`assigned`) tồn tại.
- → Pre-assign thành công dù dealer đã assigned ở nơi khác.

### Minh chứng từ data

```
Bàn 16: dl 8 (main), Tiếp: ✓ dl 7
Bàn 11: dl 7 (main)
Bàn 15: dl 7 (main) — sau khi thay pgv
```

`dl 7` có ít nhất 2 `attendance_id` cùng lúc: 1 assigned bàn 11, 1 pre_assigned bàn 16.

### Fix

**File:** `supabase/functions/_shared/pickNextDealer.ts`

**Thay đổi ở `buildDealerCandidates` (thay thế Step 5 hiện tại):**

```typescript
// Step 5: Exclude dealers who are busy (by dealer_id, not just attendance_id)
const busyDealerIds = new Set<string>();
if (dealerIds.length > 0) {
  // Query ALL attendance records for these dealers, not just the 'available' ones
  const { data: busyDealers } = await admin
    .from("dealer_attendance")
    .select("dealer_id")
    .in("dealer_id", dealerIds)        // ← Query by dealer_id, not attendance_id
    .in("current_state", ["assigned", "pre_assigned"]);
  for (const bd of busyDealers ?? []) {
    busyDealerIds.add(bd.dealer_id);
  }
}
```

**Giải thích:** Query bằng `dealer_id` thay vì `attendance_id` để bắt mọi trường hợp dealer có nhiều record.

---

## Bug 2: OT Hiển Thị Sai Khi Đã Có "Tiếp"

### Root Cause

**Vấn đề 1 — `overtime_started_at` không bị xóa khi tìm được pre-assigned:**

- Khi bàn hết giờ swing và không có dealer thay → `perform_swing` trả về `no_dealer`, đồng thời `overtime_started_at` được set trên `dealer_assignments` (trong RPC `perform_swing` hoặc cron logic).
- Sau đó Pass 2 (`pass2PreAssignNext`) tìm được dealer thay, set `pre_assigned_attendance_id`.
- **NHƯNG** `overtime_started_at` KHÔNG bao giờ được xóa khi có pre-assigned.
- UI thấy `overtime_started_at != null` → hiển thị badge OT.

**Vấn đề 2 — `isOverdue` tính toán sai:**

File: `src/hooks/useDealerSwing.ts` — `useActiveAssignmentsWithTimeline`

```typescript
const isOverdue = diffMs < 0;  // ← chỉ so sánh swing_due_at vs now
```

Không xét đến `pre_assigned_attendance_id`. Nếu đã có người thay, dealer hiện tại đâu có OT.

### Fix

**Fix 2a — Xóa `overtime_started_at` khi pre-assign thành công:**

File: `supabase/functions/process-swing/passes/pass2-pre-assign.ts`

Sau khi `pre_assign_next_dealer_for_table` trả về `pre_assigned`, thêm:

```typescript
await admin
  .from("dealer_assignments")
  .update({ overtime_started_at: null, last_ot_alert_at: null })
  .eq("id", assignment.id);
```

**Fix 2b — UI không hiển thị OT khi có pre-assigned:**

File: `src/hooks/useDealerSwing.ts` — `useActiveAssignmentsWithTimeline`

```typescript
const isOverdue = diffMs < 0 && !a.pre_assigned_attendance_id;
// Hoặc: const showNextDealerSoon = minutesLeft <= 5 || !!a.pre_assigned_attendance_id;
```

Tương tự, `useAttentionQueue.ts` (nếu có) cần giảm priority của bàn có pre-assigned.

---

## Bug 3: Auto-Checkout / Break Để Bàn Trống

### Root Cause

**Vấn đề 1 — Checkout không trigger tìm dealer thay:**

File: `supabase/functions/checkout-dealer/index.ts`

Khi dealer checkout:
1. `transition_dealer_state` → `checked_out` (dòng 131–135)
2. `dealer_attendance` cập nhật `status = 'checked_out'` (dòng 141–154)
3. **KHÔNG có bước nào tìm dealer thay cho bàn**.
4. `dealer_assignments` row cũ vẫn tồn tại với `status = 'assigned'`.
5. UI vẫn hiển thị dealer cũ (vì `useActiveAssignments` chỉ filter `status = 'assigned'`, không filter `dealer_attendance.status = 'checked_out'`).

**Vấn đề 2 — `useActiveAssignments` không loại `checked_out`:**

File: `src/hooks/useDealerSwing.ts` — `useActiveAssignments`

```typescript
.in("status", ["assigned"])
.neq("dealer_attendance.current_state", "on_break")
// ← Thiếu: .neq("dealer_attendance.status", "checked_out")
```

→ Assignment của dealer đã checkout vẫn hiển thị trong UI, gây hiểu nhầm.

**Vấn đề 3 — Break overdue auto-end không re-assign bàn:**

File: `supabase/functions/process-swing/index.ts` — Pass 0c

Khi `detect_stuck_breaks` tìm thấy break quá hạn → gọi `end_dealer_break`:
- Dealer trở về `available`.
- Assignment cũ có `status = 'on_break'` (không hiển thị trong active list).
- **KHÔNG có logic tự động gán dealer này (hoặc dealer khác) vào bàn**.

### Fix

**Fix 3a — Loại `checked_out` khỏi active assignments:**

File: `src/hooks/useDealerSwing.ts`

```typescript
// Thêm filter
.neq("dealer_attendance.status", "checked_out")
// Hoặc chỉ chấp nhận checked_in:
.eq("dealer_attendance.status", "checked_in")
```

**Fix 3b — Checkout trigger fillEmptyTables cho bàn đó:**

File: `supabase/functions/checkout-dealer/index.ts`

Sau khi checkout thành công, nếu dealer đang assigned một bàn (hoặc pre_assigned một bàn), trigger tìm dealer thay:

```typescript
// Sau bước 4 (checkout update)
// Tìm bàn dealer này đang assigned
const { data: activeAssign } = await admin
  .from("dealer_assignments")
  .select("table_id")
  .eq("attendance_id", attendanceId)
  .eq("status", "assigned")
  .maybeSingle();

if (activeAssign) {
  // Release assignment
  await admin.from("dealer_assignments")
    .update({ status: "completed", released_at: new Date().toISOString() })
    .eq("id", activeAssign.id);
  
  // Trigger fill cho bàn này
  const { fillEmptyTables } = await import("../_shared/dealer-utils.ts");
  await fillEmptyTables(admin, clubId, undefined, botToken, undefined, undefined);
}
```

**Fix 3c — Sau `end_dealer_break`, nếu dealer có bàn cũ → restore assignment:**

Cần sửa `end_dealer_break` RPC hoặc Pass 0c: khi break kết thúc, nếu dealer có assignment `on_break` → chuyển `status` về `assigned` (nếu bàn vẫn active).

---

## Migration Cần Tạo

```sql
-- Fix 1: Xóa overtime_started_at khi pre-assign thành công
-- (Có thể làm bằng trigger hoặc sửa trong Pass 2 edge function)

-- Fix 2: Thêm partial unique constraint để ngăn dealer có nhiều assignment active
-- Lưu ý: dealer được xác định qua attendance_id, nhưng 1 dealer có thể có nhiều attendance_id
-- → Khó làm unique constraint. Tốt nhất fix ở application layer (pickNextDealer).

-- Fix 3: Không cần migration schema, chỉ sửa edge function + hook query
```

---

## Thứ Tự Fix Ưu Tiên

| Thứ tự | Fix | File | Effort |
|--------|-----|------|--------|
| 1 | **Bug 1** — Query `busyDealerIds` by `dealer_id` | `pickNextDealer.ts` | 30 min |
| 2 | **Bug 2a** — Xóa `overtime_started_at` khi pre-assign | `pass2-pre-assign.ts` + migration | 30 min |
| 3 | **Bug 2b** — UI không hiển thị OT khi có pre-assigned | `useDealerSwing.ts` | 15 min |
| 4 | **Bug 3a** — Filter `checked_out` khỏi active assignments | `useDealerSwing.ts` | 15 min |
| 5 | **Bug 3b** — Checkout trigger fillEmptyTables | `checkout-dealer/index.ts` | 45 min |
| 6 | **Bug 3c** — End break restore assignment | `end_dealer_break` RPC hoặc Pass 0c | 1h |

---

## Câu Hỏi Cho User

1. **Bug 1**: Bạn có muốn thêm **database-level guard** (trigger ngăn INSERT assignment nếu dealer đã assigned/pre_assigned ở nơi khác) hay chỉ fix ở application layer?

2. **Bug 2**: Khi bàn đã có `Tiếp`, bạn muốn:
   - (A) Ẩn badge OT, dealer cứ làm bình thường đến khi người thay đến
   - (B) Vẫn hiện OT nhưng giảm cấp độ cảnh báo (ví dụ: màu vàng thay vì đỏ)

3. **Bug 3**: Khi dealer checkout giữa ca, bạn muốn:
   - (A) Hệ thống tự động tìm dealer thay ngay lập tức
   - (B) Để bàn trống, chờ cron `process-swing` (mỗi phút) tự fill
   - (C) Báo động Telegram + để Floor Manager chủ động gán tay

---

*File reference đầy đủ:*
- `supabase/functions/_shared/pickNextDealer.ts` — dealer scoring + selection
- `supabase/functions/_shared/fillEmptyTables.ts` — auto-fill bàn trống
- `supabase/functions/process-swing/passes/pass2-pre-assign.ts` — pre-assign logic
- `supabase/functions/process-swing/index.ts` — main swing cron
- `supabase/functions/checkout-dealer/index.ts` — checkout logic
- `src/hooks/useDealerSwing.ts` — hooks query + timeline
- `supabase/migrations/20260703000003_fix_break_formula_and_preassign.sql` — `perform_swing` + `execute_pre_assigned_swing` RPC
- `supabase/migrations/20260705000003_fix_pre_assign_rpc.sql` — `pre_assign_next_dealer_for_table` RPC
